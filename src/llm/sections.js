// 导演时间 · 分段解析的小工具（T-426）
//
// 合并调用一次返回三段。**一段坏掉不能毒死整份**（规格 §3），
// 所以除了"整份 JSON 能不能解析"，还要能从半坏 / 被截断的文本里，
// 单独把某一段抠出来 —— 这里就是那套"抠"的工具（纯函数，不依赖 schemas，避免循环引用）。

const WS = /\s/;

function skipWs(text, index) {
  let i = index;
  while (i < text.length && WS.test(text[i])) i += 1;
  return i;
}

function safeParse(slice) {
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

/**
 * 从 startIndex 起抠出一个**平衡**的 JSON 值（对象 / 数组 / 字符串 / 数字）。
 * 遇到没闭合的（比如输出被截断）就返回 null —— 这一段降级，其它段不受影响。
 * @returns {{ value: any, end: number }}
 */
export function extractBalanced(text, startIndex = 0) {
  const raw = String(text ?? '');
  const start = skipWs(raw, startIndex);
  if (start >= raw.length) return { value: null, end: start };

  const ch = raw[start];

  if (ch === '{' || ch === '[') {
    const open = ch;
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i += 1) {
      const c = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) return { value: safeParse(raw.slice(start, i + 1)), end: i + 1 };
      }
    }
    return { value: null, end: raw.length }; // 没闭合：这段算坏，别影响别人
  }

  if (ch === '"') {
    let escaped = false;
    for (let i = start + 1; i < raw.length; i += 1) {
      const c = raw[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') return { value: safeParse(raw.slice(start, i + 1)), end: i + 1 };
    }
    return { value: null, end: raw.length };
  }

  const number = /^-?\d+(?:\.\d+)?/.exec(raw.slice(start));
  if (number) return { value: Number(number[0]), end: start + number[0].length };

  const literal = /^(true|false|null)/.exec(raw.slice(start));
  if (literal) {
    return { value: { true: true, false: false, null: null }[literal[1]], end: start + literal[1].length };
  }

  return { value: null, end: start };
}

/**
 * 抠出 `"key": <值>` 里的值。找不到 / 值坏掉 → null。
 * @param {string} text
 * @param {string} key 字段名（不带引号）
 * @param {{ from?: number }} options from：从哪个位置开始找（用于同名嵌套字段）
 */
export function extractField(text, key, { from = 0 } = {}) {
  const raw = String(text ?? '');
  const pattern = new RegExp(`"${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`, 'g');
  pattern.lastIndex = Math.max(0, from);
  const match = pattern.exec(raw);
  if (!match) return null;
  return extractBalanced(raw, match.index + match[0].length).value;
}

/** 第一个平衡的 JSON 对象（整份输出被别的文字包着时用） */
export function firstJsonObject(text) {
  const raw = String(text ?? '');
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] !== '{') continue;
    const { value } = extractBalanced(raw, i);
    if (value && typeof value === 'object') return value;
  }
  return null;
}

/** 抠字符串字段（不吃 JSON 转义，够用） */
export function extractStringField(text, key) {
  const raw = String(text ?? '');
  const pattern = new RegExp(`"${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"([a-zA-Z_]+)"`);
  const match = pattern.exec(raw);
  return match ? match[1] : null;
}

/** 抠数字字段（顶层第一个匹配） */
export function extractNumberField(text, key) {
  const raw = String(text ?? '');
  const pattern = new RegExp(`"${String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const match = pattern.exec(raw);
  return match ? Number(match[1]) : null;
}
