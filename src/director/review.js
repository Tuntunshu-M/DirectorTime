// 导演时间 · 复盘编排
//
// T-206。一轮对话结束后在后台跑，不阻塞 UI。
// 时序见《AI执行清单》§1 与规格 T-405 / T-416：
//   MESSAGE_RECEIVED
//     → 判 user 态度（T-405 意愿矩阵）
//         accept（含置信不足的放行）→ 继续跑推进点判定
//         其它 stance                → 就地执行矩阵动作，本轮结束（拍板 b）
//     → 更新阶段 → 重新注册注入（供下一轮使用）
//
// 四条纪律：
//   1. regenerate / swipe 不触发复盘（否则会重复推进）
//   2. 判定失败（hold）不计入卡住——网络问题不该熔断剧情
//   3. 让步类动作执行完就结束本轮，不再叠加推进判定（两个判定器各管一头）
//   4. 动作名只有 rewrite，没有 retry（T-405 拍板 c）

import { buildInstruction } from '../inject/instruction.js';
import { resolvePacing } from './checkpoint.js';
import { resolve, shouldRunCheckpoint } from './will.js';
import { needsInitiative, profileStamp } from './initiative.js';

const SKIP_TYPES = ['regenerate', 'swipe', 'impersonate', 'quiet'];

/** 硬禁区命中：判定说 violated 且把握够（阈值同 T-205，拿不准就不当命中） */
function isViolated(judgement, threshold) {
  return judgement?.status === 'violated' && Number(judgement?.confidence ?? 0) >= threshold;
}

export function createReviewService({
  checkpoint,
  beats,
  topUp,
  will,
  initiative,
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

  // T-417：记下"这一版侧写已经试过重生成"，失败不每轮重试
  let initiativeTriedFor = '';

  /**
   * initiative 跟侧写对不上就重生成一次（T-417）。
   * 失败只记日志：本轮退回通用主动性提示，不注入半成品（G5）。
   */
  async function refreshInitiative(stage) {
    if (!initiative?.refresh || !stage) return null;
    const profile = getProfile?.() ?? null;
    if (!needsInitiative(stage, profile)) return null;

    const stamp = profileStamp(profile);
    if (!stamp || initiativeTriedFor === stamp) return null;
    initiativeTriedFor = stamp;

    const result = await initiative.refresh({ stage, profile });
    if (!result?.ok) console.warn('[导演时间] 主动性重生成失败：', result?.error ?? '未知');
    return result;
  }

  /**
   * 执行本轮最终动作。动作可能来自意愿矩阵（T-405），也可能来自推进点判定（T-205 / T-416）。
   * 所有失败路径都不抛异常，也不注入半成品（禁则 G5）。
   */
  async function applyAction(result, { active, activeId, userMessage, charMessage, decision } = {}) {
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

      case 'rewrite': {
        // 本场停留，就地**换一组走位**再试（T-205 验收④；T-405 拍板 c）
        if (activeId) {
          // 部分达成算有进展 → 卡住计数清零；完全没碰到 → 累计，够数由熔断兜底
          if (result.judgement?.status === 'partial') stages?.resetStuck?.(activeId);
          else stages?.bumpStuck?.(activeId);
        }
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

      case 'hold':
        // 强制爱：本场不换、不丢，继续推进；同时累计卡住计数，
        // 靠熔断保证"怎么反抗 char 也会带着走"，不会永远原地打转（§七）
        if (decision?.forced && activeId) stages?.bumpStuck?.(activeId);
        break;

      case 'redirect':
        // 明确表达相反意图且把握足：本场保持不动，先累计卡住
        if (activeId) stages?.bumpStuck?.(activeId);
        break;

      default:
        // hold：判定失败不计入卡住
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

      // 1) 判 user 这一句的态度 → 意愿矩阵（T-405）
      let decision = null;
      let judgedTurn = null;
      let preJudged = null;
      const forceAffection = Boolean(settings.forceAffection);
      const threshold = settings.confidenceThreshold ?? 0.7;

      if (active && will?.judge) {
        judgedTurn = await will.judge({ stage: active, userMessage });

        // 强制爱开着且 user 明确拒绝 → 先确认没触及硬禁区（硬禁区不被强制爱覆盖，§七）
        if (forceAffection && judgedTurn.stance === 'reject') {
          preJudged = await checkpoint.judge({ userMessage, charMessage });
        }

        decision = resolve({
          stance: judgedTurn.stance,
          confidence: judgedTurn.confidence,
          will: active?.will ?? settings.will,
          stuckCount: active?.stuckCount ?? 0,
          stuckThreshold: settings.stuckThreshold ?? 3,
          forceAffection,
          violated: isViolated(preJudged?.judgement, threshold),
        });
      }

      // 每轮结束本场楼数 +1（T-416e）—— 两个判定器收的都是本轮之前的计数
      if (activeId) stages?.bumpTurn?.(activeId);

      // 2/3) accept → 推进点判定；其它 stance → 就地执行矩阵动作，跳过判定（拍板 b）
      const result = shouldRunCheckpoint(decision)
        ? (preJudged ?? (active
          ? await checkpoint.judge({ userMessage, charMessage })
          : { action: 'hold', reason: '没有进行中的阶段' }))
        : { action: decision.action, reason: decision.reason };

      await applyAction(result, { active, activeId, userMessage, charMessage, decision });

      // 推进后补足待演阶段，保证"永远有 1~2 条在等"（T-209）
      if ((result.action === 'advance' || result.action === 'force') && topUp) {
        await topUp();
      }

      // 侧写换过 → 当前这场（推进后可能是新的一场）的 initiative 过期，先补上再注入（T-417）
      await refreshInitiative(stages?.getActive?.());

      const injected = result.action === 'follow' ? clearInjection() : syncInjection();
      store?.update?.((draft) => ({
        ...draft,
        runtime: { ...draft.runtime, lastReviewAt: Date.now() },
      }));

      // 本轮回放：云酒馆看不到后台，这个就是排查的主要依据
      const judgement = result.judgement ?? preJudged?.judgement ?? null;
      lastTurn = {
        userMessage,
        charMessage,
        usedInjection,
        nextInjection: injected,
        judgement,
        raw: result.raw ?? preJudged?.raw ?? judgedTurn?.raw ?? '',
        // T-405：态度判定与矩阵决策（没判到时为 null）
        stance: decision
          ? {
            stance: decision.stance,
            confidence: decision.confidence,
            tier: decision.tier,
            floored: decision.floored,
            forced: decision.forced,
            action: decision.action,
            reason: decision.reason,
            ok: judgedTurn?.ok ?? false,
            // T-406：这一轮的态度是本地规则判的，还是问了 LLM
            source: judgedTurn?.source ?? '',
            matched: judgedTurn?.matched ?? judgedTurn?.rule?.matched ?? [],
            violated: isViolated(judgement, threshold),
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
