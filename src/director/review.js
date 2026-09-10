// 导演时间 · 复盘编排
//
// T-206。一轮对话结束后在后台跑，不阻塞 UI。
// 时序见《AI执行清单》§1：
//   MESSAGE_RECEIVED → 判定 → 更新阶段 → 重新注册注入（供下一轮使用）
//
// 两条纪律：
//   1. regenerate / swipe 不触发复盘（否则会重复推进）
//   2. 判定失败（hold）不计入卡住——网络问题不该熔断剧情

import { buildInstruction } from '../inject/instruction.js';

const SKIP_TYPES = ['regenerate', 'swipe', 'impersonate', 'quiet'];

export function createReviewService({
  checkpoint,
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
    const text = active ? buildInstruction({ stage: active, outline: state.outline, profile: null }) : '';
    registry?.register?.(text);
    return text;
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
      const result = active
        ? await checkpoint.judge({
            userMessage: input.userMessage ?? '',
            charMessage: input.charMessage ?? '',
          })
        : { action: 'hold', reason: '没有进行中的阶段' };

      const activeId = active?.id;

      switch (result.action) {
        case 'advance':
        case 'force':
          // 放行与熔断都走推进
          stages?.advance?.();
          break;
        case 'retry':
          if (activeId) stages?.bumpStuck?.(activeId);
          break;
        case 'rewrite':
          // 部分达成：重置卡住计数，换条走位再试（重写 beats 由后续任务接入）
          if (activeId) stages?.resetStuck?.(activeId);
          break;
        case 'redirect':
          // 明确违背：交给意愿矩阵决定让步还是坚持（T-405 之前先保持不动）
          if (activeId) stages?.bumpStuck?.(activeId);
          break;
        default:
          // hold：判定失败不计入卡住
          break;
      }

      const injected = syncInjection();
      store?.update?.((draft) => ({
        ...draft,
        runtime: { ...draft.runtime, lastReviewAt: Date.now() },
      }));

      // 本轮回放：云酒馆看不到后台，这个就是排查的主要依据
      lastTurn = {
        userMessage: input.userMessage ?? '',
        charMessage: input.charMessage ?? '',
        usedInjection,
        nextInjection: injected,
        judgement: result.judgement ?? null,
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
