// 导演时间 · 破限词（T-411）
//
// 目的只有一个：**让导演 API 肯写 NSFW 剧情**（Gemini / Claude 这类会拒）。
// 所以：
//   1. 只进导演 API 请求，**不进角色回复端** —— 回复端酒馆自己的预设已经管了
//   2. 必须配清洗：破限词进了请求就会污染输出（模型可能复述破限指令），
//      因此要求模型把剧情放进 `<plot>…</plot>`，解析时只取标签内的内容，标签外一律丢弃
//
// 三种模式（外加关闭）：
//   preset 跟随酒馆预设 / custom 自定义 / append 预设后追加自定义
// 酒馆预设的读取接口由 T-418 提供；未接上时 preset 部分为空（静默，不报错）。

export const BREAK_MODES = ['off', 'preset', 'custom', 'append'];

/** 剧情内容的约定标签 —— 破限模式下解析只认这里面的东西 */
export const PLOT_OPEN = '<plot>';
export const PLOT_CLOSE = '</plot>';

export function normalizeBreakFilter(raw) {
  const mode = BREAK_MODES.includes(raw?.mode) ? raw.mode : 'off';
  return { mode, custom: String(raw?.custom ?? '') };
}

/** 拼出要加到导演请求里的破限文本；关着 / 没内容 → '' */
export function breakText(filter, { presetText = '' } = {}) {
  const { mode, custom } = normalizeBreakFilter(filter);
  const preset = String(presetText ?? '').trim();
  const own = String(custom ?? '').trim();

  if (mode === 'preset') return preset;
  if (mode === 'custom') return own;
  if (mode === 'append') return [preset, own].filter(Boolean).join('\n\n');
  return '';
}

/** 把破限文本并进第一条 system 消息；不改原数组 */
export function prependToSystem(messages, text) {
  const body = String(text ?? '').trim();
  if (!body || !Array.isArray(messages) || !messages.length) return messages;
  const [first, ...rest] = messages;
  return [{ ...first, content: `${body}\n\n${first.content ?? ''}` }, ...rest];
}

/** 标签里的字符都是字面量，转义一下再拼正则（以后改标签名只需改上面两个常量） */
function escapeTag(tag) {
  return String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 清洗：只取 `<plot>…</plot>` 里的内容。
 * **没有标签就原样返回** —— 没开破限模式下模型不会用标签，老行为必须不变。
 */
export function extractPlot(text) {
  const raw = String(text ?? '');
  const pattern = new RegExp(`${escapeTag(PLOT_OPEN)}([\\s\\S]*?)${escapeTag(PLOT_CLOSE)}`, 'i');
  const match = raw.match(pattern);
  return match ? match[1].trim() : raw;
}

export function createBreakFilterService({ getFilter, getPresetText } = {}) {
  /** 当前该往导演请求里加的破限文本 */
  function text() {
    let preset = '';
    try {
      preset = getPresetText?.() ?? '';
    } catch {
      preset = ''; // 读预设失败就当没有（破限不该阻断主流程）
    }
    return breakText(getFilter?.(), { presetText: preset });
  }

  return { text };
}
