// 导演时间 · 内部事件总线
//
// T-104。模块之间零直接引用；底层模块需要通知上层时，一律 emit，不许反向 import。

export function createEventBus() {
  const listeners = new Map();

  function on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => off(event, handler);
  }

  function off(event, handler) {
    listeners.get(event)?.delete(handler);
  }

  function once(event, handler) {
    const dispose = on(event, (payload) => {
      dispose();
      handler(payload);
    });
    return dispose;
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set?.size) return 0;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (error) {
        // 一个订阅者出错不应影响其它订阅者
        console.error(`[导演时间] 事件处理失败: ${event}`, error);
      }
    }
    return set.size;
  }

  function clear() {
    listeners.clear();
  }

  return { on, off, once, emit, clear };
}
