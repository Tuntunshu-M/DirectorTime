// 导演时间 · 响应解析与校验
//
// T-202。禁则 G5：JSON 解析失败一律返回 null，调用方必须降级为「本轮不动作」，
// 绝不能把解析不出来的东西注入进 prompt。

import { extractPlot } from './break-filter.js';
import { extractField, extractNumberField, extractStringField, firstJsonObject } from './sections.js';

/** 从模型返回文本里抠出 JSON。兼容纯 JSON、```json 代码块、前后夹带废话三种情况。 */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  const trimmed = text.trim();

  // 1. 直接就是 JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试 */
  }

  // 2. ```json ... ``` 代码块
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* 继续尝试 */
    }
  }

  // 3. 截取第一个 { 到最后一个 }（模型爱在前后加话）
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* 落入失败 */
    }
  }

  return null;
}

const VALID_STATUSES = ['achieved', 'partial', 'pending', 'violated'];
const VALID_STANCES = ['accept', 'reject', 'hesitate', 'irrelevant', 'redirect'];

/** 单个阶段的结构校验：goal + checkpoint 正反条件必填 */
export function isValidStage(stage) {
  if (!stage || typeof stage !== 'object') return false;
  if (typeof stage.goal !== 'string' || !stage.goal.trim()) return false;
  if (!stage.checkpoint || typeof stage.checkpoint !== 'object') return false;
  // antiCriteria 是硬性要求：没有反向判定就会掉进灰色死循环
  if (typeof stage.checkpoint.criteria !== 'string' || !stage.checkpoint.criteria.trim()) return false;
  if (typeof stage.checkpoint.antiCriteria !== 'string' || !stage.checkpoint.antiCriteria.trim()) return false;
  return true;
}

export function isValidOutline(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.title !== 'string' || !data.title.trim()) return false;
  // 主目标是 T-416 的硬要求：缺了就没有"所有阶段服务于它"这条约束
  if (typeof data.objective !== 'string' || !data.objective.trim()) return false;
  if (!Array.isArray(data.stages) || data.stages.length === 0) return false;
  return data.stages.every(isValidStage);
}

/** 续写阶段：只有 stages，没有 title */
export function isValidStages(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.stages) || data.stages.length === 0) return false;
  return data.stages.every(isValidStage);
}

export const PROFILE_REQUIRED_FIELDS = ['coreDesire', 'fear', 'speech', 'attitudeToUser',
  'conflictStyle', 'proactivity', 'intimacy', 'taboo'];

/**
 * 人物侧写八字段（T-402）。
 *
 * ⚠️ 修正：**不再要求八项全非空**。实测模型经常会留一两项写不出来（比如"亲密表达"对一个
 * 不涉及亲密的角色就是空的），全非空的门槛会把整份侧写判死 —— 界面表现为"生成成功但一片空白"。
 * 现在只要有 >= 4 项写出了内容就算合格，缺的按空字符串存下来（用户可以在面板上补）。
 */
export const PROFILE_MIN_FIELDS = 4;

export function isValidProfile(data) {
  if (!data || typeof data !== 'object') return false;
  const filled = PROFILE_REQUIRED_FIELDS.filter((key) => typeof data[key] === 'string' && data[key].trim());
  return filled.length >= PROFILE_MIN_FIELDS;
}

export const CAST_NAME_MAX = 20;
export const CAST_EVIDENCE_MAX = 120;

/**
 * **T-438 §3**：侧写那次调用**顺带**返回的候选角色（可选字段 `cast`）。
 *
 * 容错是硬要求（G5）：这一段坏了**绝不能连坐侧写本身** —— 所以本函数**永不抛**，
 * 拿不到合法数组就返回 `[]`，侧写照常写入。
 *
 * 形状：`[{ name, aliases: string[], confidence: number|null, evidence: string }]`
 * （`aliases` 是旧版 just-do-it-char 的精华：花名/代号归到同一个人身上）
 */
export function normalizeCastList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    // 模型偶尔会偷懒返回 ["裴玉", "Lobo"] —— 字符串也认
    const source = typeof item === 'string' ? { name: item } : item;
    if (!source || typeof source !== 'object') continue;

    const name = String(source.name ?? '').trim().slice(0, CAST_NAME_MAX);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);

    const aliases = [...new Set((Array.isArray(source.aliases) ? source.aliases : [])
      .map((alias) => String(alias ?? '').trim().slice(0, CAST_NAME_MAX))
      .filter((alias) => alias && alias.toLowerCase() !== key))];

    const rawConfidence = Number(source.confidence);
    const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : null;

    out.push({
      name,
      aliases,
      confidence,
      evidence: String(source.evidence ?? '').trim().slice(0, CAST_EVIDENCE_MAX),
    });
  }
  return out;
}

/** 一致性自检：{ ok: boolean, reason: string }（T-402 §六） */
export function isValidConsistency(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.ok !== 'boolean') return false;
  return typeof data.reason === 'string';
}

