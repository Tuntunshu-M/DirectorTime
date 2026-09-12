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
import { findReplyTails, describeTails } from './tail-guard.js';
import { cleanText, wasCleaned } from '../llm/text-clean.js';
import { needsInitiative, profileStamp } from './initiative.js';

const SKIP_TYPES = ['regenerate', 'swipe', 'impersonate', 'quiet'];

/** 硬禁区命中：判定说 violated 且把握够（阈值同 T-205，拿不准就不当命中） */
function isViolated(judgement, threshold) {
  return judgement?.status === 'violated' && Number(judgement?.confidence ?? 0) >= threshold;
}

import { resolveRecalled } from './foreshadow.js';
import { matchHardLimits } from './hard-limits.js';
import { shouldInject } from '../world/cast.js';
import { gate } from '../core/automation.js';

export function createReviewService({
  checkpoint,
  beats,
  topUp,
  will,
  initiative,
  speculate,
  getProfile,
  // P1-3：文本清洗配置（判定输入要洗净，聊天记录本体不动）
  getCleanRules,
  // T-412：当前要生成的角色（多人卡里用来判断"这场戏是不是他的"）
  getSpeaker,
  // T-414：L1 档的待审核队列
  queue,
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
    const settings = getSettings?.() ?? {};
    const active = state?.stages?.find((stage) => stage.id === state.activeStageId);

    // T-412 多人卡：当前生成者不是主角、或这一场不是他的戏 → 不注入，并且要把旧的清干净
    if (active && !shouldInject({
      stage: active,
      speaker: getSpeaker?.() ?? null,
      protagonists: settings.protagonists,
    })) {
      registry?.clear?.();
      return '';
    }

    const pacing = active ? resolvePacing(active, settings) : null;
    const text = active
      ? buildInstruction({
        stage: active,
        outline: state.outline,
        profile: getProfile?.() ?? null,
        pacing,
        // T-410：硬禁区每轮都要带上（角色回复端的约束）
        hardLimits: settings.hardLimits ?? [],
      })
      : '';
    registry?.register?.(text);
    // 配置一改（红线 / 破限 / 硬禁区 / 主角…）就重算一次，Debug 的「下轮将注入」要立刻跟上，
    // 不能等下一轮复盘才更新（用户实测反馈：注入全文变了，"下轮将注入"还是旧的）
    if (lastTurn) lastTurn = { ...lastTurn, nextInjection: text };
    return text;
  }

  /** 剧情暂停（T-405 follow）：不注入任何内容，等 user 带回 */
  function clearInjection() {
    registry?.clear?.();
    return '';
  }

  /**
   * 换聊天时把"上一轮记录"也清掉。
   * 不清的话：新聊天里 Debug 会显示上一个聊天的本轮记录，还会被连续性检查误判成"注册丢了"。
   */
  function resetTurn() {
    lastTurn = null;
    initiativeTriedFor = '';
    return true;
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
        // T-404：锁定 = 用户显式指定，AI 不许改这一场的走位
      if (active && beats?.rewrite && !active.locked) {
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
   * T-408：判定里报回来的已回收伏笔 → 销账、从待回收列表移除。
   * 认不出来的编号直接忽略（模型可能编），失败的伏笔保持待回收。
   */
  function settleRecalled(judgement) {
    const recalled = Array.isArray(judgement?.recalled) ? judgement.recalled : [];
    if (!recalled.length) return [];

    let resolved = [];
    store?.update?.((draft) => {
      const result = resolveRecalled(draft.outline, recalled);
      resolved = result.resolved;
      return { ...draft, outline: result.outline };
    }, { track: false });

    if (resolved.length) console.log(`[导演时间] 已回收伏笔 ${resolved.length} 条`);
    return resolved;
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
      // T-407：先结算上一轮的投机预测 —— 命中就认账，失手就静默降级（下面的 syncInjection 会重建常规注入）
      const speculated = speculate?.settle?.(input.userMessage ?? '') ?? { hit: false, speculation: null };
      if (speculated.speculation && !speculated.hit) {
        console.log('[导演时间] 投机未命中，本轮起静默降级为常规剧本');
      }

      // 本轮生成时实际生效的注入内容（上一轮复盘后注册的）
      const usedInjection = registry?.getStatus?.().text ?? '';
      // 连续性检查：上一轮明明注册了内容，这一轮生成时却什么都没有 →
      // 说明注册在中途丢了（别的扩展清了同一个 key / 换过聊天 / ST 重载了 prompt），要报出来
      const previousNext = lastTurn?.nextInjection ?? '';
      const injectionDrift = Boolean(previousNext && !usedInjection);
      if (injectionDrift) {
        console.warn(
          `[导演时间] 注入断了：上一轮注册了 ${previousNext.length} 字，这一轮生成时却是空的`
          + '（可能被别的扩展覆盖了同一个 key，或中途换过聊天）'
        );
      }

      // 用户反馈 ②：模型自己加的尾巴（思考块 / "请选择剧情导向"）。
      // **只识别、只报警，不改写回复** —— 要根治得去角色预设那边关。
      const rawCharMessage = input.charMessage ?? '';
      const tails = findReplyTails(rawCharMessage);
      if (tails.length) {
        console.warn(
          `[导演时间] char 回复里有模型尾巴（不是本插件注入的）：${describeTails(tails)}\n`
          + '建议：检查角色预设 / 破限词里是不是带了 <thinking> 规则，或要求"输出选项菜单"'
        );
      }

      // P1-3：判定输入先过清洗层（<thinking> 之类会污染判定；聊天记录本体不动）
      const cleanConfig = getCleanRules?.() ?? null;
      const charMessage = cleanText(rawCharMessage, cleanConfig);
      const charCleaned = wasCleaned(rawCharMessage, cleanConfig);
      const active = stages?.getActive?.();
      const activeId = active?.id;
      const userMessage = input.userMessage ?? '';
      const settings = getSettings?.() ?? {};

      // 0) 硬禁区（T-410）：user 说了 / 角色回了沾边的内容 → 命中即停。
      //    本地判定、不看 Will，强制爱也不覆盖（用户显式 > 一切 AI 行为）。
      const limitHit = matchHardLimits(`${userMessage}\n${charMessage}`, settings.hardLimits);
      if (limitHit) {
        clearInjection();
        lastTurn = {
          userMessage,
          charMessage,
          charMessageRaw: rawCharMessage,
          charCleaned,
          usedInjection,
          previousNextInjection: previousNext.length,
          injectionDrift,
          tails,
          nextInjection: '',
          speculation: null,
          recalled: [],
          judgement: null,
          action: 'halt',
          reason: `命中硬禁区「${limitHit}」`,
          stageTitle: active?.title ?? '',
          at: Date.now(),
        };
        onEvent?.('halt', { limit: limitHit });
        return { action: 'halt', reason: lastTurn.reason, injected: '', limit: limitHit };
      }

      // 1) 判 user 这一句的态度 → 意愿矩阵（T-405）
      let decision = null;
      let judgedTurn = null;
      let preJudged = null;
      const forceAffection = Boolean(settings.forceAffection);
      const threshold = settings.confidenceThreshold ?? 0.7;

      // T-414：两个判定点各自的档位（L0 不自动跑 / L1 结果先进队列 / L2 直接生效）
      const automation = settings.automation ?? {};
      const stanceGate = gate(automation, 'stanceJudge');
      const cpGate = gate(automation, 'checkpointJudge');

      if (active && will?.judge && stanceGate.auto) {
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
      const fromCheckpoint = shouldRunCheckpoint(decision);
      let result = fromCheckpoint
        ? (preJudged ?? (active
          ? (cpGate.auto
            ? await checkpoint.judge({ userMessage, charMessage })
            : { action: 'hold', reason: '推进点判定是 L0（全手动），本轮不自动判定' })
          : { action: 'hold', reason: '没有进行中的阶段' }))
        : { action: decision.action, reason: decision.reason };

      // T-414 L1：判定照跑，但结果先进待审核队列，本轮按最保守动作（保持不动）
      let queued = null;
      const judgeGate = fromCheckpoint ? cpGate : stanceGate;
      if (judgeGate.queue && result.action !== 'hold') {
        queued = queue?.add?.({
          feature: judgeGate.feature,
          payload: { action: result.action, reason: result.reason ?? '', judgement: result.judgement ?? null },
          summary: `建议动作「${result.action}」：${result.reason ?? ''}`,
        }) ?? null;
        result = {
          action: 'hold',
          reason: `判定为 ${judgeGate.level}（待确认）：「${queued?.payload?.action ?? ''}」已进队列，确认后才生效`,
          judgement: result.judgement ?? null,
        };
      }

      // T-408：判定顺手报回来的伏笔编号，在这里销账
      const recalled = settleRecalled(result.judgement ?? preJudged?.judgement);

      await applyAction(result, { active, activeId, userMessage, charMessage, decision });

      // 推进后补足待演阶段，保证"永远有 1~2 条在等"（T-209）
      if ((result.action === 'advance' || result.action === 'force') && topUp) {
        await topUp();
      }

      // 侧写换过 → 当前这场（推进后可能是新的一场）的 initiative 过期，先补上再注入（T-417）
      await refreshInitiative(stages?.getActive?.());

      const injected = result.action === 'follow' ? clearInjection() : syncInjection();
      // P2：把"这一轮实际发出去的注入"存成快照 —— 排查投机命中率时，得知道上一轮到底注入了什么
      store?.update?.((draft) => ({
        ...draft,
        runtime: {
          ...draft.runtime,
          lastReviewAt: Date.now(),
          lastInjection: {
            text: usedInjection,
            at: Date.now(),
            stageTitle: active?.title ?? '',
            action: result.action,
            speculation: speculated.speculation
              ? { hit: speculated.hit, guess: speculated.speculation.guess }
              : null,
          },
        },
      }));

      // 本轮回放：云酒馆看不到后台，这个就是排查的主要依据
      const judgement = result.judgement ?? preJudged?.judgement ?? null;
      lastTurn = {
        userMessage,
        // 判定用的是清洗后的；原文留着给 Debug 切换查看（聊天记录本体一直没动）
        charMessage,
        charMessageRaw: rawCharMessage,
        charCleaned,
        usedInjection,
        // 上一轮注册了多少字（用来判断"注册是不是中途丢了"）
        previousNextInjection: previousNext.length,
        injectionDrift,
        // 模型自己加的尾巴（思考块 / 选项菜单 / 把决定权交回 user）
        tails,
        nextInjection: injected,
        // T-407：这一轮用的是不是投机预测（Debug 显示命中率）
        speculation: speculated.speculation
          ? { hit: speculated.hit, guess: speculated.speculation.guess }
          : null,
        // T-408：这一轮回收掉的伏笔
        recalled,
        // T-414：L1 档下这一轮判定进队了
        queued: queued ? { id: queued.id, feature: queued.feature } : null,
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

  /** T-414：待审核条目被确认后，把当时判定的动作真正落地 */
  async function applyConfirmed(payload = {}) {
    const active = stages?.getActive?.();
    await applyAction(
      { action: payload.action, reason: payload.reason || '确认后应用' },
      { active, activeId: active?.id, userMessage: '', charMessage: '' }
    );
    if ((payload.action === 'advance' || payload.action === 'force') && topUp) await topUp();
    syncInjection();
    return true;
  }

  return { run, syncInjection, applyConfirmed, resetTurn, getLastTurn: () => lastTurn };
}
