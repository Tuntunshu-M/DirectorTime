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

/**
 * 给阶段补上运行时字段。
 * - 新建剧本：默认第一个 active、其余 pending
 * - 续写：传 { startIndex, activateFirst: false }，序号接续、全部 pending（不动当前 active）
 */
export function normalizeStages(rawStages = [], { startIndex = 1, activateFirst = true } = {}) {
  return rawStages.map((stage, i) => ({
    id: nextId('st'),
    index: startIndex + i,
    title: stage.title ?? `阶段 ${startIndex + i}`,
    goal: stage.goal ?? '',
    activity: stage.activity ?? '',
    checkpoint: {
      criteria: stage.checkpoint?.criteria ?? '',
      antiCriteria: stage.checkpoint?.antiCriteria ?? '',
      confidence: typeof stage.checkpoint?.confidence === 'number' ? stage.checkpoint.confidence : 0.6,
      instruction: stage.checkpoint?.instruction ?? '',
    },
    beats: Array.isArray(stage.beats) ? stage.beats : [],
    // 第一个阶段开工，其余排队（续写时全排队）
    status: activateFirst && i === 0 ? 'active' : 'pending',
    // T-416：楼层节奏（null = 用全局 settings.pacing）
    pacing: stage.pacing ?? null,
    turnCount: 0,
    // T-405：本场单独的意愿权重（null = 用全局 settings.will）
    will: stage.will ?? null,
    // T-417 才填，先占位
    initiative: '',
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
      request: messages,
      outline: {
        id: nextId('ol'),
        title: data.title,
        premise: data.premise ?? vars.premise ?? '',
        // T-416：主目标 + 来源（用户指定 / AI 构思），续写时必须带上
        objective: data.objective,
        objectiveSource: vars.objective ? 'user' : 'ai',
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

  /**
   * 续写后续阶段（滚动剧本）：接着已经演过的剧情往下写，
   * 让"待演阶段"始终有存货，不会演到没戏。
   */
  async function extend({
    count = 2,
    startIndex = 1,
    outline: currentOutline = null,
    objective = '',
    history = '',
    tone = '',
    profile = '',
    world = '',
    context = '',
  } = {}) {
    const connection = getConnection?.() ?? {};
    const messages = buildMessages('EXTEND_OUTLINE', {
      count,
      title: currentOutline?.title ?? '',
      premise: currentOutline?.premise ?? '',
      // T-416：续写必须带主目标，否则续着续着就跑偏
      objective: objective || currentOutline?.objective || '',
      tone,
      profile,
      world,
      history,
      context,
    });

    let text;
    try {
      text = await client.request({ ...connection, messages });
    } catch (error) {
      return { ok: false, code: error?.name ?? 'DirectorRequestError', error: error?.message ?? '导演 API 请求失败' };
    }

    const data = parseDirectorResponse(text, 'stages');
    if (!data) {
      return { ok: false, code: 'PARSE_FAILED', error: '续写结果无法解析，本轮不改剧本', raw: text };
    }

    return {
      ok: true,
      request: messages,
      stages: normalizeStages(data.stages, { startIndex, activateFirst: false }),
    };
  }

  return { generate, extend };
}
