// 导演时间 · 用户意愿矩阵（T-405 / M12，含强制爱开关）
//
// 剧本有自己想去的方向，user 也有自己的想法。冲突时听谁的？Will 就是这个旋钮。
//   T-416 管「char 往哪走」（主动性），T-405 管「user 反对时 char 怎么反应」（让步）。
//
// 两个输入：
//   Will   用户意愿权重 0~100（设置项默认 80；阶段自己的 will 优先）
//   Stance user 这一句的态度（JUDGE_STANCE：accept / hesitate / reject / irrelevant / redirect）
//
// 强制爱（原 T-419）是 Will 的一个覆盖模式：开了之后只覆盖"口头拒绝"这一种情况，
// 硬禁区、总开关、其它 stance 一律不覆盖（规格 §七）。
//
// 四条纪律：
//   1. resolve() 是纯函数，5 种 stance × 3 档 will 共 15 个组合全部可测
//   2. 决策表用查表结构，不写 if-else 堆（以后改表不改逻辑）
//   3. 拿不准 user 什么态度时按 accept 处理 —— 宁可推进，也不卡住
//   4. 动作名统一用 rewrite（retry 已并入，拍板 c）

import { buildMessages } from '../llm/prompts.js';
import { parseDirectorResponse } from '../llm/schemas.js';
import { judgeByRules } from './rules.js';

export const DEFAULT_WILL = 80;
export const WILL_LOW_MAX = 33; // 0~33   剧情优先
export const WILL_MID_MAX = 66; // 34~66  平衡；67~100 user 优先
export const CONFIDENCE_FLOOR = 0.7;

/** 0~100 → 三档（不引入第四档） */
export function willTier(will) {
  const value = Number(will);
  const num = Number.isFinite(value) ? value : DEFAULT_WILL;
  if (num <= WILL_LOW_MAX) return 'low';
  if (num <= WILL_MID_MAX) return 'mid';
  return 'high';
}

/** 决策表（规格 §三）：先查 stance 那一行，再按 Will 档位取动作 */
const ACTIONS = {
  accept: { low: 'advance', mid: 'advance', high: 'advance' },
  hesitate: { low: 'advance', mid: 'hold', high: 'hold' },
  // 低 = 坚持一次（换个说法再试，算 rewrite 不算让）；中 = 让步作废本场；高 = 让步 + 重生成后续
  reject: { low: 'rewrite', mid: 'drop', high: 'regenAfter' },
  irrelevant: { low: 'hold', mid: 'hold', high: 'follow' },
  redirect: { low: 'hold', mid: 'hold', high: 'regenAfter' },
};

const REASONS = {
  accept: {
    low: 'user 接受当前方向，正常推进',
    mid: 'user 接受当前方向，正常推进',
    high: 'user 接受当前方向，正常推进',
  },
  hesitate: {
    low: 'user 有点犹豫，顺势轻推一把给个台阶',
    mid: 'user 犹豫，本场停留一轮给台阶',
    high: 'user 犹豫，停留等 user 明确表态',
  },
  reject: {
    low: 'user 反对，先换个说法再试一次',
    mid: 'user 反对，让步、作废本场',
    high: 'user 强烈反对，让步、作废本场并重生成后续',
  },
  irrelevant: {
    low: 'user 聊别的，跟一楼再把话题拉回本场',
    mid: 'user 聊别的，跟两楼再把话题拉回本场',
    high: 'user 优先，跟着走不硬拉（剧情暂停）',
  },
  redirect: {
    low: 'user 想改方向，先记下，本场演完再说',
    mid: 'user 想改方向，本场演完，下一场转向',
    high: 'user 优先，立即转向并重生成后续',
  },
};

/**
 * 意愿矩阵：stance × Will 档位 → 动作。纯函数，不碰状态、不调 API。
 *
 * @param {{stance?: string, confidence?: number, will?: number, stuckCount?: number,
 *          stuckThreshold?: number, forceAffection?: boolean, violated?: boolean}} input
 * @param {boolean} [input.violated] 本轮是否触及硬禁区（来自 T-205 判定；强制爱不覆盖它）
 * @returns {{action: string, reason: string, tier: string, stance: string, floored: boolean, forced: boolean}}
 */
