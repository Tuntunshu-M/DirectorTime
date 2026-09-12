// 导演时间 · 合并判定（T-426）
//
// 站子按次计费：以前 accept 轮要发 2~3 次（JUDGE_STANCE + JUDGE_CHECKPOINT + 投机），
// 现在**一次调用**同时拿三样，三段各自解析、各自降级（规格 §3）。
//
// 两条边界：
//   1. 规则引擎能定 stance 就**不调这个**（review 先问 will.classify）—— 零成本路径保住
//   2. 哪一段坏了只降级那一段（stance→accept / judgement→hold / speculation→本轮无投机）

import { buildMessages } from '../llm/prompts.js';
import { parseDirectorResponse } from '../llm/schemas.js';
import { foreshadowText } from './foreshadow.js';

/** 合并调用的 maxTokens（规格 §3：800 → 1200，三段一起吐） */
export const COMBINED_MAX_TOKENS = 1200;

/**
 * 要不要向模型要哪几段 —— 只要不要，就不写进 prompt（省 token），也不采纳
 * @param {{ wantJudgement?: boolean, wantSpeculation?: boolean }} options
 */
function asksText({ wantJudgement = true, wantSpeculation = true } = {}) {
  const lines = ['请按上面的固定结构输出。'];
  if (!wantJudgement) lines.push('这次**不要输出 judgement 字段**（推进点判定不需要）。');
  if (!wantSpeculation) lines.push('这次**不要输出 speculation 字段**（本次不做投机）。');
  return lines.join('\n');
}

export function createCombinedJudge({ client, stages, getConnection, getOutline } = {}) {
  /**
   * 一次拿 stance + judgement + 投机段。
   * @returns {Promise<{ok:boolean, stance:string|null, confidence:number|null,
   *   judgement:object|null, speculation:object|null, ok_sections:object, raw:string, reason?:string}>}
   */
  async function judge({
    userMessage = '', charMessage = '', context = '',
    wantJudgement = true, wantSpeculation = true,
  } = {}) {
    const active = stages?.getActive?.();
    if (!active) {
      return {
        ok: false, reason: '没有进行中的阶段', raw: '',
        stance: null, confidence: null, judgement: null, speculation: null,
        ok_sections: { stance: false, judgement: false, speculation: false },
      };
    }

    const messages = buildMessages('JUDGE_COMBINED', {
      goal: active.goal ?? '',
      criteria: active.checkpoint?.criteria ?? '',
      antiCriteria: active.checkpoint?.antiCriteria ?? '',
      foreshadows: foreshadowText(getOutline?.() ?? null),
      context: context || '（没有历史对话）',
      userMessage,
      charMessage,
      asks: asksText({ wantJudgement, wantSpeculation }),
    });

    let raw = '';
    try {
      raw = await client.request({ ...getConnection?.(), messages, maxTokens: COMBINED_MAX_TOKENS, label: 'JUDGE_COMBINED' });
    } catch (error) {
      // 调用失败 = 没信息（不是"不确定"）：stance 降级 accept 让流程走下去，判定段降级 hold
      return {
        ok: false, reason: error?.message ?? '导演 API 调用失败', raw: '',
        stance: 'accept', confidence: 0, judgement: null, speculation: null,
        ok_sections: { stance: false, judgement: false, speculation: false },
        request: messages,
      };
    }

    const parsed = parseDirectorResponse(raw, 'judgeCombined') ?? {
      stance: null, confidence: null, judgement: null, speculation: null,
      ok: { stance: false, judgement: false, speculation: false },
    };

    return {
      ok: true,
      // stance 段坏掉 → 按 G5 降级 accept（拿不准就当接受，别卡住）
      stance: parsed.stance ?? 'accept',
      confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0,
      // judgement 段：要了但没解析出来 → null（调用方降级 hold，且不计入卡住）
      judgement: wantJudgement ? parsed.judgement : null,
      // 投机段：没要 / 坏了 → null（本轮无投机）
      speculation: wantSpeculation ? parsed.speculation : null,
      ok_sections: parsed.ok,
      raw,
      request: messages,
      wantJudgement,
      wantSpeculation,
    };
  }

  return { judge };
}
