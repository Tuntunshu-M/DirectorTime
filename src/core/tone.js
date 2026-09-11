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
 * 拖动其中一条：定死这条，另两条按原比例分掉剩下的。
 * @param {object} tone 当前占比
 * @param {'daily'|'crisis'|'intimate'} key 被拖的那条
 * @param {number} value 拖到的值（0~100，越界会被夹住）
 */
export function rebalanceTone(tone, key, value) {
  if (!TONE_KEYS.includes(key)) return normalizeTone(tone);

  const current = normalizeTone(tone);
  const target = clampPercent(value, current[key]);
  const others = TONE_KEYS.filter((item) => item !== key);
  const rest = 100 - target;

  const out = { ...current, [key]: target };
  if (!rest) {
    for (const other of others) out[other] = 0;
    return out;
  }

  const total = others.reduce((acc, other) => acc + current[other], 0);
  if (!total) {
    // 另两条原本都是 0（比如从 100/0/0 拖下来）→ 平分，别让它们永远起不来
    const half = Math.floor(rest / 2);
    out[others[0]] = half;
    out[others[1]] = rest - half;
    return out;
  }

  const first = Math.round((rest * current[others[0]]) / total);
  out[others[0]] = Math.min(rest, Math.max(0, first));
  out[others[1]] = rest - out[others[0]]; // 余数给第二条，保证和恒为 100
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
