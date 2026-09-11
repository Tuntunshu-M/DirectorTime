// 导演时间 · 装配
//
// 把各服务连起来并挂到酒馆事件上。没有这一层，模块写得再好插件也不会动。
//
// 事件约定（SillyTavern）：
//   message_received —— 一轮生成结束，此时 chat 末尾是 char 回复，倒数第二条是 user 输入
//   chat_id_changed  —— 切聊天，必须重新载入状态并清空注入

import { createDirectorClient } from './llm/client.js';
import { createStageService } from './director/stage.js';
import { createOutlineService } from './director/outline.js';
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
  const outline = createOutlineService({
    client,
    getConnection: () => settings().connection ?? {},
  });
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

  // ---------- 剧本生成 ----------
  // T-203 的接线：清单里漏了"首次生成剧本"这一步，不接上就永远不会自动生成
  // （之前 review.run 拿不到 active 阶段，只会 hold）。

  let generating = false;
  let autoGenerateTried = false;

  /** 剧情占比 → 可读文本，喂给 GEN_OUTLINE 的 {{tone}} */
  function toneText() {
    const labels = { daily: '日常', crisis: '危机', intimate: '亲密' };
    return Object.entries(store.get().tone ?? {})
      .filter(([, value]) => Number(value) > 0)
      .map(([key, value]) => `${labels[key] ?? key} ${value}%`)
      .join(' / ');
  }

  /** 近期对话 → {{context}}；人物侧写 / 世界书（T-401 / T-402）未做，留空 */
  function recentContext(limit = 8) {
    return ctx.getMessages()
      .slice(-limit)
      .map((message) => `${message?.is_user ? 'user' : 'char'}：${message?.mes ?? ''}`)
      .filter((line) => line.replace(/^(user|char)：/, '').trim().length > 0)
      .join('\n');
  }

  /**
   * 生成并装载一份分场剧本。
   * 失败一律只提示、不注入（禁则 G5）；未配置导演 API 时只提示。
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async function generateScript({ premise = '' } = {}) {
    if (generating) return { ok: false, error: '正在生成中' };
    if (!settings().connection?.endpoint) {
      ctx.showSystemMessage?.('导演时间：还没配置导演 API，先打开面板点「配置」');
      return { ok: false, error: '未配置导演 API' };
    }

    generating = true;
    ctx.showSystemMessage?.('导演时间：正在生成剧本…');
    try {
      const result = await outline.generate({
        premise,
        tone: toneText(),
        profile: '',
        world: '',
        context: recentContext(),
      });

      if (!result.ok || !result.stages?.length) {
        const reason = result.error ?? '模型没有产出可用阶段';
        ctx.showSystemMessage?.(`导演时间：生成剧本失败（${reason}）`);
        return { ok: false, error: reason };
      }

      store.update((draft) => ({
        ...draft,
        outline: result.outline,
        stages: result.stages,
        activeStageId: result.stages[0]?.id ?? null,
      }), { label: '生成剧本' });
      review.syncInjection();
      ctx.showSystemMessage?.(`导演时间：剧本《${result.outline.title}》已生成，共 ${result.stages.length} 个阶段`);
      return result;
    } catch (error) {
      console.error('[导演时间] 生成剧本异常', error);
      ctx.showSystemMessage?.(`导演时间：生成剧本异常（${error?.message ?? '未知错误'}）`);
      return { ok: false, error: error?.message ?? '未知错误' };
    } finally {
      generating = false;
    }
  }

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
      // 还没有剧本：先让导演生成一份（每个页面生命周期只自动试一次，失败用面板里的按钮重试）
      if (!store.get().stages?.length) {
        if (!autoGenerateTried) {
          autoGenerateTried = true;
          await generateScript({ premise: userMessage });
        }
        return;
      }

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

  // 主页面：运行状态 + 配置 + 生成剧本；由菜单栏入口打开
  const panel = createMainPanel({
    store,
    registry,
    getCapabilities: () => ctx.capabilities,
    getLast: () => review.getLastTurn(),
    onTest: () => client.testConnection(settings().connection ?? {}),
    onSave: () => registry.sync(),
    onGenerate: () => generateScript({}),
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
    client, stages, outline, registry, checkpoint, review, debug, generateScript,
    settingsPanel: settingsPanelApi, panel, unmountMenu,
  };

  if (typeof window !== 'undefined') {
    window.DirectorTime = { ...(window.DirectorTime ?? {}), ...api };
  }
  return api;
}
