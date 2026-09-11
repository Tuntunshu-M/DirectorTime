// 导演时间 · 主面板
//
// 修 bug：菜单栏入口点进来看到的应该是主页面，而不是 API 配置。
// 主页面 = 运行状态（UI 设计 §3 场记板 + §9 调试的简化版，数据复用 debug.js 的纯函数）；
// 导演 API 配置收进右上角「配置」，随用随关。
//
// G4：本文件只做结构与交互，不做视觉美化（无斜纹 / 旋转 / 印章 / 装饰纹理）。
// 正式六分类界面按《UI设计-完全版.md》在 UI 阶段重写。

import { buildDebugState } from './debug.js';
import { renderSettingsForm } from './settings.js';

// 遮罩钉在视口上：fixed + 100dvh（移动端地址栏会改变可视高度，用 dvh 而非 vh）
// overflow:auto 兜底 —— 面板再高，整层也能滚，绝不出现"一半在屏幕外且够不到"
const OVERLAY_STYLE = [
  'position:fixed; top:0; left:0; right:0; bottom:0;',
  'width:100vw; height:100vh; height:100dvh;',
  'z-index:10000; display:none;',
  'align-items:flex-start; justify-content:center;',
  'overflow:auto; box-sizing:border-box; padding:16px;',
  'background:rgba(0,0,0,.45);',
  '-webkit-overflow-scrolling:touch;',
].join('');

// margin:auto —— 放得下就在视口居中，放不下就顶部对齐、交给遮罩滚动
const CARD_STYLE = [
  'margin:auto; width:min(560px,100%); max-width:100%; box-sizing:border-box;',
  'max-height:calc(100vh - 32px); max-height:calc(100dvh - 32px);',
  'overflow:auto; padding:14px 16px;',
  'background:var(--dt-card,#f5efe1); color:var(--dt-ink,#2b2721);',
  'border:1px solid var(--dt-rule,rgba(43,39,33,.28)); border-radius:6px;',
  'font-family:var(--dt-font-mono,ui-monospace,monospace); font-size:12px; line-height:1.7;',
].join('');

const BUTTON_STYLE = 'font:inherit;padding:4px 10px;cursor:pointer';

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function row(label, value) {
  return `<div><span style="opacity:.6">${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
}

export function createMainPanel({
  store,
  registry,
  onTest,
  onSave,
  onOpenDebug,
  getCapabilities,
  getLast,
} = {}) {
  let el = null;
  let escapeHandler = null;
  let view = 'status';

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dt-panel';
    el.style.cssText = OVERLAY_STYLE;
    el.innerHTML = `
      <section role="dialog" aria-modal="true" aria-label="导演时间" style="${CARD_STYLE}">
        <header style="display:flex;align-items:center;gap:8px">
          <strong id="dt-panel-title" style="font-size:14px;flex:1">导演时间</strong>
          <button id="dt-panel-config" type="button" style="${BUTTON_STYLE}" title="导演 API 配置">配置</button>
          <button id="dt-panel-close" type="button" style="${BUTTON_STYLE}" aria-label="关闭导演时间" title="关闭">✕</button>
        </header>
        <hr style="border:none;border-top:1px dashed var(--dt-rule,rgba(43,39,33,.28));margin:8px 0">
        <div id="dt-panel-body"></div>
      </section>
    `;
    document.body.appendChild(el);

    el.querySelector('#dt-panel-close').addEventListener('click', close);
    el.querySelector('#dt-panel-config').addEventListener('click', () => setView(view === 'config' ? 'status' : 'config'));
    // 点遮罩关闭；点卡片内部不关
    el.addEventListener('click', (event) => {
      if (event.target === el) close();
    });

    escapeHandler = (event) => {
      if (event.key === 'Escape' && isOpen()) close();
    };
    document.addEventListener('keydown', escapeHandler);
    return el;
  }

  function isOpen() {
    return el?.style.display === 'flex';
  }

  function renderStatus(body) {
    const status = buildDebugState({
      store,
      registry,
      last: getLast?.() ?? null,
      capabilities: getCapabilities?.() ?? null,
      lastTurn: getLast?.() ?? null,
    });
    const noStage = status.stage.total === 0;
    const connection = store?.getSettings?.().connection ?? {};
    const tip = connection.endpoint ? '' : `
      <div style="margin-top:10px;opacity:.75">
        还没配置导演 API → 点右上角「配置」填写端点 / 密钥 / 模型
      </div>
    `;
    body.innerHTML = `
      <div style="opacity:.6;margin-bottom:4px">运行状态</div>
      ${row('阶段', noStage ? '还没有剧本' : `${status.stage.index}/${status.stage.total} ${status.stage.title}`)}
      ${row('目标', status.stage.goal || '—')}
      ${row('状态', `${status.stage.status} · 卡住 ${status.stage.stuckCount} 轮`)}
      ${row('注入', status.injection.registered ? `已注册 · ${status.injection.length} 字` : '未注册')}
      ${row('上次动作', status.lastAction ? `${status.lastAction}（${status.lastReason ?? ''}）` : '—')}
      ${row('累计', `调用 ${status.cost.callCount} 次`)}
      ${tip}
      <div style="margin-top:10px">
        <button id="dt-panel-debug" type="button" style="${BUTTON_STYLE}">打开调试面板</button>
      </div>
    `;
    body.querySelector('#dt-panel-debug')?.addEventListener('click', () => onOpenDebug?.());
  }

  function render() {
    const node = ensure();
    node.querySelector('#dt-panel-title').textContent = view === 'config' ? '导演时间 · 配置' : '导演时间';
    node.querySelector('#dt-panel-config').textContent = view === 'config' ? '返回' : '配置';

    const body = node.querySelector('#dt-panel-body');
    if (view === 'config') {
      renderSettingsForm({ container: body, store, onTest, onSave });
    } else {
      renderStatus(body);
    }
    return node;
  }

  function setView(next) {
    view = next;
    return render();
  }

  function open() {
    const node = ensure();
    node.style.display = 'flex';
    view = 'status';
    render();
    return node;
  }

  function close() {
    if (el) el.style.display = 'none';
  }

  function toggle() {
    return isOpen() ? close() : open();
  }

  function destroy() {
    if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
    el?.remove();
    el = null;
  }

  return { open, close, toggle, render, setView, destroy };
}
