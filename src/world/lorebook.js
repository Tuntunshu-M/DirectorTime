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
  /** 枚举全部来源并加载条目；单个书加载失败只记录、不中断 */
  async function collect() {
    const sources = [];
    for (const source of ctx?.getLorebookSources?.() ?? []) {
      if (source.embedded) {
        const entries = (ctx?.getCharacterBookEntries?.() ?? [])
          .map((entry, index) => normalizeEntry(entry, index, source.label));
        sources.push({ ...source, books: [{ name: source.label, entries }] });
        continue;
      }

      const books = [];
      for (const name of source.names ?? []) {
        try {
          const book = await ctx.loadWorldInfoBook(name);
          books.push({ name, entries: (book?.entries ?? []).map((entry, index) => normalizeEntry(entry, index, name)) });
        } catch (error) {
          books.push({ name, entries: [], error: error?.message ?? '加载失败' });
        }
      }
      sources.push({ ...source, books });
    }
    return sources;
  }

  /** 按勾选挑出要进 prompt 的条目（保持来源顺序） */
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

  return { collect, pick, buildText, search };
}
