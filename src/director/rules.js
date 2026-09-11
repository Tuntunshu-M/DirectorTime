// 导演时间 · 规则引擎（T-406）
//
// 判 user 的态度（stance）**先走本地规则，不够准再问 LLM**（JUDGE_STANCE）。
// 省钱是次要收益，真正的价值是：快（不用等 API）、稳（不会返回解析不了的 JSON）、
// 可调（词库是白盒，用户觉得"凭什么这句算拒绝"，加个词就行）。
//
// 一条纪律：**规则引擎是 LLM 的前置，不是替代** —— 判定不了就老实交给 LLM，不硬猜。
//
// 只判态度，不管动作（动作是 T-405 决策表的事）；
// 也不碰推进点判定（那是 checkpoint.js 的事：它判"戏演完没"）。

import { createDefaultRules } from '../core/default-state.js';

export const CONFIDENCE_THRESHOLD = 0.7;
/** 否定词的管辖范围：其后 6 个字（规格 §五） */
export const NEGATION_WINDOW = 6;
/** 标点切断否定的管辖范围："不，我不去" 里的「不」管不到后一句 */
const PUNCTUATION = /[，。！？；：、,.!?;:\s…—～·「」『』【】（）()"'“”‘’]/;

const CONF = {
  strongSolo: 0.9,
  strongMulti: 0.95,
  conflict: 0.3,
  weakOnly: 0.5,
  flipped: 0.75,
  irrelevantOnly: 0.85,
  none: 0,
};

/** 统一成 { word, stance }；兼容纯字符串写法（否定词 / 转向词库） */
function toEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (typeof item === 'string' ? { word: item } : { word: item?.word, stance: item?.stance }))
    .filter((entry) => typeof entry.word === 'string' && entry.word.length > 0);
}

/** 同名去重：**后者覆盖前者**，所以用户自定义词能盖掉默认词（判据 6） */
function dedupeByWord(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = entry.word;
    if (map.has(key)) map.delete(key);
    map.set(key, entry);
  }
  return [...map.values()];
}

/**
 * 解析生效词库：没配的库用默认值；配了（哪怕是空数组）就以用户的为准 ——
 * 所以用户能把某个库清空，此时规则引擎什么都不判，老实转 LLM（判据 4）。
 */
export function resolveRules(custom) {
  const base = createDefaultRules();
  if (!custom || typeof custom !== 'object') return base;
  const pick = (key) => (Array.isArray(custom[key]) ? dedupeByWord(toEntries(custom[key])) : base[key]);
  return {
    strong: pick('strong'),
    weak: pick('weak'),
    negation: pick('negation'),
    irrelevant: pick('irrelevant'),
  };
}

/** 找出全部命中（同一次出现也算多个词命中），长词优先、去重叠 */
function collect(text, entries, kind) {
  const hits = [];
  for (const entry of entries) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(entry.word, from);
      if (at === -1) break;
      hits.push({ word: entry.word, stance: entry.stance ?? null, kind, start: at, end: at + entry.word.length });
      from = at + 1;
    }
  }
  return hits;
}

function dropOverlaps(hits) {
  const sorted = [...hits].sort((a, b) => (a.start - b.start) || (b.end - a.end));
  const kept = [];
  for (const hit of sorted) {
    if (kept.some((other) => hit.start < other.end && other.start < hit.end)) continue;
    kept.push(hit);
  }
  return kept;
}

function firstPunctuation(text, from, to) {
  for (let i = from; i < to; i += 1) {
    if (PUNCTUATION.test(text[i])) return i;
  }
  return to;
}

function flip(stance) {
  if (stance === 'accept') return 'reject';
  if (stance === 'reject') return 'accept';
  return stance;
}

/**
 * 否定反转（规格 §五，本任务最难的一块）。
 * 命中否定词后在其后 6 个字的窗口内找情感词：找到就反转它；
 * 窗口里若还有**在它之前**的否定词（"不不"这种链），反转次数 +1（双重否定 = 肯定）。
 * @returns {number} 发生过反转的情感词个数
 */
function applyNegation(text, hits, negations) {
  // 注意：negations 可能是纯字符串列表（默认词库）也可能是 { word } 对象，toEntries 都认
  const negs = dropOverlaps(collect(text, toEntries(negations), 'negation'));
  let flippedCount = 0;

  for (const neg of negs) {
    const limit = Math.min(text.length, neg.end + NEGATION_WINDOW);
    const stop = firstPunctuation(text, neg.end, limit);
    // 窗口内第一个还没被反转过的情感词
    const target = hits.find((hit) => !hit.flipped && hit.start >= neg.end && hit.start < stop);
    if (!target) continue; // 窗口里没有情感词 → 这个否定词不计入（可能只是"不对"这种无关用法）
    const chain = negs.filter((other) => other.start > neg.start && other.end <= target.start).length;
    if ((1 + chain) % 2 === 1) {
      target.stance = flip(target.stance);
      target.flipped = true;
      flippedCount += 1;
    }
  }

  return flippedCount;
}

/**
 * 规则判定。纯函数：不改入参、不碰外部状态（判据 5）。
 * @returns {{stance: string|null, confidence: number, needsLlm: boolean,
 *            flipped: number, matched: Array<{word: string, stance: string, kind: string}>}}
 */
export function judgeByRules(text, rules) {
  const input = typeof text === 'string' ? text : '';
  const lib = resolveRules(rules);
  const strong = dropOverlaps(collect(input, lib.strong, 'strong'));
  const weak = dropOverlaps(collect(input, lib.weak, 'weak'));
  const irrelevant = dropOverlaps(collect(input, lib.irrelevant, 'irrelevant'));
  const emotion = [...strong, ...weak].sort((a, b) => a.start - b.start);
  const flipped = applyNegation(input, emotion, lib.negation);

  const matched = [...emotion, ...irrelevant]
    .sort((a, b) => a.start - b.start)
    .map(({ word, stance, kind }) => ({ word, stance, kind }));
  const base = { flipped, matched };

  // 强词 + 转向词同时命中 = 态度自相矛盾（"好啊，不过我有点怕"），别猜
  if (strong.length && irrelevant.length) {
    return { ...base, stance: strong[0].stance, confidence: CONF.conflict, needsLlm: true };
  }

  if (strong.length) {
    const stances = new Set(strong.map((hit) => hit.stance));
    if (stances.size > 1) {
      // 强词冲突（accept 和 reject 都有）→ 转 LLM
      return { ...base, stance: strong[0].stance, confidence: CONF.conflict, needsLlm: true };
    }
    const confidence = flipped > 0
      ? Math.min(strong.length >= 2 ? CONF.strongMulti : CONF.strongSolo, CONF.flipped)
      : (strong.length >= 2 ? CONF.strongMulti : CONF.strongSolo);
    return { ...base, stance: strong[0].stance, confidence, needsLlm: confidence < CONFIDENCE_THRESHOLD };
  }

  if (weak.length) {
    // 弱词本来就模糊，硬拔高置信度等于让规则在不确定时拍板 —— 那还不如直接问 LLM
    const stances = new Set(weak.map((hit) => hit.stance));
    return {
      ...base,
      stance: stances.size === 1 ? weak[0].stance : null,
      confidence: CONF.weakOnly,
      needsLlm: true,
    };
  }

  if (irrelevant.length) {
    return { ...base, stance: 'irrelevant', confidence: CONF.irrelevantOnly, needsLlm: false };
  }

  return { ...base, stance: null, confidence: CONF.none, needsLlm: true };
}
