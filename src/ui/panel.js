// 导演时间 · 主面板
//
// 修 bug：菜单栏入口点进来看到的应该是主页面，而不是 API 配置。
// 主页面 = 运行状态（UI 设计 §3 场记板 + §9 调试的简化版，数据复用 debug.js 的纯函数）；
// 导演 API 配置收进右上角「配置」，随用随关。
//
// 尺寸 / 定位跟随酒馆页面：样式在 style.css 的 #dt-panel（fixed + 100dvh + calc 限宽限高），
// 与旧仓库 just-do-it-char 的 .stpd-overlay / .stpd-modal 同一套做法 ——
// 手机、缩小的小窗口都不会超出视口，头部（含关闭按钮）永远可见，内容在内部滚动。
//
// G4：本文件只做结构与交互，不做视觉美化（无斜纹 / 旋转 / 印章 / 装饰纹理）。

import { buildDebugState } from './debug.js';
import { renderSettingsForm } from './settings.js';

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
    el.innerHTML = `
      <section class="dt-card" role="dialog" aria-modal="true" aria-label="导演时间">
        <header class="dt-head">
          <strong class="dt-title" id="dt-panel-title">导演时间</strong>
          <button class="dt-btn" id="dt-panel-config" type="button" title="导演 API 配置">配置</button>
          <button class="dt-btn" id="dt-panel-close" type="button" aria-label="关闭导演时间" title="关闭">✕</button>
        </header>
        <div class="dt-body" id="dt-panel-body"></div>
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
    return Boolean(el?.classList.contains('dt-open'));
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
        <button id="dt-panel-debug" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">打开调试面板</button>
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
    node.classList.add('dt-open');
    view = 'status';
    render();
    return node;
  }

  function close() {
    el?.classList.remove('dt-open');
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

  return { open, close, toggle, render, setView, destroy, isOpen };
}
