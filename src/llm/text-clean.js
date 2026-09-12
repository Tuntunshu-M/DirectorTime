// 导演时间 · 文本清洗层（bugfix 0912 第二波 P1-3）
//
// 模型经常把 `<thinking>…</thinking>`（或截断到结尾没闭合）漏进正文，
// 会污染**判定输入**和 Debug 回放。这里做一层可自定义的清洗。
//
// 拍板的作用范围：**只清洗导演时间自己消费的数据** ——
//   ① 判定用的 char 回复（推进点判定 / 态度判定 / 硬禁区匹配）
//   ② Debug 回放显示（默认清洗后，可切换看原文）
// **绝不改聊天记录本体**（禁则 G2/G3 不变）。

/** 内置默认规则（用户可以在配置里再加自己的） */
export const BUILTIN_CLEAN_RULES = [
  { id: 'thinking', label: 'thinking 块', pattern: '<thinking>[\\s\\S]*?</thinking>', source: '<thinking>[\\s\\S]*?</thinking>' },
  { id: 'think', label: 'think 块', pattern: '<think>[\\s\\S]*?</think>', source: '<think>[\\s\\S]*?</think>' },
];

/** 未闭合的思考块：从开标签一路截到结尾（模型输出被截断时最常见） */
const UNCLOSED_PATTERNS = [
  /<\s*thinking\s*>[\s\S]*$/i,
  /<\s*think\s*>[\s\S]*$/i,
];

/** 用户自定义规则：存的是正则**源串**（字符串），运行时才编译（编译失败就跳过，不炸） */
export function normalizeCleanRules(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const source = String(typeof item === 'string' ? item : item?.pattern ?? '').trim();
    if (!source) continue;
    if (out.some((rule) => rule.pattern === source)) continue;
    out.push({ id: `custom_${out.length + 1}`, label: '自定义', pattern: source, source });
    if (out.length >= 20) break; // 别让配置无限膨胀
  }
  return out;
}

/** 这条自定义正则能不能编译（配置页用来自查） */
export function isValidCleanPattern(source) {
  try {
    // eslint-disable-next-line no-new
    new RegExp(String(source));
    return true;
  } catch {
    return false;
  }
}

/** 全部生效规则：内置两条 + 用户自定义（enabled=false 时一条都不用） */
export function resolveCleanRules(config) {
  if (config?.enabled === false) return [];
  const custom = normalizeCleanRules(config?.rules);
  return [...BUILTIN_CLEAN_RULES, ...custom];
}

/**
 * 清洗文本。
 * @param {string} text 原文
 * @param {{enabled?: boolean, rules?: Array}} config 清洗配置（来自 settings.textClean）
 * @returns {string} 清洗后的文本（没配规则 / 关了 → 原样返回）
 */
export function cleanText(text, config) {
  const raw = String(text ?? '');
  if (!raw) return raw;

  const rules = resolveCleanRules(config);
  if (!rules.length) return raw;

  let out = raw;
  for (const rule of rules) {
    try {
      out = out.replace(new RegExp(rule.pattern, 'gi'), '');
    } catch {
      // 正则写错了就跳过这条 —— 清洗失败绝不能影响主流程
    }
  }

  // 未闭合的思考块单独处理（正则里的惰性匹配抓不到"没有闭合标签"的情况）
  for (const pattern of UNCLOSED_PATTERNS) out = out.replace(pattern, '');

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** 清洗前后有没有差别（Debug 用：判断"这条回复是不是被清过"） */
export function wasCleaned(raw, config) {
  const text = String(raw ?? '');
  return Boolean(text) && cleanText(text, config) !== text;
}
