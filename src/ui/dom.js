// 导演时间 · UI 小工具（T-427 UI 重做）
//
// 只放纯函数：转义、图标、token 估算、数字格式化。
// **不要往这里加业务逻辑** —— 业务在 api，渲染在各 render/*.js。

/** HTML 转义（正文与属性都用它） */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 图标（内联 SVG，不用 emoji / 不用图标字体） */
export const ICONS = {
  book: '<path d="M5 3h9a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3V3zm0 0v15"/>',
  bars: '<path d="M3 5h18v3H3V5zm0 6h12v3H3v-3zm0 6h18v3H3v-3z"/>',
  gear: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4a9.4 9.4 0 0 0-.16-1.7l2-1.5-2-3.4-2.3 1a9.4 9.4 0 0 0-2.9-1.7L15.7 2h-4l-.4 2.7a9.4 9.4 0 0 0-2.9 1.7l-2.3-1-2 3.4 2 1.5a9.4 9.4 0 0 0 0 3.4l-2 1.5 2 3.4 2.3-1a9.4 9.4 0 0 0 2.9 1.7l.4 2.7h4l.4-2.7a9.4 9.4 0 0 0 2.9-1.7l2.3 1 2-3.4-2-1.5c.1-.5.16-1.1.16-1.7z"/>',
  /** 日/月：随当前配色变（a 夜间 → 显示月亮；b 日间 → 显示太阳） */
  moon: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 0v18"/>',
  sun: '<path d="M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0-4 1.5 3h-3L12 2zm0 20-1.5-3h3L12 22zM2 12l3-1.5v3L2 12zm20 0-3 1.5v-3L22 12zM4.9 4.9 7.6 6.6 6.6 7.6 4.9 4.9zm14.2 14.2-2.7-1.7 1-1 1.7 2.7zM19.1 4.9l-1.7 2.7-1-1 2.7-1.7zM4.9 19.1l1.7-2.7 1 1-2.7 1.7z"/>',
  chart: '<path d="M3 20h2v-7H3v7zm5 0h2V8H8v12zm5 0h2V4h-2v16zm5 0h2v-9h-2v9z"/>',
  back: '<path d="M15.4 4.6 8 12l7.4 7.4 1.4-1.4L10.8 12l6-6-1.4-1.4z"/>',
  close: '<path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 12 12 5.7 5.7 7.1 4.3 13.4 10.6 12 12l1.4 1.4 6.3 6.3-1.4 1.4z"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24">${ICONS[name] ?? ''}</svg>`;
}

/** 工具图标按钮（抬头那五个） */
export function iconButton({ act, name, title, cls = '' }) {
  return `<button class="dt-icon${cls ? ` ${cls}` : ''}" type="button" data-act="${esc(act)}" title="${esc(title)}" aria-label="${esc(title)}">${icon(name)}</button>`;
}

/** 带返回/关闭头的弹层外壳 */
export function layerShell({ layer, title, backLabel = '返回', body, foot = '' }) {
  return `
  <div class="dt-layer" data-layer="${esc(layer)}">
    <div class="dt-layer-head">
      <button class="dt-back" type="button" data-act="layer.back">${icon('back')}${esc(backLabel)}</button>
      <strong class="dt-layer-title">${esc(title)}</strong><span class="spacer"></span>
      <button class="dt-icon" type="button" data-act="layer.close" title="关闭" aria-label="关闭">${icon('close')}</button>
    </div>
    <div class="dt-layer-body">${body}</div>
    ${foot ? `<div class="dt-layer-foot">${foot}</div>` : ''}
  </div>`;
}

/** 一行「标签 + 值」（场记 / 调试共用） */
export function row(key, value) {
  return `<div class="dt-row"><span class="dt-k">${esc(key)}</span><span class="dt-v">${value}</span></div>`;
}

/** 字数 → 粗略 token（世界书计数用，规格：字符数 / 2.5） */
export function tokensOf(text) {
  const length = String(text ?? '').length;
  return length ? Math.round(length / 2.5) : 0;
}

/** 千分位（tokens 显示） */
export function fmtNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '0';
}

/** 开关（toggle） */
export function toggle({ act, checked, big = false, label = '' }) {
  return `<label class="dt-sw${big ? ' dt-sw-big' : ''}">${label}
    <input type="checkbox" data-act="${esc(act)}" ${checked ? 'checked' : ''}><i></i></label>`;
}

/** 单选组（.dt-seg 形态） */
export function seg({ name, act, value, options }) {
  return `<div class="dt-seg">${options.map((item) => `<label>
    <input type="radio" name="${esc(name)}" value="${esc(item.value)}" data-act="${esc(act)}" ${item.value === value ? 'checked' : ''}><span>${esc(item.label)}</span>
  </label>`).join('')}</div>`;
}
