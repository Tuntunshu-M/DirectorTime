// 导演时间 · 装配
//
// 把各服务连起来并挂到酒馆事件上。没有这一层，模块写得再好插件也不会动。
//
// 事件约定（SillyTavern）：
//   message_received —— 一轮生成结束，此时 chat 末尾是 char 回复，倒数第二条是 user 输入
//   chat_id_changed  —— 切聊天，必须重新载入状态并清空注入

import { createDirectorClient } from './llm/client.js';
import { createStageService } from './director/stage.js';
import { createCheckpointService } from './director/checkpoint.js';
import { createReviewService } from './director/review.js';
import { createPromptRegistry } from './inject/prompt-registry.js';
import { createDebugPanel } from './ui/debug.js';
import { createSettingsPanel } from './ui/settings.js';
import { createMainPanel } from './ui/panel.js';
import { mountMenuEntry } from './ui/menu.js';

const MESSAGE_RECEIVED = 'message_received';
const CHAT_CHANGED = 'chat_id_changed';

/** 从 chat 末尾取出本轮的 user 输入与 char 回复 */
export function lastTurnMessages(messages = []) {
  if (!messages.length) return { userMessage: '', charMessage: '' };
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];

  // 最后一条是 user 的情况（例如用户连发两条）
  if (last?.is_user) {
    return { userMessage: last.mes ?? '', charMessage: '' };
  }
  return {
    userMessage: prev?.is_user ? (prev.mes ?? '') : '',
    charMessage: last?.mes ?? '',
  };
}

export function bootstrap({ ctx, store } = {}) {
  const settings = () => store.getSettings();

  const client = createDirectorClient();
  const stages = createStageService({ store });
  const registry = createPromptRegistry({ ctx, store, getSettings: settings });
  const checkpoint = createCheckpointService({
    client,
    stages,
    getConnection: () => settings().connection ?? {},
    getSettings: settings,
  });
  const review = createReviewService({
    checkpoint,
    stages,
    registry,
    store,
    getSettings: settings,
  });
  const debug = createDebugPanel({
    store,
    registry,
    getCapabilities: () => ctx.capabilities,
    getLastTurn: () => review.getLastTurn(),
  });

  // 切聊天必须清空，否则会把上一个对话的指令带过去
  registry.installLifecycle();
  ctx.on?.(CHAT_CHANGED, () => {
    store.load();
    registry.clear();
  });

  ctx.on?.(MESSAGE_RECEIVED, async () => {
    if (!settings().enabled) return;
    const { userMessage, charMessage } = lastTurnMessages(ctx.getMessages());
    try {
      const result = await review.run({ userMessage, charMessage, type: 'normal' });
      // 把模型原始返回也喂给 Debug —— 云酒馆看不到控制台，只能靠面板
      const turn = review.getLastTurn();
      if (turn) debug.setLast({ ...turn, raw: result?.raw ?? turn.judgement ? JSON.stringify(turn.judgement) : '' });
    } catch (error) {
      console.error('[导演时间] 复盘失败', error);
    }
  });

  // 测试用配置面板：没有它就没法填 API（控制台 DirectorTime.settingsPanel.show() 仍可用）
  const settingsPanel = createSettingsPanel({
    store,
    onTest: () => client.testConnection(settings().connection ?? {}),
    onSave: () => registry.sync(),
  });

  // 同一时刻只允许一个面板在场：开哪个，就把另外两个收起来
  function openOnly(target) {
    if (target !== 'panel') panel?.close();
    if (target !== 'debug') debug.hide();
    if (target !== 'settings') settingsPanel.hide();
  }

  // 主页面：运行状态 + 配置；由菜单栏入口打开
  const panel = createMainPanel({
    store,
    registry,
    getCapabilities: () => ctx.capabilities,
    getLast: () => review.getLastTurn(),
    onTest: () => client.testConnection(settings().connection ?? {}),
    onSave: () => registry.sync(),
    onOpenDebug: () => { openOnly('debug'); debug.show(); },
  });

  // 入口挂在酒馆扩展菜单（#extensionsMenu）。点开是主页面，不再自动弹配置
  const unmountMenu = mountMenuEntry({ onOpen: () => { openOnly('panel'); panel.open(); } });

  // 控制台入口也走互斥，避免出现第二个面板
  const settingsPanelApi = {
    ...settingsPanel,
    show: () => { openOnly('settings'); return settingsPanel.show(); },
  };

  const api = {
    client, stages, registry, checkpoint, review, debug,
    settingsPanel: settingsPanelApi, panel, unmountMenu,
  };

  if (typeof window !== 'undefined') {
    window.DirectorTime = { ...(window.DirectorTime ?? {}), ...api };
  }
  return api;
}