/** 走位重写：{ beats: ["..."] }（T-205 验收④） */
export function isValidBeats(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.beats) || data.beats.length === 0) return false;
  return data.beats.every((beat) => typeof beat === 'string' && beat.trim());
}

/** 主动性：{ initiative: "..." }（T-417；允许空字符串 = 没侧写、不生成） */
export function isValidInitiative(data) {
  return Boolean(data) && typeof data === 'object' && typeof data.initiative === 'string';
}

/** 投机预测：{ guess, injection }（T-407；injection 必须有，否则这次投机作废） */
export function isValidSpeculation(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.guess !== 'string') return false;
  // keywords 可选：意图级预测要配"可能出现的词"，命中判定才不会永远失手
  return typeof data.injection === 'string' && data.injection.trim().length > 0;
}

/** 投机预测里的关键词（洗净、去空、去重，最多 6 个） */
export function normalizeSpeculationKeywords(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const word = String(item ?? '').trim();
    if (word && !out.includes(word)) out.push(word);
    if (out.length >= 6) break;
  }
  return out;
}

export function isValidJudgement(data) {
  if (!data || typeof data !== 'object') return false;
  if (!VALID_STATUSES.includes(data.status)) return false;
  const confidence = Number(data.confidence);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

export function isValidStance(data) {
  if (!data || typeof data !== 'object') return false;
  if (!VALID_STANCES.includes(data.stance)) return false;
  const confidence = Number(data.confidence);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

/**
 * T-426：合并调用的分段解析。
 *
 * 两档：
 *   1. 整份 JSON 能解析 → 逐段校验（正常路径）
 *   2. 整份坏了 / 被截断 → 按字段名单独抠，**每段独立降级**（规格 §3）
 * 返回里 `ok` 逐段标出哪一段拿到了 —— 调用方按段决定怎么降级。
 */
export function parseJudgeCombined(text) {
  const raw = String(text ?? '');
  const whole = firstJsonObject(extractPlot(raw));

  /**
   * 取某一段：优先用"整份解析"的结果；整份坏了 / 那个键不在里面 → 单独抠。
   * （注意：整份坏掉时 firstJsonObject 可能只抓到某个内层对象，这时必须回退到逐字段抠）
   */
  const pick = (key) => {
    const fromWhole = whole && typeof whole === 'object' ? whole[key] : undefined;
    if (fromWhole !== undefined && fromWhole !== null) return fromWhole;
    return extractField(raw, key);
  };

  const stanceValue = extractStringField(raw, 'stance');
  const stance = VALID_STANCES.includes(stanceValue) ? stanceValue : null;
  const confidence = extractNumberField(raw, 'confidence');

  const judgementRaw = pick('judgement');
  const speculationRaw = pick('speculation');
  // whole 里的 judgement 可能是对象；逐段校验统一交给已有的校验函数
  const judgementData = judgementRaw && typeof judgementRaw === 'object' ? judgementRaw : null;
  const speculationData = speculationRaw && typeof speculationRaw === 'object' ? speculationRaw : null;

  const judgement = isValidJudgement(judgementData) ? judgementData : null;
  const speculation = isValidSpeculation(speculationData) ? speculationData : null;

  // 最后一道：推测段缺 keywords 也照样能用（命中判定会退化成相似度）
  return {
    stance,
    confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
    judgement,
    speculation,
    ok: {
      stance: Boolean(stance),
      judgement: Boolean(judgement),
      speculation: Boolean(speculation),
    },
    raw,
  };
}

/**
 * 统一入口：解析 + 校验。任何一步失败都返回 null。
 * @param {string} text 模型返回的原始文本
 * @param {'outline'|'stages'|'beats'|'profile'|'consistency'|'judgement'|'stance'|'initiative'|'speculation'|'judgeCombined'} kind
 */
export function parseDirectorResponse(text, kind) {
  // T-426：合并调用**不能**走"整份解析失败就全没"的路 —— 它要分段独立降级
  if (kind === 'judgeCombined') return parseJudgeCombined(text);

  // T-411 清洗：开了破限词时模型会把剧情包进 <plot>…</plot>，标签外（可能混着破限指令残渣）一律丢弃
  const data = extractJson(extractPlot(text));
  if (data === null) return null;

  if (kind === 'outline') return isValidOutline(data) ? data : null;
  if (kind === 'stages') return isValidStages(data) ? data : null;
  if (kind === 'beats') return isValidBeats(data) ? data : null;
  if (kind === 'profile') return isValidProfile(data) ? data : null;
  if (kind === 'consistency') return isValidConsistency(data) ? data : null;
  if (kind === 'initiative') return isValidInitiative(data) ? data : null;
  if (kind === 'speculation') return isValidSpeculation(data) ? data : null;
  if (kind === 'judgement') return isValidJudgement(data) ? data : null;
  if (kind === 'stance') return isValidStance(data) ? data : null;

  return data;
}
