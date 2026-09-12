// 导演时间 · 世界书弹层（UI 定稿 §11）
//
// 控件（定稿 §2.1）：搜索 #20 · 全选/全不选（只作用于筛选结果）#21 · 条目勾选 #22 · 完成 #23
// 结构与口径：书级折叠（带来源徽章）/ 条目级复选框；「已启用」「未启用」两个区；选择按聊天记。

import { esc, layerShell, tokensOf, fmtNumber } from '../dom.js';

/** 筛选：书名 + 条目名都参与（不匹配的书与条目都隐藏） */
function filterSources(sources, keyword) {
  const word = String(keyword ?? '').trim().toLowerCase();
  if (!word) return sources;
  const hit = (text) => String(text ?? '').toLowerCase().includes(word);
  return sources
    .map((source) => {
      const books = (source.books ?? []).map((book) => {
        const bookHit = hit(book.name);
        const entries = (book.entries ?? []).filter((entry) => bookHit || hit(entry.name));
        return { ...book, entries };
      }).filter((book) => book.entries.length);
      return { ...source, books };
    })
    .filter((source) => source.books.length);
}

export function render(state, ctxState) {
  const world = state.world ?? { sources: [], selection: {} };
  const keyword = ctxState?.keyword ?? '';
  const selection = world.selection ?? {};
  // 来源是异步读的，缓存放在面板的临时状态里（打开面板时读一次）
  const sources = filterSources(ctxState?.worldSources ?? world.sources ?? [], keyword);

  const picked = [];
  const books = [];
  for (const source of sources) {
    for (const book of source.books ?? []) {
      const enabledEntries = [];
      const disabledEntries = [];
      for (const entry of book.entries ?? []) {
        const checked = Boolean(selection[entry.key]);
        if (checked) picked.push(entry);
        (entry.enabled === false ? disabledEntries : enabledEntries).push({ entry, checked });
      }
      books.push({ source, book, enabledEntries, disabledEntries });
    }
  }
  const estimated = picked.reduce((sum, entry) => sum + tokensOf(entry.text ?? ''), 0);

  const entryRow = ({ entry, checked }) => `
    <div class="dt-entry">
      <input class="chk" type="checkbox" data-act="world.toggle" data-key="${esc(entry.key)}" ${checked ? 'checked' : ''}>
      <span>${esc(entry.name)}<em> · ${fmtNumber(String(entry.text ?? '').length)} 字</em></span>
    </div>`;

  const bookBlock = (item) => `
    <details class="dt-book" ${item.enabledEntries.length ? 'open' : ''}>
      <summary>${esc(item.book.name)} <span class="dt-src">${esc(item.source.label ?? item.source.type ?? '')}</span></summary>
      ${item.enabledEntries.map(entryRow).join('')}
      ${item.disabledEntries.length ? `<div class="dt-note" style="padding:0 10px 4px">酒馆里已禁用（${item.disabledEntries.length} 条）</div>${item.disabledEntries.map(entryRow).join('')}` : ''}
      ${item.book.error ? `<div class="dt-note" style="padding:0 10px 6px">读取失败：${esc(item.book.error)}</div>` : ''}
    </details>`;

  const enabledBlocks = books.filter((item) => item.enabledEntries.length).map(bookBlock).join('');
  const disabledBlocks = books.filter((item) => !item.enabledEntries.length).map(bookBlock).join('');

  const body = `
    <div style="display:flex;gap:6px;margin-bottom:9px">
      <input type="text" data-act="world.search" value="${esc(keyword)}" placeholder="搜索书名 / 条目名">
      <button class="dt-mini" type="button" data-act="world.all">全选</button><button class="dt-mini" type="button" data-act="world.none">全不选</button>
    </div>
    ${(ctxState?.worldSources ?? world.sources ?? []).length ? '' : '<div class="dt-note">这个聊天里没有可用的世界书（角色卡内嵌书 / 全局书 / 绑定书都没有）</div>'}
    ${enabledBlocks ? `<div class="dt-sec">已启用</div>${enabledBlocks}` : ''}
    ${disabledBlocks ? `<div class="dt-sec" style="margin-top:12px">未启用</div>${disabledBlocks}` : ''}
    <div class="dt-note">选择按聊天记，换聊天互不影响</div>`;

  return {
    html: layerShell({
      layer: 'world',
      title: '世界书',
      backLabel: ctxState?.backTo ? `返回${ctxState.backTo}` : '返回',
      body,
      foot: `<span>已选 ${picked.length} 条 · 约 ${fmtNumber(estimated)} tokens</span><span class="spacer"></span>
        <button class="dt-mini" type="button" data-act="world.refresh">刷新</button>
        <button class="dt-mini" type="button" data-act="layer.close">完成</button>`,
    }),
    actions: {
      'world.search': (el, { ctx }) => {
        // 边打边过滤；重绘后把焦点还回搜索框（见 panel.js 的 focusAct）
        ctx.setState({ keyword: el.value, focusAct: 'world.search' });
        ctx.refresh();
      },
      'world.toggle': (el, { api, ctx, state }) => {
        const selection = { ...(state.world?.selection ?? {}) };
        if (el.checked) selection[el.dataset.key] = true;
        else delete selection[el.dataset.key];
        api.saveWorldSelection?.(selection);
        ctx.refresh();
      },
      'world.all': (el, { api, ctx, state }) => {
        const selection = { ...(state.world?.selection ?? {}) };
        for (const source of filterSources(state.world?.sources ?? [], ctx.getState().keyword)) {
          for (const book of source.books ?? []) for (const entry of book.entries ?? []) selection[entry.key] = true;
        }
        api.saveWorldSelection?.(selection);
        ctx.flashGlobal('已全选当前筛选结果');
        ctx.refresh();
      },
      'world.none': (el, { api, ctx, state }) => {
        const selection = { ...(state.world?.selection ?? {}) };
        for (const source of filterSources(state.world?.sources ?? [], ctx.getState().keyword)) {
          for (const book of source.books ?? []) for (const entry of book.entries ?? []) delete selection[entry.key];
        }
        api.saveWorldSelection?.(selection);
        ctx.flashGlobal('已全不选当前筛选结果');
        ctx.refresh();
      },
      'world.refresh': async (el, { api, ctx }) => {
        ctx.busyGlobal('重新读取世界书…');
        const sources = await api.loadWorldSources?.(true) ?? [];
        ctx.setState({ worldSources: sources });
        ctx.flashGlobal('已重新读取世界书');
        ctx.refresh();
      },
    },
  };
}
