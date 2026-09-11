// 导演时间 · 推进点判定
//
// T-205。这一整个文件存在的核心理由，是治「完成条件太死、剧情卡住」这个老毛病。
//
// 两条铁律：
//   1. 判定按**意图**，不按字面（prompt 里已经这么要求模型了）
//   2. **置信度不足一律放行** —— 卡住比跳一步危害大得多

import { buildMessages } from '../llm/prompts.js';
import { parseDirectorResponse } from '../llm/schemas.js';

/**
 * 放行规则（项目书 §1 判定放行规则）。
 *
 * 纯函数，方便直接测试——这是全项目最该被测试覆盖的一段逻辑。
 *
 * @param {{status: string, confidence: number}} judgement
 * @param {{threshold?: number, stuckCount?: number, stuckThreshold?: number}} options
 * @returns {{action: 'advance'|'rewrite'|'retry'|'force'|'redirect', reason: string}}
 */
export function decide(judgement, options = {}) {
  const {
    threshold = 0.7,
    stuckCount = 0,
    stuckThreshold = 3,
    turnCount = 0,
    minTurns = 3,
    maxTurns = 8,
  } = options;

  const status = judgement?.status;
  const confidence = Number.isFinite(Number(judgement?.confidence))
    ? Number(judgement.confidence)
    : 0;
  // 本轮跑完是第几楼（decide 收的是本轮之前的计数）
  const playedTurns = Number(turnCount ?? 0) + 1;

  // 1. 明确违背且把握足 → 不推进，交给意愿矩阵决定让步还是坚持
  if (status === 'violated' && confidence >= threshold) {
    return { action: 'redirect', reason: '明确表达相反意图' };
  }

  // 2. 到点就走，不管聊成什么样 —— "char 带 user 走"的硬保证。
  //    **必须排在 achieved 之前**：同一轮即使达成了，动作也是 force。
  if (playedTurns >= maxTurns) {
    return { action: 'force', reason: `本场已聊满 ${maxTurns} 楼，强制推进` };
  }

  // 3. 达成：够楼数就切场；不够就先收尾（settle），不立刻切场
  if (status === 'achieved') {
    if (playedTurns >= minTurns) return { action: 'advance', reason: '意图已达成' };
    return { action: 'settle', reason: `已达成，本场还差 ${minTurns - playedTurns} 楼，先收尾` };
  }

  // 4. 把握不足 → 放行。宁可跳一步，也不要卡死
  if (confidence < threshold) {
    return { action: 'advance', reason: `置信度 ${confidence} 低于 ${threshold}，按放行处理` };
  }

  // 5. 部分达成 → 换条走位再试一次，不算失败
  if (status === 'partial') {
    return { action: 'rewrite', reason: '部分达成，重写走位再试' };
  }

  // 6. 完全没碰到，且已经卡够久 → 强制推进
  if (stuckCount + 1 >= stuckThreshold) {
    return { action: 'force', reason: `连续 ${stuckThreshold} 轮未推进，熔断` };
  }

  return { action: 'retry', reason: '尚未达成' };
}

/** 楼层节奏：阶段自己的 pacing 优先，null 时用全局 settings.pacing */
export function resolvePacing(stage, settings = {}) {
  const base = settings?.pacing ?? {};
  const own = stage?.pacing ?? {};
  const pick = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
  return {
    min: pick(own.min, pick(base.min, 3)),
    max: pick(own.max, pick(base.max, 8)),
  };
}

export function createCheckpointService({ client, stages, getConnection, getSettings } = {}) {
  /**
   * 判定当前阶段是否推进。
   * @returns {Promise<{ action: string, reason: string, judgement?: object, raw?: string }>}
   */
  async function judge({ userMessage = '', charMessage = '' } = {}) {
    const active = stages?.getActive?.();
    if (!active) return { action: 'hold', reason: '没有进行中的阶段' };

    const settings = getSettings?.() ?? {};
    const messages = buildMessages('JUDGE_CHECKPOINT', {
      goal: active.goal ?? '',
      criteria: active.checkpoint?.criteria ?? '',
      antiCriteria: active.checkpoint?.antiCriteria ?? '',
      userMessage,
      charMessage,
    });

    let raw;
    try {
      raw = await client.request({ ...getConnection?.(), messages, maxTokens: 800 });
    } catch (error) {
      // 调用失败也要放行吗？不。调用失败是「没信息」，不是「不确定」。
      // 保持不动，等下一轮再判——但不计入卡住（避免网络问题把剧情熔断）
      return { action: 'hold', reason: error?.message ?? '导演 API 调用失败' };
    }

    const judgement = parseDirectorResponse(raw, 'judgement');
    if (!judgement) {
      return { action: 'hold', reason: '判定结果无法解析', raw };
    }

    const pacing = resolvePacing(active, settings);
    const result = decide(judgement, {
      threshold: settings.confidenceThreshold ?? 0.7,
      stuckCount: active.stuckCount ?? 0,
      stuckThreshold: settings.stuckThreshold ?? 3,
      turnCount: active.turnCount ?? 0,
      minTurns: pacing.min,
      maxTurns: pacing.max,
    });

    return { ...result, judgement, raw, pacing };
  }

  return { judge, decide, resolvePacing };
}
