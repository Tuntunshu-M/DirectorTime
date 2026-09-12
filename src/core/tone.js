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

/** 喂给 GEN_OUTLINE 的 {{tone}}：只列开着的那些 */
export function toneText(tone) {
  const current = normalizeTone(tone);
  return TONE_KEYS
    .filter((key) => current[key] > 0)
    .map((key) => `${TONE_LABELS[key]} ${current[key]}%`)
    .join(' / ');
}
