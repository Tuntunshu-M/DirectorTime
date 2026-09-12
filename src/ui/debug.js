// 导演时间 · 调试面板的**状态层**（纯函数，无 DOM）
//
// T-207 + T-427：定稿把调试面板并进了主面板的弹层（`render/debug.js` 负责画），
// 这个文件只留纯函数：把状态整理成结构 + 把几行文案格式化好，方便自动化测试。
//
// 目标只有一个：出问题时，一眼看出卡在哪一步、模型返回了什么。

import { hitRate } from '../director/speculate.js';
import { openForeshadows } from '../director/foreshadow.js';
import { automationText } from '../core/automation.js';

/**
 * T-411 / T-418：破限词模式 + 选中的酒馆预设，压成一行。
 *
 * **这一行只能说明一件事：到底注入了没有。**
 * 之前只写「预设生效 N 字」，可模式是 off 时其实一个字都没注入 —— Debug 是排查的唯一依据，
 * 它骗人整个排查就废了。所以这里统一口径：
 *   没注入 → 「预设：X（未启用，未注入）」/「自定义：空（未注入）」
 *   真注入 → 「预设：X（已注入 N 字）」
 * 末尾还会写「本轮实际注入 N 字」兜底。
 */
export function breakFilterLine(status) {
  if (!status) return '—';
  const mode = status.mode ?? 'off';
  const preset = status.preset ?? null;
  const wantsPreset = mode === 'preset' || mode === 'append';
  const wantsCustom = mode === 'custom' || mode === 'append';
  const parts = [];

  if (mode === 'off') {
    parts.push('关闭（未注入破限词）');
    if (preset?.name) parts.push(`预设：${preset.name}（未启用，未注入）`);
    return parts.join(' · ');
  }

  parts.push(`模式 ${mode}`);

  if (preset?.name) {
    if (wantsPreset && preset.active) parts.push(`预设：${preset.name}（已注入 ${preset.length} 字）`);
    else if (wantsPreset) parts.push(`预设：${preset.name}（读不到内容，未注入）`);
    else parts.push(`预设：${preset.name}（未启用，未注入）`);
  } else if (wantsPreset) {
    parts.push(preset?.available ? '未选预设（未注入）' : '无可用预设（未注入）');
  } else {
    parts.push('未选预设（未注入）');
  }

  if (wantsCustom) {
    parts.push(status.customLength ? `自定义：已注入 ${status.customLength} 字` : '自定义：空（未注入）');
  }

  parts.push(`本轮实际注入 ${status.injected ?? 0} 字`);
  return parts.join(' · ');
}

/**
 * T-426：这一轮判定是谁给的 —— 本地规则（零调用）/ 合并调用（1 次拿三段）/ 老路径单独判。
 * 合并调用还顺带标出三段各自解析到了没有（哪段坏掉就在这儿看得见）。
 */
export function stanceSourceLine(stance) {
  if (!stance) return '—';
  const source = stance.source === 'rules' ? '本地规则（零调用）'
    : (stance.source === 'combined' ? '合并调用（1 次拿三段）' : (stance.source === 'llm' ? '单独调用' : (stance.source || '—')));
  const sections = stance.sections;
  if (!sections) return source;
  const got = Object.entries(sections).filter(([, ok]) => ok).map(([key]) => key);
  const lost = Object.entries(sections).filter(([, ok]) => !ok).map(([key]) => key);
  return `${source} · 解析到 ${got.join('/') || '无'}${lost.length ? ` · 降级 ${lost.join('/')}` : ''}`;
}

/** 纯函数：把当前状态整理成 Debug 需要的结构 */
export function buildDebugState({
  store, registry, last = null, capabilities = null, lastTurn = null, lastRequest = null, breakStatus = null,
  // P1-2：档位只有一个来源（settings），由调用方传进来；读聊天级状态会永远看到默认值
  automation = null,
} = {}) {
  const state = store?.get?.() ?? {};
  const stages = state.stages ?? [];
  const active = stages.find((stage) => stage.id === state.activeStageId) ?? null;
  const index = active ? stages.findIndex((stage) => stage.id === active.id) + 1 : 0;

  const injection = registry?.getStatus?.() ?? { registered: false, length: 0, text: '' };

  return {
    stage: {
      index,
      total: stages.length,
      title: active?.title ?? '',
      goal: active?.goal ?? '',
      status: active?.status ?? 'none',
      stuckCount: active?.stuckCount ?? 0,
      activeStageId: state.activeStageId ?? null,
    },
    injection: {
      registered: injection.registered,
      length: injection.length,
      text: injection.text ?? '',
    },
    // T-407 投机执行：命中率 + 待验证的预测
    speculation: {
      ...hitRate(state.runtime?.speculationStats),
      pending: state.runtime?.speculation?.guess ?? '',
    },
    // T-408 伏笔：还没回收的（词表判断收在 foreshadow.js，别在这里重复写死状态词）
    foreshadows: openForeshadows(state.outline).map((item) => item.text),
    lastJudgement: last?.judgement ?? null,
    lastAction: last?.action ?? null,
    // T-414：当前档位一行看完 —— 排查时先确认"是不是档位设错了"
    // 来源是 settings（配置页写的那份），不是聊天级状态（P1-2）
    automation: automationText(automation),
    // P2：上一轮实际发出去的注入快照 + 那一轮投机命中情况
    lastInjection: state.runtime?.lastInjection ?? null,
    lastReason: last?.reason ?? null,
    lastRaw: last?.raw ?? '',
    turn: lastTurn ?? null,
    lastReviewAt: state.runtime?.lastReviewAt ?? 0,
    cost: state.cost ?? { sessionTotal: 0, callCount: 0 },
    capabilities: capabilities ?? null,
    lastRequest: lastRequest ?? '',
    // T-411 / T-418：破限词模式与选中的酒馆预设（判据：选中后要能在这里看到生效）
    breakStatus: breakStatus ?? null,
  };
}
