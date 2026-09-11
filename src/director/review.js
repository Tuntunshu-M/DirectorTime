// 导演时间 · 复盘编排
//
// T-206。一轮对话结束后在后台跑，不阻塞 UI。
// 时序见《AI执行清单》§1 与规格 T-416 §五：
//   MESSAGE_RECEIVED
//     → 判 user 态度（T-405 意愿矩阵）：让步类动作就地执行，跳过推进点判定
//     → 否则判推进点（T-205 判定 + T-416 楼层规则）
//     → 更新阶段 → 重新注册注入（供下一轮使用）
//
// 三条纪律：
//   1. regenerate / swipe 不触发复盘（否则会重复推进）
//   2. 判定失败（hold）不计入卡住——网络问题不该熔断剧情
//   3. 让步类动作执行完就结束本轮，不再叠加推进判定（两个判定器各管一头）

import { buildInstruction } from '../inject/instruction.js';
import { resolvePacing } from './checkpoint.js';
import { resolve, isConcession } from './will.js';

const SKIP_TYPES = ['regenerate', 'swipe', 'impersonate', 'quiet'];

export function createReviewService({
  checkpoint,
  beats,
  topUp,
  will,
  getProfile,
  stages,
  registry,
  store,
  getSettings,
  onEvent,
} = {}) {
  let running = false;
  let lastTurn = null;

  function syncInjection() {
    const state = store?.get?.();
    const active = state?.stages?.find((stage) => stage.id === state.activeStageId);
    const pacing = active ? resolvePacing(active, getSettings?.() ?? {}) : null;
    const text = active
      ? buildInstruction({ stage: active, outline: state.outline, profile: getProfile?.() ?? null, pacing })
      : '';
    registry?.register?.(text);
    return text;
  }

  /** 剧情暂停（T-405 follow）：不注入任何内容，等 user 带回 */
  function clearInjection() {
    registry?.clear?.();
    return '';
  }

  /** 执行推进点判定给出的动作（T-205 判定 / T-416 楼层） */
  async function applyCheckpointAction(result, { active, activeId, userMessage, charMessage }) {
    switch (result.action) {
      case 'advance':
      case 'force':
        // 放行、熔断、到点都走推进
        stages?.advance?.();
        break;
      case 'settle':
        // 已达成但还没到 min 楼：进入收尾（ready），不切场（T-416）
        if (activeId) stages?.setStatus?.(activeId, 'ready');
        break;
      case 'retry':
        if (activeId) stages?.bumpStuck?.(activeId);
        break;
      case 'rewrite': {
        // 部分达成：本场停留，但**换一组走位**再试（T-205 验收④）
        if (activeId) stages?.resetStuck?.(activeId);
        if (active && beats?.rewrite) {
          const rewritten = await beats.rewrite({
            stage: active,
            userMessage,
            charMessage,
            reason: result.reason ?? '',
          });
          // 重写失败就保持原走位（G5：解析不出来就不改任何东西）
          if (rewritten.ok && rewritten.beats?.length) {
            stages?.update?.(activeId, { beats: rewritten.beats });
          }
        }
        break;
      }
      case 'redirect':
        // 明确违背且把握足：本场先保持不动（意愿矩阵已在前面拦过一道）
        if (activeId) stages?.bumpStuck?.(activeId);
        break;
      default:
        // hold：判定失败不计入卡住
        break;
    }
  }

  /** 执行意愿矩阵给出的动作（T-405）：一步到位，不再叠加推进判定 */
  async function applyConcession(decision, { active, activeId, userMessage, charMessage }) {
    switch (decision.action) {
      case 'hold':
        // 停留：不动状态，继续注入本阶段指令（最后统一 syncInjection）
        break;

      case 'retry': {
        // 换一组走位再试；累加卡住计数，所以"再拒"会走到 drop
        if (activeId) stages?.bumpStuck?.(activeId);
        if (active && beats?.rewrite) {
          const rewritten = await beats.rewrite({
            stage: active,
            userMessage,
            charMessage,
            reason: decision.reason,
          });
          if (rewritten.ok && rewritten.beats?.length) {
            stages?.update?.(activeId, { beats: rewritten.beats });
          }
        }
        break;
      }

      case 'drop':
        // 让步：作废本场，不再往前推
        if (activeId) stages?.drop?.(activeId);
        break;

      case 'regenAfter': {
        // 让步 + 重生成后续：成功就把新场接上；失败只作废、不注入（G5）
        if (activeId) stages?.drop?.(activeId);
        const regenerated = await topUp?.({ force: true });
        const fresh = regenerated?.stages?.[0];
        if (fresh) stages?.activate?.(fresh.id);
        break;
      }

      case 'follow':
        // 剧情暂停：注入的清空在 run() 里统一处理
        break;

      default:
        break;
    }
  }

  /**
   * @param {{ userMessage?: string, charMessage?: string, type?: string }} input
   */
  async function run(input = {}) {
    const type = input.type ?? 'normal';
    if (SKIP_TYPES.includes(type)) {
      return { skipped: true, reason: `${type} 不触发复盘` };
    }
    if (running) {
      return { skipped: true, reason: '上一轮复盘尚未结束' };
    }

    running = true;
    try {
      // 本轮生成时实际生效的注入内容（上一轮复盘后注册的）
      const usedInjection = registry?.getStatus?.().text ?? '';
      const active = stages?.getActive?.();
      const activeId = active?.id;
      const userMessage = input.userMessage ?? '';
      const charMessage = input.charMessage ?? '';
      const settings = getSettings?.() ?? {};

      // 1) 先判 user 这一句的态度 → 意愿矩阵（T-405）
      const stance = active && will?.judge
        ? await will.judge({ stage: active, userMessage })
        : null;
      const decision = stance
        ? resolve({
            stance: stance.stance,
            confidence: stance.confidence,
            will: active?.will ?? settings.will,
            stuckCount: active?.stuckCount ?? 0,
            stuckThreshold: settings.stuckThreshold ?? 3,
          })
        : null;

      // 每轮结束本场楼数 +1（T-416e）—— 两个判定器收的都是本轮之前的计数
      if (activeId) stages?.bumpTurn?.(activeId);

      let result;
      if (decision && isConcession(decision.action)) {
        // 2) 让步类动作：执行它，跳过推进点判定
        result = { action: decision.action, reason: decision.reason };
        await applyConcession(decision, { active, activeId, userMessage, charMessage });
      } else {
        // 3) 否则跑推进点判定（T-205 + 楼层规则）
        const judged = active
          ? await checkpoint.judge({ userMessage, charMessage })
          : { action: 'hold', reason: '没有进行中的阶段' };
        result = judged;
        await applyCheckpointAction(judged, { active, activeId, userMessage, charMessage });
      }

      // 推进后补足待演阶段，保证"永远有 1~2 条在等"（T-209）
      if ((result.action === 'advance' || result.action === 'force') && topUp) {
        await topUp();
      }

      const injected = result.action === 'follow' ? clearInjection() : syncInjection();
      store?.update?.((draft) => ({
        ...draft,
        runtime: { ...draft.runtime, lastReviewAt: Date.now() },
      }));

      // 本轮回放：云酒馆看不到后台，这个就是排查的主要依据
      lastTurn = {
        userMessage,
        charMessage,
        usedInjection,
        nextInjection: injected,
        judgement: result.judgement ?? null,
        // T-405：态度判定与矩阵决策（没判到时为 null）
        stance: decision
          ? {
            stance: decision.stance,
            confidence: decision.confidence,
            tier: decision.tier,
            floored: decision.floored,
            action: decision.action,
            reason: decision.reason,
            ok: stance?.ok ?? false,
          }
          : null,
        action: result.action,
        reason: result.reason ?? '',
        stageTitle: active?.title ?? '',
        at: Date.now(),
      };

      const payload = { action: result.action, reason: result.reason, injected };
      onEvent?.('review', payload);
      return payload;
    } finally {
      running = false;
    }
  }

  return { run, syncInjection, getLastTurn: () => lastTurn };
}
