// 导演时间 · 主面板
//
// 修 bug：菜单栏入口点进来看到的应该是主页面，而不是 API 配置。
// 主页面 = 总开关 + 运行状态（数据复用 debug.js 的纯函数）；导演 API 配置收进右上角「配置」。
//
// 尺寸 / 定位跟随酒馆页面：样式在 style.css 的 #dt-panel（fixed + 100dvh + calc 限宽限高），
// 与旧仓库 just-do-it-char 的 .stpd-overlay / .stpd-modal 同一套做法 ——
// 手机、缩小的小窗口都不会超出视口，头部（含总开关与关闭按钮）永远可见，内容在内部滚动。
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
  onGenerate,
  onExtend,
  profile,
  loadWorldSources,
  getWorldSelection,
  saveWorldSelection,
  getWorldText,
  getEnabled,
  onToggleEnabled,
  onOpenDebug,
  getCapabilities,
  getLast,
} = {}) {
  let el = null;
  let escapeHandler = null;
  let view = 'status';
  let worldSources = null;
  let worldKeyword = '';
  let worldLoading = false;

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dt-panel';
    el.innerHTML = `
      <section class="dt-card" role="dialog" aria-modal="true" aria-label="导演时间">
        <header class="dt-head">
          <strong class="dt-title" id="dt-panel-title">导演时间</strong>
          <label class="dt-switch" title="导演时间总开关">
            <input type="checkbox" id="dt-panel-enabled"> 总开关
          </label>
          <button class="dt-btn" id="dt-panel-world" type="button" title="世界书接入">世界书</button>
          <button class="dt-btn" id="dt-panel-config" type="button" title="导演 API 配置">配置</button>
          <button class="dt-btn" id="dt-panel-close" type="button" aria-label="关闭导演时间" title="关闭">✕</button>
        </header>
        <div class="dt-body" id="dt-panel-body"></div>
      </section>
    `;
    document.body.appendChild(el);

    el.querySelector('#dt-panel-close').addEventListener('click', close);
    el.querySelector('#dt-panel-config').addEventListener('click', () => setView(view === 'config' ? 'status' : 'config'));
    el.querySelector('#dt-panel-world').addEventListener('click', () => setView(view === 'world' ? 'status' : 'world'));
    el.querySelector('#dt-panel-enabled').addEventListener('change', (event) => {
      onToggleEnabled?.(event.target.checked);
      render();
    });
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
    const enabled = Boolean(getEnabled?.());
    const connection = store?.getSettings?.().connection ?? {};
    const tip = enabled
      ? (connection.endpoint ? '' : `
        <div style="margin-top:10px;opacity:.75">
          还没配置导演 API → 点右上角「配置」填写端点 / 密钥 / 模型
        </div>
      `)
      : '<div style="margin-top:10px;opacity:.75">总开关没开，导演时间处于停用状态</div>';

    body.innerHTML = `
      <div style="opacity:.6;margin-bottom:4px">运行状态</div>
      ${row('阶段', noStage ? '还没有剧本' : `${status.stage.index}/${status.stage.total} ${status.stage.title}`)}
      ${row('目标', status.stage.goal || '—')}
      ${row('状态', `${status.stage.status} · 卡住 ${status.stage.stuckCount} 轮`)}
      ${row('注入', status.injection.registered ? `已注册 · ${status.injection.length} 字` : '未注册')}
      ${row('上次动作', status.lastAction ? `${status.lastAction}（${status.lastReason ?? ''}）` : '—')}
      ${row('累计', `调用 ${status.cost.callCount} 次`)}
      ${tip}
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        ${enabled ? `<button id="dt-panel-generate" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">${noStage ? '生成剧本' : '重新生成剧本'}</button>` : ''}
        ${enabled && !noStage ? '<button id="dt-panel-extend" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">重新续写</button>' : ''}
        <button id="dt-panel-debug" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">打开调试面板</button>
      </div>
    `;

    function wireBusy(selector, action) {
      body.querySelector(selector)?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = '处理中…';
        try {
          await action?.();
        } finally {
          render();
        }
      });
    }
    wireBusy('#dt-panel-generate', onGenerate);
    wireBusy('#dt-panel-extend', onExtend);
    body.querySelector('#dt-panel-debug')?.addEventListener('click', () => onOpenDebug?.());
  }

  async function loadWorld(force) {
    worldLoading = true;
    render();
    try {
      worldSources = (await loadWorldSources?.(force)) ?? [];
    } catch (error) {
      console.warn('[导演时间] 世界书加载失败', error);
      worldSources = [];
    } finally {
      worldLoading = false;
      render();
    }
  }

  async function refreshWorldPreview(body) {
    const pre = body.querySelector('#dt-world-preview');
    if (!pre || !getWorldText) return;
    try {
      pre.textContent = (await getWorldText()) || '（没有勾选任何条目）';
    } catch (error) {
      pre.textContent = `预览失败：${error?.message ?? error}`;
    }
  }

  /** 世界书页：来源树 + 勾选 + 搜索 + 实际发送文本预览（T-401） */
  function renderWorld(body) {
    const selection = getWorldSelection?.() ?? {};
    const limit = store?.getSettings?.().worldLimit ?? 20;
    const keyword = worldKeyword.trim().toLowerCase();
    const statText = () => `已选 ${Object.keys(getWorldSelection?.() ?? {}).length} 条 · 上限 ${limit} 条`;

    const list = (worldSources ?? []).map((source) => {
      const books = (source.books ?? []).map((book) => {
        const all = book.entries ?? [];
        const entries = all.filter((entry) => !keyword
          || book.name.toLowerCase().includes(keyword)
          || entry.name.toLowerCase().includes(keyword)
          || entry.content.toLowerCase().includes(keyword));
        if (!entries.length && !book.error) return '';
        const head = `<label style="display:block;margin:6px 0 2px;opacity:.75"><input type="checkbox" data-world-book="${escapeHtml(book.name)}" ${all.length && all.every((entry) => selection[entry.key]) ? 'checked' : ''}> ▸ ${escapeHtml(book.name)}${book.error ? `（${escapeHtml(book.error)}）` : `　${all.length} 条`}</label>`;
        const items = entries.map((entry) => `
          <label style="display:block;margin-left:14px">
            <input type="checkbox" data-world-key="${escapeHtml(entry.key)}" ${selection[entry.key] ? 'checked' : ''}> ${escapeHtml(entry.name)}${entry.enabled ? '' : '<span style="opacity:.6">（禁用）</span>'}${entry.constant ? '<span style="opacity:.6">（常驻）</span>' : ''}
          </label>`).join('');
        return head + items;
      }).join('');
      if (!books) return '';
      return `<div style="margin-bottom:6px"><div style="opacity:.6">${escapeHtml(source.label)}</div>${books}</div>`;
    }).join('');

    const placeholder = worldLoading
      ? '<div style="opacity:.7">加载中…</div>'
      : (worldSources
        ? (list || '<div style="opacity:.7">（没有可勾选的条目）</div>')
        : '<div style="opacity:.7">点「刷新」加载世界书</div>');

    body.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input id="dt-world-search" style="flex:1;box-sizing:border-box;padding:4px 6px;font:inherit" placeholder="搜索书名或条目" value="${escapeHtml(worldKeyword)}">
        <button id="dt-world-reload" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">刷新</button>
      </div>
      <div id="dt-world-stat" style="opacity:.7;margin-bottom:6px">${statText()}</div>
      <div>${placeholder}</div>
      <details style="margin-top:8px"><summary>将发送给导演 API 的世界书文本</summary>
        <pre id="dt-world-preview" style="white-space:pre-wrap;margin:6px 0">—</pre>
      </details>
    `;

    const search = body.querySelector('#dt-world-search');
    search?.addEventListener('input', () => {
      worldKeyword = search.value;
      render();
    });
    body.querySelector('#dt-world-reload')?.addEventListener('click', () => loadWorld(true));

    body.querySelectorAll('input[data-world-key]').forEach((box) => {
      box.addEventListener('change', () => {
        const next = { ...(getWorldSelection?.() ?? {}) };
        if (box.checked) next[box.dataset.worldKey] = true;
        else delete next[box.dataset.worldKey];
        saveWorldSelection?.(next);
        const stat = body.querySelector('#dt-world-stat');
        if (stat) stat.textContent = statText();
        refreshWorldPreview(body);
      });
    });

    // 整书勾选 / 取消（项目书 §F1「树形勾选整书或单条目」）
    body.querySelectorAll('input[data-world-book]').forEach((bookBox) => {
      bookBox.addEventListener('change', () => {
        const target = bookBox.dataset.worldBook;
        const next = { ...(getWorldSelection?.() ?? {}) };
        for (const source of worldSources ?? []) {
          for (const book of source.books ?? []) {
            if (book.name !== target) continue;
            for (const entry of book.entries ?? []) {
              if (bookBox.checked) next[entry.key] = true;
              else delete next[entry.key];
            }
          }
        }
        saveWorldSelection?.(next);
        render();
      });
    });

    // 搜索重渲染后把焦点与光标放回去
    if (keyword) {
      search?.focus();
      search?.setSelectionRange(worldKeyword.length, worldKeyword.length);
    }

    refreshWorldPreview(body);
  }

  function render() {
    const title = view === 'config' ? '导演时间 · 配置' : (view === 'world' ? '导演时间 · 世界书' : '导演时间');
    const node = ensure();
    node.querySelector('#dt-panel-title').textContent = title;
    node.querySelector('#dt-panel-enabled').checked = Boolean(getEnabled?.());
    node.querySelector('#dt-panel-config').textContent = view === 'config' ? '返回' : '配置';
    node.querySelector('#dt-panel-world').textContent = view === 'world' ? '返回' : '世界书';

    const body = node.querySelector('#dt-panel-body');
    if (view === 'config') {
      renderSettingsForm({ container: body, store, onTest, onSave, profile });
    } else if (view === 'world') {
      renderWorld(body);
    } else {
      renderStatus(body);
    }
    return node;
  }

  function setView(next) {
    view = next;
    // 第一次进世界书页自动加载一次（可能慢，先渲染「加载中」）
    if (view === 'world' && worldSources === null && !worldLoading) {
      loadWorld(false);
      return el;
    }
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
