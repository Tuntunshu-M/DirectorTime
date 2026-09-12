// 导演时间 · 投机执行（T-407）
//
// 不等 user 开口，先猜他下一句会说什么，并**提前把这一轮该怎么演的指令写好**。
// 猜中就用（省一次真实往返），猜不中**静默降级**回常规剧本 —— 用户全程无感。
//
// 两条纪律：
//   1. 投机是"提前做功课"，任何失败都必须静默（不弹提示、不写聊天记录、不注入半成品）
//   2. 命中判定必须是本地纯函数 —— 为了判断"猜没猜中"再花一次 API 就本末倒置了

import { buildMessages } from '../llm/prompts.js';
import { parseDirectorResponse, normalizeSpeculationKeywords } from '../llm/schemas.js';

/** 相似度阈值：到这个数才算猜中 */
export const SIMILARITY_HIT = 0.5;

const PUNCTUATION = /[\s，。！？；：、,.!?;:…—～·「」『』【】（）()"'“”‘’]/g;

/** 归一化：去标点空白、转小写 */
export function normalizeLine(text) {
  return String(text ?? '').replace(PUNCTUATION, '').toLowerCase();
}

function bigrams(text) {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
  return set;
}

/** 字符二元组 Dice：连续片段的相似度 */
function dice(x, y) {
  const left = bigrams(x);
  const right = bigrams(y);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/** 较短那句有几个字出现在较长那句里（多重集，避免同字重复计数） */
function charOverlap(x, y) {
  const short = x.length <= y.length ? x : y;
  const pool = [...(x.length <= y.length ? y : x)];
  if (!short.length) return 0;
  let hit = 0;
  for (const ch of short) {
    const at = pool.indexOf(ch);
    if (at !== -1) {
      hit += 1;
      pool.splice(at, 1);
    }
  }
  return hit / short.length;
}

/**
 * 相似度：够用、便宜、可解释。
 * 中文换几个虚词意思没变（"好，我们走吧" vs "好，走吧"），所以除了连续片段，
 * 还要看"字基本重合"。
 */
export function similarity(a, b) {
  const x = normalizeLine(a);
  const y = normalizeLine(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // 一句把另一句包住（"我不想去" vs "我不想去啊"）
  if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return 0.9;

  const byChar = Math.min(x.length, y.length) >= 2 && charOverlap(x, y) >= 0.8 ? charOverlap(x, y) * 0.9 : 0;
  return Math.max(dice(x, y), byChar);
}

/**
 * 这条实际输入有没有落在投机预测上。
 *
 * 预测是**意图级**的（"user 会拒绝并转移话题"），拿它跟原话做字符串相似度几乎永远不中，
 * 所以命中判定有两条路：
 *   1. 实际输入里出现了预测给的 keywords（主力）
 *   2. 跟 guess 本身够像（只对"猜得比较具体"的情况有效）
 */
export function isHit(speculation, userMessage) {
  if (!speculation) return false;
  const message = String(userMessage ?? '');
  if (!message.trim()) return false;

  for (const word of speculation.keywords ?? []) {
    const keyword = String(word ?? '').trim();
    if (keyword && message.includes(keyword)) return true;
  }

  if (!speculation.guess) return false;
  return similarity(speculation.guess, message) >= SIMILARITY_HIT;
}

/** 命中率（Debug 用） */
export function hitRate(stats) {
  const hits = Number(stats?.hits ?? 0);
  const misses = Number(stats?.misses ?? 0);
  const total = hits + misses;
  return { hits, misses, total, rate: total ? hits / total : 0 };
}

export function createSpeculationService({ client, getConnection, store, now = Date.now } = {}) {
  /** T-426：本轮投机是不是随合并调用一起回来的 */
  let combinedTaken = false;

  /**
   * 猜下一句 + 提前写好针对性指令。返回 null 表示这次不投机（静默）。
   */
  async function guess({ stage, outline, userMessage = '', charMessage = '' } = {}) {
    if (!stage?.id) return null;

    const messages = buildMessages('SPECULATE_NEXT', {
      objective: outline?.objective ?? '',
      goal: stage.goal ?? '',
      activity: stage.activity ?? '',
      beats: (stage.beats ?? []).join(' → '),
      userMessage,
      charMessage,
    });

    let raw;
    try {
      raw = await client.request({ ...getConnection?.(), messages, maxTokens: 400, label: 'SPECULATE_NEXT' });
    } catch {
      return null; // 静默
    }

    const data = parseDirectorResponse(raw, 'speculation');
    if (!data?.injection) return null; // 解析不了就当没猜 —— 静默

    const record = {
      guess: data.guess ?? '',
      keywords: normalizeSpeculationKeywords(data.keywords),
      injection: data.injection,
      at: now(),
      stageId: stage.id,
    };
    store?.update?.((draft) => ({
      ...draft,
      runtime: { ...draft.runtime, speculation: record },
    }), { track: false });

    return { ...record, request: messages, raw };
  }

  /**
   * 结算：实际输入有没有猜中，并计入命中率、清掉投机结果。
   * 降级由调用方完成（重新注册常规注入），这里只负责记账。
   */
  function settle(userMessage) {
    const current = store?.get?.()?.runtime?.speculation ?? null;
    if (!current) return { hit: false, speculation: null };

    const hit = isHit(current, userMessage);
    store?.update?.((draft) => {
      const stats = draft.runtime?.speculationStats ?? { hits: 0, misses: 0 };
      return {
        ...draft,
        runtime: {
          ...draft.runtime,
          speculation: null,
          speculationStats: hit
            ? { ...stats, hits: (stats.hits ?? 0) + 1 }
            : { ...stats, misses: (stats.misses ?? 0) + 1 },
        },
      };
    }, { track: false });

    return { hit, speculation: current };
  }

  /**
   * T-426：合并判定顺手带回来的投机段，直接存下来 —— 不再单独发一次投机调用。
   * 没 injection（模型没给 / 解析失败）就当没有，静默。
   */
  function accept({ guess: rawGuess, keywords, injection, stage } = {}) {
    const text = String(injection ?? '').trim();
    if (!text) return null;

    const record = {
      guess: String(rawGuess ?? ''),
      keywords: normalizeSpeculationKeywords(keywords),
      injection: text,
      at: now(),
      stageId: stage?.id ?? '',
    };
    store?.update?.((draft) => ({
      ...draft,
      runtime: { ...draft.runtime, speculation: record },
    }), { track: false });
    combinedTaken = true;
    return record;
  }

  /** 本轮投机是不是"搭车"来的 —— 是的话调用方就别再单独发投机调用了 */
  function consumeCombined() {
    const flag = combinedTaken;
    combinedTaken = false;
    return flag;
  }

  return { guess, settle, accept, consumeCombined };
}
