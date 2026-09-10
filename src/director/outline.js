// 导演时间 · 大纲生成
//
// T-203。调用导演 API 生成一份分场剧本。
// 禁则 G5：解析失败一律返回 ok:false，调用方必须降级为「本轮不动作」。

import { buildMessages } from '../llm/prompts.js';
import { parseDirectorResponse } from '../llm/schemas.js';

let seq = 0;
function nextId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** 给阶段补上运行时字段，并把第一个置为 active */
export function normalizeStages(rawStages = []) {
  return rawStages.map((stage, index) => ({
    id: nextId('st'),
    index: index + 1,
    title: stage.title ?? `阶段 ${index + 1}`,
    goal: stage.goal ?? '',
    activity: stage.activity ?? '',
    checkpoint: {
      criteria: stage.checkpoint?.criteria ?? '',
      antiCriteria: stage.checkpoint?.antiCriteria ?? '',
      confidence: typeof stage.checkpoint?.confidence === 'number' ? stage.checkpoint.confidence : 0.6,
      instruction: stage.checkpoint?.instruction ?? '',
    },
    beats: Array.isArray(stage.beats) ? stage.beats : [],
    // 第一个阶段开工，其余排队
    status: index === 0 ? 'active' : 'pending',
    stuckCount: 0,
    locked: false,
    aiOriginal: null,
  }));
}

export function createOutlineService({ client, getConnection, now = Date.now } = {}) {
  async function generate(vars = {}) {
    const connection = getConnection?.() ?? {};
    const messages = buildMessages('GEN_OUTLINE', vars);

    let text;
    try {
      text = await client.request({ ...connection, messages });
    } catch (error) {
      return { ok: false, code: error?.name ?? 'DirectorRequestError', error: error?.message ?? '导演 API 请求失败' };
    }

    const data = parseDirectorResponse(text, 'outline');
    if (!data) {
      return { ok: false, code: 'PARSE_FAILED', error: '模型返回无法解析，已放弃本轮生成', raw: text };
    }

    const stages = normalizeStages(data.stages);
    return {
      ok: true,
      outline: {
        id: nextId('ol'),
        title: data.title,
        premise: data.premise ?? vars.premise ?? '',
        tone: vars.tone ?? null,
        foreshadows: [],
        createdAt: now(),
        revision: 0,
        locked: false,
        aiOriginal: null,
      },
      stages,
    };
  }

  return { generate };
}
