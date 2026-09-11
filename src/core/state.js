// 导演时间 · 状态仓库
//
// T-103。验收要求：
//   1. schemaVersion 存在，旧版本可读不崩
//   2. 每次写入校验不变量（有且仅一个 active 阶段）
//   3. 操作日志可追加、可撤销，上限可配
//   4. 导出 / 导入 JSON 快照往返无损

import { createDefaultState, createDefaultSettings } from './default-state.js';
import { migrate } from './migrations.js';

/**
 * 状态不变量：任一时刻有且仅有一个 active 阶段。
 * 违反说明状态机写错了，必须立刻暴露而不是静默继续。
 */
export function assertInvariants(state) {
  // T-416 起当前场可能是 active（演着）或 ready（已达成、收尾中），两者都算"当前"
  const current = (state.stages ?? []).filter((stage) => stage.status === 'active' || stage.status === 'ready');
  if (current.length > 1) {
    throw new Error(`[导演时间] 状态不变量被破坏：存在 ${current.length} 个 active/ready 阶段`);
  }
  if (state.activeStageId && current.length === 1 && current[0].id !== state.activeStageId) {
    throw new Error('[导演时间] 状态不变量被破坏：activeStageId 与实际 active/ready 阶段不一致');
  }
  return true;
}

export function createStateStore(ctx, moduleName = 'director_time') {
  let state = null;
  let settings = null;

  // ---------- 全局设置（extensionSettings）----------
  function getSettings() {
    if (settings) return settings;
    const store = ctx.getExtensionSettings();
    settings = { ...createDefaultSettings(), ...(store?.[moduleName] ?? {}) };
    return settings;
  }

  function saveSettings(patch = {}) {
    const store = ctx.getExtensionSettings();
    settings = { ...getSettings(), ...patch };
    store[moduleName] = settings;
    ctx.saveSettings?.();
    return settings;
  }

  // ---------- 聊天级状态（chatMetadata）----------
  function load() {
    const chatState = ctx.getChatState();
    state = migrate(chatState?.[moduleName]);
    return state;
  }

  function get() {
    return state ?? load();
  }

  function save() {
    const chatState = ctx.getChatState();
    if (!chatState) return false;
    chatState[moduleName] = state;
    ctx.saveChatState?.();
    return true;
  }

  function pushHistory(label, snapshot) {
    const limit = getSettings().historyLimit ?? 200;
    state.history = [...(state.history ?? []), { at: Date.now(), label, snapshot }];
    if (state.history.length > limit) {
      state.history = state.history.slice(state.history.length - limit);
    }
  }

  /**
   * 更新状态。mutator 返回新状态（或就地修改后返回）。
   * @param {(draft: object) => object} mutator
   * @param {{ label?: string, track?: boolean }} options
   */
  function update(mutator, options = {}) {
    const current = get();
    // 快照必须剔除 history 自身：否则"历史里套历史"，体积每步翻倍
    // （实测 10 步 43 万字符，滚动续写每轮 2 次带标签写入，十几轮就会 OOM）
    const snapshot = options.track === false ? null : structuredClone({ ...current, history: [] });
    const next = mutator(current) ?? current;

    state = next;
    assertInvariants(state);

    if (snapshot && options.label) pushHistory(options.label, snapshot);
    save();
    return state;
  }

  /** 撤销上一步 AI 修改（对应项目书 §1.4「一切可回退」） */
  function undo() {
    const current = get();
    const last = current.history?.[current.history.length - 1];
    if (!last) return null;

    state = migrate(last.snapshot);
    state.history = current.history.slice(0, -1);
    save();
    return state;
  }

  function clear() {
    state = createDefaultState();
    save();
    return state;
  }

  // ---------- 快照 ----------
  function exportSnapshot() {
    return JSON.stringify(get(), null, 2);
  }

  /** @returns {{ ok: boolean, error?: string }} */
  function importSnapshot(json) {
    try {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      const next = migrate(parsed);
      assertInvariants(next);
      state = next;
      save();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message ?? '导入失败' };
    }
  }

  return {
    get,
    load,
    save,
    update,
    undo,
    clear,
    exportSnapshot,
    importSnapshot,
    getSettings,
    saveSettings,
  };
}
