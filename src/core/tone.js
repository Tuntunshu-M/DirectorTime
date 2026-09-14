// 导演时间 · 剧情占比（T-415）
//
// 日常 / 危机 / 亲密三条线，拖动任一条，另两条自动配平。
// 不变式（验收判据）：**总和恒为 100，每项都在 0~100**（不溢出、不归零）。
//
// 配平策略：被拖的那条按你给的值定死，剩下两条**按原来的比例**分剩下的份额 ——
// 用户调的是"这条占多少"，不是"把这条从三条里删掉"。

export const TONE_KEYS = ['daily', 'crisis', 'intimate'];
export const TONE_LABELS = { daily: '日常', crisis: '危机', intimate: '亲密' };
export const DEFAULT_TONE = { daily: 70, crisis: 30, intimate: 0 };

/**
 * 三条线的释义（T-415 补充，2026-09-14 用户反馈）。
 *
 * 起因：注进去的只有 `日常 70% / 危机 30%` —— **数字给了，"日常 / 危机 / 亲密"分别
 * 是什么意思全靠模型自己领会**，同一份占比在不同模型手里跑出来完全两样。
 * 现在释义作为括号小字跟着占比一起注入（用户确认的「方案 A」）。
 *
 * 文案**可改**：用户改过的存在 `state.toneHints`（只存改动的那几条），
 * 没改的走这里的内置文案；清空某条 = 该条回落内置。
 */
export const DEFAULT_TONE_HINTS = {
  daily: '平稳相处、生活流推进，不靠突发事件推剧情',
  crisis: '需要两人共同面对的压力或冲突，不为虐而虐',
  intimate: '情感或身体的靠近被明确推进一格，不跳步',
};

/** 单条释义长度上限：防手滑贴一整段进去，白烧 token */
export const TONE_HINT_MAX = 60;

/** 把用户改过的释义收拢：只认三条已知键、去空白、超长截断；空串 / 非法值一律丢掉 */
export function normalizeToneHints(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const key of TONE_KEYS) {
    const value = raw[key];
    if (typeof value !== 'string') continue;
    const text = value.trim().slice(0, TONE_HINT_MAX);
    if (text) out[key] = text;
  }
  return out;
}

/** 生效释义：内置打底，用户改过的覆盖上去（界面与注入共用这一份） */
export function toneHintsOf(raw) {
  return { ...DEFAULT_TONE_HINTS, ...normalizeToneHints(raw) };
}

function clampPercent(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(100, Math.max(0, Math.round(num)));
}

/** 把任意输入收拢成合法占比：三项整数、和恒为 100 */
export function normalizeTone(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TONE };

  const values = TONE_KEYS.map((key) => clampPercent(raw[key], 0));
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (sum === 100) {
    return Object.fromEntries(TONE_KEYS.map((key, index) => [key, values[index]]));
  }
  if (sum === 0) return { ...DEFAULT_TONE };

  // 和不是 100（老数据 / 手改过）→ 按比例缩放，最后一档吃掉舍入误差
  const scaled = values.map((value) => Math.floor((value * 100) / sum));
  const rest = 100 - scaled.reduce((acc, value) => acc + value, 0);
  scaled[TONE_KEYS.length - 1] += rest;
  return Object.fromEntries(TONE_KEYS.map((key, index) => [key, scaled[index]]));
}

/**
 * 改其中一条：定死这条，其余**没锁的**按原比例分掉剩下的；**锁住的保持不动**。
 * @param {object} tone 当前占比
 * @param {'daily'|'crisis'|'intimate'} key 被改的那条
 * @param {number} value 改到的值（0~100，越界夹住）
 * @param {{ locked?: string[] }} options 锁住的线（用户反馈：锁一条，只让其余两条配平）
 */
export function rebalanceTone(tone, key, value, { locked = [] } = {}) {
  if (!TONE_KEYS.includes(key)) return normalizeTone(tone);

  const current = normalizeTone(tone);
  // 连自己要改的这条也锁了 → 谁都不许动（总和本来就是 100）
  if (locked.includes(key)) return current;

  const others = TONE_KEYS.filter((item) => item !== key);
  const lockedOthers = others.filter((item) => locked.includes(item));
  const freeOthers = others.filter((item) => !locked.includes(item));

  // 锁住的那几条先占住自己的份额，剩下的空间才是可动的
  const lockedSum = lockedOthers.reduce((acc, item) => acc + current[item], 0);
  const room = Math.max(0, 100 - lockedSum);
  const target = Math.min(clampPercent(value, current[key]), room);

  const out = { ...current, [key]: target };
  for (const item of lockedOthers) out[item] = current[item];
  for (const item of freeOthers) out[item] = 0;

  const rest = room - target;
  if (rest <= 0 || !freeOthers.length) return out; // 锁满了 / 没得分的 → 就这样

  const total = freeOthers.reduce((acc, item) => acc + current[item], 0);
  if (!total) {
    // 可调的那几条原本都是 0（比如从 100/0/0 改下来）→ 平分，别让它们永远起不来
    const each = Math.floor(rest / freeOthers.length);
    freeOthers.forEach((item, index) => {
      out[item] = index === freeOthers.length - 1 ? rest - each * (freeOthers.length - 1) : each;
    });
    return out;
  }

  let used = 0;
  freeOthers.forEach((item, index) => {
    if (index === freeOthers.length - 1) {
      out[item] = Math.max(0, rest - used); // 余数给最后一条，保证和恒为 100
      return;
    }
    const share = Math.round((rest * current[item]) / total);
    out[item] = Math.min(rest, Math.max(0, share));
    used += out[item];
  });
  return out;
}

/**
 * 喂给 GEN_OUTLINE / EXTEND_OUTLINE 的 {{tone}}：只列开着的那些，每条带括号释义。
 * 例：`日常 70%（平稳相处、生活流推进，不靠突发事件推剧情）/ 危机 30%（…）`
 * @param {object} tone 占比
 * @param {{ hints?: object }} options 用户改过的释义（不传 = 全用内置）
 */
export function toneText(tone, { hints = null } = {}) {
  const current = normalizeTone(tone);
  const table = toneHintsOf(hints);
  return TONE_KEYS
    .filter((key) => current[key] > 0)
    .map((key) => {
      const hint = table[key];
      const head = `${TONE_LABELS[key]} ${current[key]}%`;
      return hint ? `${head}（${hint}）` : head; // 释义被清空到无（少见）→ 退回纯数字，别留空括号
    })
    .join(' / ');
}
