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
import { createBeatService } from './director/beats.js';
import { createCheckpointService } from './director/checkpoint.js';
import { createReviewService } from './director/review.js';
import { createPromptRegistry } from './inject/prompt-registry.js';
import { createLorebookService } from './world/lorebook.js';
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

/** 轮数上限的取整兜底：非法值回落到 defaultLimit */
export function normalizeMaxRounds(value, defaultLimit = 15) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : defaultLimit;
}

/** 是否已超过轮数上限（超过就清空剧本） */
export function shouldResetScript(rounds, maxRounds, defaultLimit = 15) {
  return Number(rounds) > normalizeMaxRounds(maxRounds, defaultLimit);
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
  const lorebook = createLorebookService({ ctx });
  const beats = createBeatService({
    client,
    getConnection: () => settings().connection ?? {},
  });
  const checkpoint = createCheckpointService({
    client,
    stages,
    getConnection: () => settings().connection ?? {},
    getSettings: settings,
  });
  const review = createReviewService({
    checkpoint,
    beats,
    topUp: topUpStages,
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
    getLastRequest: () => lastDirectorRequest,
  });

  // ---------- 剧本生成 ----------
  // T-203 的接线：清单里漏了"首次生成剧本"这一步，不接上就永远不会自动生成
  // （之前 review.run 拿不到 active 阶段，只会 hold）。
  // 注意：**不随消息自动生成**，只由总开关 + 「生成剧本」按钮显式触发。

  let generating = false;

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

  // ---------- 世界书（T-401 / M7）----------
  let worldCache = { at: 0, sources: [] };
  let lastDirectorRequest = '';

  /** 枚举世界书全部来源；30 秒内复用缓存，force=true 强制刷新 */
  async function collectWorldSources(force = false) {
    if (!force && worldCache.sources.length && Date.now() - worldCache.at < 30000) return worldCache.sources;
    const sources = await lorebook.collect();
    worldCache = { at: Date.now(), sources };
    return sources;
  }

  /** 勾选条目 → 喂给 {{world}} 的文本；一条没勾就返回空串，不占 prompt */
  async function worldText() {
    const selection = settings().worldSelection ?? {};
    if (!Object.keys(selection).length) return '';
    const sources = await collectWorldSources();
    return lorebook.buildText(lorebook.pick(sources, selection), { limit: settings().worldLimit ?? 20 });
  }

  /** 记录最近一次发给导演 API 的 user 文本，供 Debug 核对实际发送内容（T-401 验收） */
  function rememberRequest(result) {
    const user = (result?.request ?? []).find((message) => message.role === 'user');
    if (user?.content) lastDirectorRequest = user.content;
    return result;
  }

  /**
   * 生成并装载一份分场剧本。显式调用，不自动跑。
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
      const result = rememberRequest(await outline.generate({
        premise,
        tone: toneText(),
        profile: '',
        world: await worldText(),
        context: recentContext(),
      }));

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

  /** 「重新生成剧本」：已有剧本时先确认，再整份重写 */
  async function regenerateScript() {
    if (store.get().stages?.length && ctx.capabilities?.confirmation) {
      const ok = await ctx.showConfirm?.('重新生成会丢弃当前剧本。继续？');
      if (!ok) return { ok: false, error: '已取消' };
    }
    return generateScript({});
  }

  // 待演阶段的存货目标：少于这个数就续写，保证"演完一场还有下一场"
  const TARGET_PENDING = 2;

  /** 本场戏已经跑了多少轮（每完成一次复盘 +1） */
  function countRound() {
    let rounds = 0;
    store.update((draft) => {
      rounds = (draft.runtime?.rounds ?? 0) + 1;
      return { ...draft, runtime: { ...draft.runtime, rounds } };
    }, { track: false });
    return rounds;
  }

  /** 清空剧本与历史（保留设置、花费与偏好），并清空注入 */
  function resetScript(notice = '导演时间：剧本已清空') {
    store.update((draft) => ({
      ...draft,
      outline: null,
      stages: [],
      activeStageId: null,
      history: [],
      runtime: { ...draft.runtime, rounds: 0, promptRegistered: false },
    }), { track: false });
    registry.clear();
    ctx.showSystemMessage?.(notice);
    return store.get();
  }

  /**
   * 待演阶段不够就续写（T-209）。失败只记日志、不动剧本（G5）。
   * @param {{ force?: boolean }} options force=true 时无视存货直接续写（面板「重新续写」）
   */
  async function topUpStages({ force = false } = {}) {
    const state = store.get();
    const list = state.stages ?? [];
    const pending = list.filter((stage) => stage.status === 'pending').length;
    if (!force && pending >= TARGET_PENDING) return null;
    if (!state.outline || !settings().connection?.endpoint) return null;

    const need = force ? TARGET_PENDING : TARGET_PENDING - pending;
    if (need <= 0) return null;

    const marks = { done: '已演', active: '正在演', pending: '待演' };
    const history = list
      .map((stage) => `- [${marks[stage.status] ?? stage.status}] ${stage.title}：${stage.goal}`)
      .join('\n');

    const result = rememberRequest(await outline.extend({
      count: need,
      startIndex: list.length + 1,
      outline: state.outline,
      tone: toneText(),
      profile: '',
      world: await worldText(),
      history,
      context: recentContext(),
    }));

    if (!result.ok || !result.stages?.length) {
      console.warn('[导演时间] 续写阶段失败', result.error);
      return null;
    }

    stages.append(result.stages);
    // 极端情况：剧本只有一场、演完才续写 —— 补位激活第一条，别让导演停摆
    if (!store.get().activeStageId) stages.activate(result.stages[0].id);
    console.log(`[导演时间] 已续写 ${result.stages.length} 个阶段`);
    return result;
  }

  /**
   * 导演时间总开关。
   * 开：恢复注入（有剧本时）；关：立刻清空注入（T-204 的四个清空时机之一）。
   */
  function setEnabled(value) {
    store.saveSettings({ enabled: Boolean(value) });
    // 关 → 立刻清空；开 → 用当前阶段重建注入（registry 里的 current 在 clear 后是空的）
    if (settings().enabled) review.syncInjection();
    else registry.clear();
    return Boolean(settings().enabled);
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
    // 还没有剧本就不动 —— 生成由用户显式触发，不随消息自动生成
    if (!store.get().stages?.length) return;

    try {
      const result = await review.run({ userMessage, charMessage, type: 'normal' });
      // 把模型原始返回也喂给 Debug —— 云酒馆看不到控制台，只能靠面板
      const turn = review.getLastTurn();
      if (turn) debug.setLast({ ...turn, raw: result?.raw ?? turn.judgement ? JSON.stringify(turn.judgement) : '' });

      // 跑过上限就清空重来，避免剧本与历史无限膨胀（上限可在配置里改）
      if (!result?.skipped && shouldResetScript(countRound(), settings().maxRounds)) {
        resetScript(`导演时间：已超过 ${normalizeMaxRounds(settings().maxRounds)} 轮，剧本已清空，点「生成剧本」开新戏`);
      }
    } catch (error) {
      console.error('[导演时间] 复盘失败', error);
    }
  });

  // 测试用配置面板：没有它就没法填 API（控制台 DirectorTime.settingsPanel.show() 仍可用）
  const settingsPanel = createSettingsPanel({
    store,
    onTest: () => client.testConnection(settings().connection ?? {}),
    onSave: () => review.syncInjection(),
  });

  // 同一时刻只允许一个面板在场：开哪个，就把另外两个收起来
  function openOnly(target) {
    if (target !== 'panel') panel?.close();
    if (target !== 'debug') debug.hide();
    if (target !== 'settings') settingsPanel.hide();
  }

  // 主页面：总开关 + 运行状态 + 配置 + 生成剧本；由菜单栏入口打开
  const panel = createMainPanel({
    store,
    registry,
    getCapabilities: () => ctx.capabilities,
    getLast: () => review.getLastTurn(),
    onTest: () => client.testConnection(settings().connection ?? {}),
    onSave: () => review.syncInjection(),
    onGenerate: () => regenerateScript(),
    onExtend: () => topUpStages({ force: true }),
    loadWorldSources: (force) => collectWorldSources(force),
    getWorldSelection: () => settings().worldSelection ?? {},
    saveWorldSelection: (selection) => store.saveSettings({ worldSelection: selection }),
    getWorldText: () => worldText(),
    getEnabled: () => Boolean(settings().enabled),
    onToggleEnabled: (value) => setEnabled(value),
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
    client, stages, outline, beats, lorebook, registry, checkpoint, review, debug,
    generateScript, regenerateScript, topUpStages, resetScript, setEnabled,
    collectWorldSources, worldText,
    settingsPanel: settingsPanelApi, panel, unmountMenu,
  };

  if (typeof window !== 'undefined') {
    window.DirectorTime = { ...(window.DirectorTime ?? {}), ...api };
  }
  return api;
}
