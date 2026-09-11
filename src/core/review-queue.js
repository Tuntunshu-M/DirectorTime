// 导演时间 · 待审核队列（T-414 的 L1 档）
//
// L1 档下 AI 照跑，但结果**先落这里**，用户确认后才生效。
// 队列存在 state.pendingReview 里，所以关掉页面、切聊天都不会丢。
//
// 队列条目只存**数据**（JSON 可序列化），不存函数：
// 应用逻辑在确认时按 feature 去 handlers 里查，避免把闭包塞进状态。

let seq = 0;
function nextId() {
  seq += 1;
  return `pr_${Date.now().toString(36)}_${seq}`;
}

export function createReviewQueue({ store, now = Date.now } = {}) {
  const all = () => store?.get?.()?.pendingReview ?? [];
  const list = () => all().filter((entry) => entry?.status === 'pending');

  /** 进队；返回条目（含 id），调用方可以把它显示出来 */
  function add({ feature, payload = null, summary = '' } = {}) {
    if (!feature) return null;
    const entry = { id: nextId(), feature, payload, summary, status: 'pending', at: now() };
    store?.update?.((draft) => ({
      ...draft,
      pendingReview: [...(draft.pendingReview ?? []), entry],
    }), { track: false });
    return entry;
  }

  function find(id) {
    return all().find((entry) => entry.id === id) ?? null;
  }

  function mark(id, status, extra = {}) {
    store?.update?.((draft) => ({
      ...draft,
      pendingReview: (draft.pendingReview ?? []).map((entry) => (
        entry.id === id ? { ...entry, status, decidedAt: now(), ...extra } : entry
      )),
    }), { track: false });
  }

  /**
   * 确认：先跑 apply（如果这个 feature 有对应 handler），成功才销账。
   * handler 返回 false 或抛错 → 不销账、把错误交回调用方（条目保持 pending，可以再试）。
   */
  async function approve(id, handlers = {}) {
    const entry = find(id);
    if (!entry || entry.status !== 'pending') return { ok: false, error: '这条待审核不存在或已处理' };

    const handler = handlers?.[entry.feature];
    if (typeof handler === 'function') {
      try {
        const applied = await handler(entry.payload, entry);
        if (applied === false) return { ok: false, error: '应用失败，条目仍留在队列里' };
      } catch (error) {
        return { ok: false, error: error?.message ?? '应用时出错' };
      }
    }

    mark(id, 'approved');
    return { ok: true, entry };
  }

  function reject(id, reason = '') {
    const entry = find(id);
    if (!entry || entry.status !== 'pending') return { ok: false, error: '这条待审核不存在或已处理' };
    mark(id, 'rejected', reason ? { reason } : {});
    return { ok: true, entry };
  }

  function clear() {
    store?.update?.((draft) => ({ ...draft, pendingReview: [] }), { track: false });
    return [];
  }

  return { add, list, all, find, approve, reject, clear };
}
