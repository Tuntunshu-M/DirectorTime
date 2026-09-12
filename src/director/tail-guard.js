// 导演时间 · 模型尾巴识别（用户反馈 ②）
//
// 实测：char 的回复里出现过 `<thinking>…</thinking>` 和「请选择接下来的剧情导向」。
// 这**不是本插件注入的**（是模型或角色预设自带的），但它是隐患：
// 「请选择剧情导向」= 把主导权交回给 user，跟本插件「char 主动推进」正好相反。
//
// 纪律和 actor-guard 一样：**只识别、只报警，绝不改写 char 的回复**
// （改聊天内容属于越界 —— 禁则 G2/G3）。要根治得从角色预设那边关掉。

/** 思考块：模型把内部思考漏到正文里了 */
export const THINKING_PATTERNS = [
  /<\s*thinking\s*>[\s\S]*?<\s*\/\s*thinking\s*>/i,
  /<\s*(?:think|reasoning|thought)\s*>[\s\S]*?<\s*\/\s*(?:think|reasoning|thought)\s*>/i,
  /^\s*(?:思考|内心推理)\s*[:：]/m,
];

/** 把选择权交回 user 的收尾（菜单 / 选项 / 提问） */
export const HANDOFF_PATTERNS = [
  /请选择[^\n]{0,24}(?:剧情|走向|导向|下一步|行动)/,
  /(?:你|请)(?:选择|决定)(?:接下来|下一)?[^\n]{0,16}(?:剧情|走向|行动|方向)/,
  /接下来(?:你)?(?:想|要)(?:怎么|如何)(?:做|走|办|样)?[^\n]{0,6}[？?]?/,
  /(?:你)?(?:想|要)(?:怎么|如何)(?:走|做|办|样)[^\n]{0,4}[？?]?/,
  /(?:选项|option)\s*[:：]/i,
];

/** 像"选项行"的一行：A. xxx / 1) xxx / - xxx（单行不算，连着两行才算菜单） */
export const OPTION_LINE = /^\s*(?:[A-DＡ-Ｄ][.、)）]|[1-4][.、)）]|[-*·])\s*\S{2,40}\s*$/;

/**
 * 找出这条回复里的"模型尾巴"。
 * @param {string} charMessage char 的回复原文
 * @returns {Array<{kind:'thinking'|'menu'|'handoff', hit:string, count?:number, hint:string}>}
 */
export function findReplyTails(charMessage) {
  const text = String(charMessage ?? '');
  const issues = [];
  if (!text.trim()) return issues;

  for (const pattern of THINKING_PATTERNS) {
    const hit = text.match(pattern);
    if (hit) {
      issues.push({ kind: 'thinking', hit: hit[0].slice(0, 40), hint: '模型把内部思考漏进正文了' });
      break;
    }
  }

  const optionLines = text.split('\n').filter((line) => OPTION_LINE.test(line));
  if (optionLines.length >= 2) {
    issues.push({
      kind: 'menu',
      hit: optionLines[0].trim().slice(0, 40),
      count: optionLines.length,
      hint: '结尾给了选项菜单，把主导权交回 user',
    });
  }

  for (const pattern of HANDOFF_PATTERNS) {
    const hit = text.match(pattern);
    if (hit) {
      issues.push({ kind: 'handoff', hit: hit[0].slice(0, 40), hint: '结尾在问 user 要怎么走' });
      break;
    }
  }

  return issues;
}

/** 报警文案（控制台 / Debug 用） */
export function describeTails(issues = []) {
  return issues.map((issue) => `${issue.hint}：「${issue.hit}」`).join('；');
}

/**
 * 给角色回复端注入的**反制提示**（一句话，随导演指令一起下发）。
 * 不做开关：这是本插件的既定目标（char 主动推进）的一部分，不是可选体验。
 */
export const NO_TAIL_LINE = '直接演下去：不要输出思考过程（如 <thinking>），也不要在结尾给 user 选项菜单或问"你想怎么走"。';
