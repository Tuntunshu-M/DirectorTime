// 导演时间 · 世界书（M7 / T-401）
//
// 项目书 §F1 世界书接入：
//   读取全部来源（全局 / 角色主 / 角色附加 / 人格 / 聊天 / 角色卡内嵌）
//   → 书名 + 条目双通道搜索 → 启用状态 → 树形勾选 → 勾选后确实进入 prompt。
//
// 条目字段兼容三套命名（AGENTS 关键接口，勿凭记忆改动）：
//   id:      entry.id ?? entry.uid ?? index
//   name:    entry.name ?? entry.comment ?? entry.keys?.join(', ')
//   content: entry.content ?? entry.text ?? ''
//
// 只读取，不写 ST；勾选状态存在插件自己的 extensionSettings 里。

/** 勾选用的稳定 key：书名 + 条目 id */
export function entryKey(bookName, entryId) {
  return `${bookName}::${entryId}`;
}

export function normalizeEntry(entry, index = 0, bookName = '') {
  const id = String(entry?.id ?? entry?.uid ?? index);
  return {
    id,
    key: entryKey(bookName, id),
    name: String(entry?.name ?? entry?.comment ?? entry?.keys?.join(', ') ?? `条目 ${index + 1}`),
    content: String(entry?.content ?? entry?.text ?? ''),
    // 启用状态徽章：ST 里 disable=true 表示禁用，constant=true 表示常驻
    enabled: entry?.disable !== true,
    constant: Boolean(entry?.constant),
  };
}

export function createLorebookService({ ctx } = {}) {
  /**
   * 已读过的书：书名 → `{ name, entries, error }`。
   *
   * T-434 懒加载：世界书条目**按需读**（展开哪本读哪本、注入只读"有勾选的"那几本）。
   * 以前 `collect()` 会把酒馆里**所有**书都读一遍 —— 用户有几百本时，打开面板就是几百次请求。
   */
  const loaded = new Map();

  function normalizeBook(name, book) {
    return {
      name,
      entries: (book?.entries ?? []).map((entry, index) => normalizeEntry(entry, index, name)),
    };
  }

  /** 读一本（带缓存；读失败也缓存，免得每次点都重试）。force=true 强制重读 */
  async function loadBook(name, { force = false } = {}) {
    const key = String(name ?? '').trim();
    if (!key) return { name: '', entries: [], error: '书名为空' };
    if (!force && loaded.has(key)) return loaded.get(key);

    let result;
    try {
      const book = await ctx?.loadWorldInfoBook?.(key);
      result = normalizeBook(key, book);
    } catch (error) {
      result = { name: key, entries: [], error: error?.message ?? '加载失败' };
    }
    loaded.set(key, result);
    return result;
  }

  /** 丢掉缓存（界面上点「刷新」= 重新读） */
  function forget() {
    loaded.clear();
  }

  /**
   * 枚举全部来源。**不再预读条目**：读过的书带条目，没读过的只留书名 + `lazy: true`。
   * 内嵌书（角色卡）本来就在内存里，不算请求，直接给。
   */
  function collect() {
    const sources = [];
    for (const source of ctx?.getLorebookSources?.() ?? []) {
      if (source.embedded) {
        const entries = (ctx?.getCharacterBookEntries?.() ?? [])
          .map((entry, index) => normalizeEntry(entry, index, source.label));
        sources.push({ ...source, books: [{ name: source.label, entries, loaded: true, embedded: true }] });
        continue;
      }

      sources.push({
        ...source,
        books: (source.names ?? []).map((name) => {
          const cached = loaded.get(name);
          return cached ? { ...cached, loaded: true } : { name, entries: [], lazy: true };
        }),
      });
    }
    return sources;
  }

  /** 按勾选挑出要进 prompt 的条目（保持来源顺序）。**同步版**：只认已经带着条目的书（测试/兼容用） */
  function pick(sources, selection = {}) {
    const picked = [];
    for (const source of sources ?? []) {
      for (const book of source.books ?? []) {
        for (const entry of book.entries ?? []) {
          if (selection?.[entry.key]) {
            picked.push({ ...entry, bookName: book.name, sourceType: source.type, sourceLabel: source.label });
          }
        }
      }
    }
    return picked;
  }

  /**
   * 注入用：按勾选挑条目，**只读"有勾选的"那些书**（懒加载的关键 ——
   * 注入的正确性不依赖"所有书都读过"）。勾选 key 形如 `书名::条目id`。
   */
  async function pickSelected(sources, selection = {}) {
    const wanted = new Map(); // 书名 → 勾选的条目 id 集合
    for (const key of Object.keys(selection ?? {})) {
      if (!selection[key]) continue;
      const at = String(key).lastIndexOf('::');
      if (at <= 0) continue;
      const book = String(key).slice(0, at);
      const id = String(key).slice(at + 2);
      if (!wanted.has(book)) wanted.set(book, new Set());
      wanted.get(book).add(id);
    }
    if (!wanted.size) return [];

    const picked = [];
    for (const source of sources ?? []) {
      for (const book of source.books ?? []) {
        const ids = wanted.get(book.name);
        if (!ids) continue;
        // eslint-disable-next-line no-await-in-loop -- 只读勾过的书，通常 1~2 本
        const full = book.loaded ? book : await loadBook(book.name);
        for (const entry of full.entries ?? []) {
          if (!ids.has(entry.id)) continue;
          picked.push({ ...entry, bookName: book.name, sourceType: source.type, sourceLabel: source.label });
        }
      }
    }
    return picked;
  }

  /** 拼成喂给 GEN_OUTLINE / EXTEND_OUTLINE 的 {{world}} 文本；超过上限按顺序截断 */
  function buildText(entries, { limit = 20 } = {}) {
    const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 20;
    return (entries ?? [])
      .slice(0, max)
      .map((entry) => `【${entry.bookName}】${entry.name}：${entry.content}`)
      .join('\n');
  }

  /** 书名 / 条目双通道搜索：命中书名时该书全部条目都保留 */
  function search(sources, keyword) {
    const needle = String(keyword ?? '').trim().toLowerCase();
    if (!needle) return sources ?? [];

    return (sources ?? []).map((source) => ({
      ...source,
      books: (source.books ?? []).map((book) => {
        const bookHit = String(book.name ?? '').toLowerCase().includes(needle);
        return {
          ...book,
          entries: (book.entries ?? []).filter((entry) => bookHit
            || String(entry.name ?? '').toLowerCase().includes(needle)
            || String(entry.content ?? '').toLowerCase().includes(needle)),
        };
      }),
    }));
  }

  return { collect, pick, pickSelected, loadBook, forget, buildText, search };
}