export function resolve({
  stance,
  confidence,
  will,
  stuckCount = 0,
  stuckThreshold = 3,
  forceAffection = false,
  violated = false,
} = {}) {
  const raw = Number(confidence);
  const normalized = Number.isFinite(raw) ? raw : 0;
  // 置信度不足 / stance 不认识 → 一律按 accept 处理（放行，不卡住）
  const floored = normalized < CONFIDENCE_FLOOR;
  const effective = floored || !ACTIONS[stance] ? 'accept' : stance;
  const tier = willTier(will);
  const base = { tier, stance: effective, floored, forced: false, confidence: normalized };

  // 1) 熔断优先：不管 Will 多高、也不管强制爱开没开，卡住达阈值就强制推进（防死锁）
  if (Number(stuckCount) + 1 >= Number(stuckThreshold)) {
    return { ...base, action: 'advance', reason: `连续 ${stuckThreshold} 轮未推进，熔断（不看 Will）` };
  }

  // 2) 强制爱：只覆盖"口头拒绝" —— 不让步、继续推进本场；硬禁区命中时不被覆盖（§七）
  if (forceAffection && effective === 'reject' && !violated) {
    return { ...base, action: 'hold', reason: '强制爱：不让步，继续推进本场', forced: true };
  }

  // 3) reject 低档：先坚持一次（换个说法再试），**已拒过一次才让步**（不是死扛）
  if (effective === 'reject' && tier === 'low') {
    if (Number(stuckCount) >= 1) {
      return { ...base, action: 'drop', reason: 'user 再次拒绝，让步、作废本场' };
    }
    return { ...base, action: 'rewrite', reason: REASONS.reject.low };
  }

  return { ...base, action: ACTIONS[effective][tier], reason: REASONS[effective][tier] };
}

/**
 * 拍板 (b)：只有 accept（含置信不足的放行）才去跑推进点判定；
 * 其它 stance 一律就地执行矩阵动作、本轮结束 —— 这样 rewrite 天然被包含，以后加动作也不会漏。
 */
export function shouldRunCheckpoint(decision) {
  return !decision || decision.stance === 'accept';
}

export function createWillService({ client, getConnection, getRules } = {}) {
  /**
   * 判 user 这一句的态度。
   * 顺序（T-406）：**先本地规则，够准就不花 API；不够准再问 JUDGE_STANCE**。
   * 调用失败 / 解析失败一律降级为 accept：拿不准就当接受，让流程照常走推进点判定（禁则 G5）。
   */
  async function judge({ stage, userMessage = '' } = {}) {
    if (!stage) return { ok: false, stance: 'accept', confidence: 0, reason: '没有进行中的阶段' };

    // 1) 规则引擎（本地、免费、不会解析失败）
    const local = judgeByRules(userMessage, getRules?.() ?? null);
    if (!local.needsLlm && local.stance) {
      return {
        ok: true,
        source: 'rules',
        stance: local.stance,
        confidence: local.confidence,
        matched: local.matched,
      };
    }

    // 2) 规则不够准 → 老实交给 LLM（复用已有的 JUDGE_STANCE，不新写 prompt）
    const messages = buildMessages('JUDGE_STANCE', {
      goal: stage.goal ?? '',
      userMessage,
    });

    let raw;
    try {
      raw = await client.request({ ...getConnection?.(), messages, maxTokens: 300 });
    } catch (error) {
      return { ok: false, stance: 'accept', confidence: 0, reason: error?.message ?? '导演 API 调用失败', rule: local };
    }

    const data = parseDirectorResponse(raw, 'stance');
    if (!data) {
      return { ok: false, stance: 'accept', confidence: 0, reason: '态度判定无法解析，按接受处理', raw, rule: local };
    }

    return {
      ok: true,
      source: 'llm',
      stance: data.stance,
      confidence: data.confidence,
      raw,
      rule: local,
    };
  }

  return { judge };
}
