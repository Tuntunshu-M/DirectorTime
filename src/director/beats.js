// 导演时间 · 走位重写
//
// T-205 验收④：判定为 partial（部分达成）时，本场**停留但换一组走位**，
// 而不是原样重来 —— 否则同一句话再多说几遍也推不动，等于白判。
//
// 禁则 G5：解析失败一律 ok:false，调用方保持原走位，绝不注入半成品。

import { buildMessages } from '../llm/prompts.js';
import { parseDirectorResponse } from '../llm/schemas.js';

export function createBeatService({ client, getConnection } = {}) {
  /**
   * 给同一场戏重新生成走位。
   * @param {{ stage?: object, userMessage?: string, charMessage?: string, reason?: string }} input
   * @returns {Promise<{ ok: boolean, beats?: string[], error?: string, raw?: string }>}
   */
  async function rewrite({ stage, userMessage = '', charMessage = '', reason = '' } = {}) {
    if (!stage) return { ok: false, error: '没有进行中的阶段' };

    const messages = buildMessages('REWRITE_BEATS', {
      goal: stage.goal ?? '',
      criteria: stage.checkpoint?.criteria ?? '',
      beats: (stage.beats ?? []).join(' → '),
      reason,
      userMessage,
      charMessage,
    });

    let raw;
    try {
      raw = await client.request({ ...getConnection?.(), messages, maxTokens: 500, label: 'REWRITE_BEATS' });
    } catch (error) {
      return { ok: false, error: error?.message ?? '导演 API 调用失败' };
    }

    const data = parseDirectorResponse(raw, 'beats');
    if (!data) return { ok: false, error: '走位结果无法解析', raw };

    const beats = data.beats.map((beat) => String(beat).trim()).filter(Boolean);
    if (!beats.length) return { ok: false, error: '走位结果为空', raw };

    return { ok: true, beats };
  }

  return { rewrite };
}
