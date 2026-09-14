// 导演时间 · 世界书弹层（UI 定稿 §11）
//
// 控件（定稿 §2.1）：搜索 #20 · 全选/全不选（只作用于筛选结果）#21 · 条目勾选 #22 · 完成 #23
// 结构与口径：书级折叠（带来源徽章）/ 条目级复选框；「已启用」「未启用」两个区；选择按聊天记。

import { esc, layerShell, fmtNumber } from '../dom.js';

/**
 * 筛选：书名 + 条目名都参与（不匹配的书与条目都隐藏）。
 *
 * T-434 懒加载：**还没读过的书只有书名**（没有条目可搜），所以它们只按书名匹配 ——
 * 要按条目名搜遍所有书，点工具栏的「全部读取」。
 */
function filterSources(sources, keyword) {
  const word = String(keyword ?? '').trim().toLowerCase();
  if (!word) return sources;
  const hit = (text) => String(text ?? '').toLowerCase().includes(word);
  return sources
    .map((source) => {
      const books = (source.books ?? []).map((book) => {
        const bookHit = hit(book.name);
        if (book.lazy) return bookHit ? book : null; // 没读过的：只认书名
        const entries = (book.entries ?? []).filter((entry) => bookHit || hit(entry.name));
        return entries.length ? { ...book, entries } : null;
      }).filter(Boolean);
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

  const books = [];
  let lazyCount = 0;
  for (const source of sources) {
    for (const book of source.books ?? []) {
      const enabledEntries = [];
      const disabledEntries = [];
      for (const entry of book.entries ?? []) {
        const checked = Boolean(selection[entry.key]);
        (entry.enabled === false ? disabledEntries : enabledEntries).push({ entry, checked });
      }
      if (book.lazy) lazyCount += 1;
      books.push({ source, book, enabledEntries, disabledEntries, lazy: Boolean(book.lazy) });
    }
  }
  // 条数 / token 走核心那份统计（T-434：没读过的书没有条目可数）
  const stats = world.stats ?? { count: 0, tokens: 0, unknown: 0 };

  const entryRow = ({ entry, checked }) => `
    <div class="dt-entry">
      <input class="chk" type="checkbox" data-act="world.toggle" data-key="${esc(entry.key)}" ${checked ? 'checked' : ''}>
      <span>${esc(entry.name)}<em> · ${fmtNumber(String(entry.text ?? '').length)} 字</em></span>
    </div>`;

  /**
   * 一本书一个折叠块。
   *
   * 2026-09-14 反馈 #3：**默认一律折叠**（以前"有启用条目就自动展开"，
   * 用户几百本书一打开就是铺满屏，翻起来要命）。展开状态由面板重绘时保留（data-key）。
   * T-434：**还没读过的书不读**，点书名才读（展开哪本读哪本）。
   */
  const bookBlock = (item) => {
    const key = `book:${item.source.type ?? ''}:${item.book.name}`;
    if (item.lazy) {
      return `
    <details class="dt-book dt-book-lazy" data-key="${esc(key)}">
      <summary data-act="world.readBook" data-book="${esc(item.book.name)}" data-key="${esc(key)}">${esc(item.book.name)} <span class="dt-src">${esc(item.source.label ?? item.source.type ?? '')}</span> <span class="dt-chip">点开即读取</span></summary>
      <div class="dt-note" style="padding:0 10px 6px">这本书还没读（省流量）。点一下书名就会读出来。</div>
    </details>`;
    }
    return `
    <details class="dt-book" data-key="${esc(key)}">
      <summary>${esc(item.book.name)} <span class="dt-src">${esc(item.source.label ?? item.source.type ?? '')}</span></summary>
      ${item.enabledEntries.map(entryRow).join('')}
      ${item.disabledEntries.length ? `<div class="dt-note" style="padding:0 10px 4px">酒馆里已禁用（${item.disabledEntries.length} 条）</div>${item.disabledEntries.map(entryRow).join('')}` : ''}
      ${item.book.error ? `<div class="dt-note" style="padding:0 10px 6px">读取失败：${esc(item.book.error)}</div>` : ''}
    </details>`;
  };

  const enabledBlocks = books.filter((item) => !item.lazy && item.enabledEntries.length).map(bookBlock).join('');
  const disabledBlocks = books.filter((item) => !item.lazy && !item.enabledEntries.length).map(bookBlock).join('');
  const lazyBlocks = books.filter((item) => item.lazy).map(bookBlock).join('');

  // 读不到"全局启用"列表时如实说明（2026-09-14 反馈 #3）
  const sourceHints = (ctxState?.worldSources ?? world.sources ?? [])
    .filter((source) => source.hint)
    .map((source) => `<div class="dt-note">${esc(source.label ?? '')}：${esc(source.hint)}</div>`)
    .join('');

  const body = `
    <div style="display:flex;gap:6px;margin-bottom:9px">
      <input type="text" data-act="world.search" value="${esc(keyword)}" placeholder="搜索书名 / 条目名">
      <button class="dt-mini" type="button" data-act="world.all">全选</button><button class="dt-mini" type="button" data-act="world.none">全不选</button>
    </div>
    ${sourceHints}
    ${(ctxState?.worldSources ?? world.sources ?? []).length ? '' : '<div class="dt-note">这个聊天里没有可用的世界书（角色卡内嵌书 / 全局书 / 绑定书都没有）</div>'}
    ${enabledBlocks ? `<div class="dt-sec">已启用</div>${enabledBlocks}` : ''}
    ${disabledBlocks ? `<div class="dt-sec" style="margin-top:12px">未启用</div>${disabledBlocks}` : ''}
    ${lazyBlocks ? `<div class="dt-sec" style="margin-top:12px">还没读 · ${lazyCount} 本（点书名才读）</div>${lazyBlocks}` : ''}
    <div class="dt-note">书默认折叠，点书名展开（展开状态会记住）；<b>没读过的书不会预先读取</b>（几百本也不会一次全读）。
      按条目名搜遍全部书 → ${lazyCount ? `<button class="dt-mini" type="button" data-act="world.readAll">读取全部 ${lazyCount} 本</button>` : '当前都已读取'}；选择按聊天记。</div>`;

  return {
    html: layerShell({
      layer: 'world',
      title: '世界书',
      backLabel: ctxState?.backTo ? `返回${ctxState.backTo}` : '返回',
      body,
      foot: `<span>已选 ${stats.count} 条 · 约 ${fmtNumber(stats.tokens)} tokens${stats.approx ? `（${stats.unknown} 条还没读过，按已知估算）` : ''}</span><span class="spacer"></span>
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
        ctx.flashGlobal('已重新读取世界书（已读过的书也重新读了）');
        ctx.refresh();
      },
      /**
       * T-434：点书名 → 只读这一本，读完把它摊开。
       * 点的是 `<summary>`，浏览器默认的展开动作发生在我们的捕获阶段之后 ——
       * 而这里会 refresh 换掉整棵子树，默认动作就落空了，所以显式把它标成展开。
       */
      'world.readBook': async (el, { api, ctx }) => {
        const name = el.dataset.book ?? '';
        if (!name) return;
        ctx.openKey?.(el.dataset.key);
        ctx.busyGlobal(`正在读《${name}》…`);
        try {
          const book = await api.loadWorldBook?.(name);
          const sources = await api.loadWorldSources?.(false) ?? [];
          ctx.setState({ worldSources: sources });
          ctx.flashGlobal(book?.error
            ? `《${name}》读取失败：${book.error}`
            : `已读《${name}》：${(book?.entries ?? []).length} 条`);
        } catch (error) {
          ctx.flashGlobal(`《${name}》读取出错：${error?.message ?? '原因不明'}`);
        }
        ctx.refresh();
      },
      /** T-434：把所有还没读的书读一遍（想按条目名搜遍全部时才用，几百本会慢） */
      'world.readAll': async (el, { api, ctx, state }) => {
        const pending = [];
        for (const source of state.world?.sources ?? []) {
          for (const book of source.books ?? []) if (book.lazy) pending.push(book.name);
        }
        if (!pending.length) {
          ctx.flashGlobal('所有书都已经读过了');
          return;
        }
        for (let i = 0; i < pending.length; i += 1) {
          ctx.busyGlobal(`正在读取全部世界书… ${i + 1}/${pending.length}（${pending[i]}）`);
          // 逐本读，读完一次性刷新（中途刷新会把进度提示冲掉、也白重绘）
          // eslint-disable-next-line no-await-in-loop
          await api.loadWorldBook?.(pending[i]);
        }
        const sources = await api.loadWorldSources?.(false) ?? [];
        ctx.setState({ worldSources: sources });
        ctx.flashGlobal(`已读取全部 ${pending.length} 本世界书（之后按条目名搜索就都能搜到了）`);
        ctx.refresh();
      },
    },
  };
}
