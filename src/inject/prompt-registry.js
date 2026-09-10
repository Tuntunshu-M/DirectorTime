// 导演时间 · 注入注册表
//
// T-204。项目书 §4.3「注入的六个坑」的落地：
//   1. 注册式 ≠ 一次性 —— 必须由本模块统一管理生命周期
//   2. 四个清空时机：总开关关 / 注入开关关 / 切聊天 / 剧本清空
//   3. clear 幂等，可重复调用
//   4. 暴露注册状态给 Debug 窗口
//
// 真正的 setExtensionPrompt 参数在 core/context.js 里封死（1/0/false/0），这里改不了。

// ST 事件常量：event_types.CHAT_CHANGED
const CHAT_CHANGED = 'chat_id_changed';

export const INJECT_KEY = 'director_time';

export function createPromptRegistry({ ctx, store, getSettings } = {}) {
  let current = null;
  let lastClearedAt = 0;

  function clear() {
    ctx.clearExtensionPrompt?.(INJECT_KEY);
    current = null;
    lastClearedAt = Date.now();
    // 记录清理次数，便于 Debug 发现"反复清理"这类异常
    try {
      store?.update?.((draft) => ({
        ...draft,
        runtime: {
          ...draft.runtime,
          promptRegistered: false,
          purgeCount: (draft.runtime?.purgeCount ?? 0) + 1,
        },
      }));
    } catch {
      /* 状态未就绪时不影响清理 */
    }
    return true;
  }

  /** 根据开关状态决定注入还是清空。改开关、切场景后调用它即可 */
  function sync() {
    const settings = getSettings?.() ?? {};
    if (!settings.enabled || !settings.injectEnabled) {
      clear();
      return false;
    }
    if (!current) return false;
    ctx.setExtensionPrompt?.(INJECT_KEY, current);
    try {
      store?.update?.((draft) => ({
        ...draft,
        runtime: { ...draft.runtime, promptRegistered: true },
      }));
    } catch {
      /* 忽略 */
    }
    return true;
  }

  /**
   * 写入本轮要注入的指令。开关关闭时不会真正注入（自动清空）。
   * @param {string} text 传空字符串等同于清空
   */
  function register(text) {
    if (!text) {
      clear();
      return false;
    }
    current = text;
    return sync();
  }

  function getStatus() {
    return {
      registered: current !== null,
      length: current?.length ?? 0,
      text: current,
      lastClearedAt,
    };
  }

  /** 挂生命周期：切聊天时必须清空，否则会污染另一个对话 */
  function installLifecycle() {
    return ctx.on?.(CHAT_CHANGED, clear);
  }

  return { register, clear, sync, getStatus, installLifecycle, INJECT_KEY };
}
