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
import { createWillService } from './director/will.js';
import { createInitiativeService, stampInitiative } from './director/initiative.js';
import { resolveRules } from './director/rules.js';
import { createBreakFilterService, normalizeBreakFilter } from './llm/break-filter.js';
import { createPresetService } from './inject/preset.js';
import { createSpeculationService } from './director/speculate.js';
import { carryOver, foreshadowText, openForeshadows, resolveRecalled } from './director/foreshadow.js';
import { hardLimitText } from './director/hard-limits.js';
import { findUserDirectives, findFinishedLines, describeIssues } from './director/actor-guard.js';
import { normalizeProtagonists, protagonistText } from './world/cast.js';
import { gate, setLevel, normalizeAutomation } from './core/automation.js';
import { createReviewQueue } from './core/review-queue.js';
import {
  BUILTIN_PRESETS, PRESET_LABELS, PRESET_KINDS, normalizeModelPreset, modelPresetText,
} from './core/model-preset.js';
import { createEditorService } from './director/editor.js';
import { extensionFolderFromUrl, createExtensionUpdater, checkForUpdate } from './core/update-check.js';
import { toneText as coreToneText, rebalanceTone, normalizeTone, TONE_KEYS } from './core/tone.js';
import { createDefaultRules } from './core/default-state.js';
import { exportCopy, previewCopy, applyCopy } from './core/portable.js';
import { createCheckpointService } from './director/checkpoint.js';
import { createReviewService } from './director/review.js';
import { createPromptRegistry } from './inject/prompt-registry.js';
import { createLorebookService } from './world/lorebook.js';
import { createProfileService, profileText, PROFILE_FIELDS } from './world/character.js';
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

  // T-418 破限预设：选一个酒馆预设、并可自选条目当破限词（只读）
  const presets = createPresetService({
    ctx,
    getPreset: () => settings().preset,
    setPreset: (next) => store.saveSettings({ preset: next }),
  });

  // T-411 破限词：只影响导演 API 请求（client.js 的 getBreakText 是唯一出口）
  // 「跟随酒馆预设」的内容来自 T-418 选中的预设；没选 → 空串（不注入任何额外内容）
  const breakFilter = createBreakFilterService({
    getFilter: () => settings().breakFilter,
    getPresetText: () => presets.text(),
  });

  // T-403 / F10 槽位管线：[破限词] → [模型特化预设] → [导演指令]
  const redlineText = () => modelPresetText(settings().modelPreset);
  const client = createDirectorClient({
    getBreakText: () => [breakFilter.text(), redlineText()].filter(Boolean).join('\n\n'),
  });
  const stages = createStageService({ store });
  const outline = createOutlineService({
    client,
    getConnection: () => settings().connection ?? {},
  });
  const registry = createPromptRegistry({ ctx, store, getSettings: settings });
  const lorebook = createLorebookService({ ctx });
  const profile = createProfileService({
    ctx,
    client,
    getConnection: () => settings().connection ?? {},
  });
  const beats = createBeatService({
    client,
    getConnection: () => settings().connection ?? {},
  });
  const checkpoint = createCheckpointService({
    client,
    stages,
    getConnection: () => settings().connection ?? {},
    getSettings: settings,
    // T-408：判定时把待回收伏笔一起发过去，顺手销账
    getOutline: () => store.get().outline,
  });
  const will = createWillService({
    client,
    getConnection: () => settings().connection ?? {},
    getRules: () => settings().rules,
  });

  // T-406：词库编辑入口（判据 1 —— 增删改都直接落进 settings，重启仍在）
  const rulesApi = {
    get: () => resolveRules(settings().rules),
    set: (next) => {
      store.saveSettings({ rules: next });
      return resolveRules(settings().rules);
    },
    reset: () => {
      store.saveSettings({ rules: createDefaultRules() });
      return resolveRules(settings().rules);
    },
  };
  const initiative = createInitiativeService({
    client,
    getConnection: () => settings().connection ?? {},
    stages,
  });
  const speculate = createSpeculationService({
    client,
    getConnection: () => settings().connection ?? {},
    store,
  });
  // T-414：L1 档的待审核队列（存 state.pendingReview，切页面不丢）
  const queue = createReviewQueue({ store });

  const review = createReviewService({
    checkpoint,
    will,
    initiative,
    speculate,
    beats,
    topUp: topUpStages,
    queue,
    getProfile: () => profile.read(),
    // T-403：模型特化预设（红线）—— 角色回复端那一半
    getRedline: () => redlineText(),
    // T-412 多人卡：当前生成者是谁
    getSpeaker: () => ({
      id: ctx.getCharacterId?.() ?? '',
      name: ctx.getCharacterData?.()?.name ?? '',
    }),
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
    // T-418 / T-422：Debug 里必须一眼看出"到底注入了没有"，不能只报"选了预设"
    getBreakStatus: () => {
      const filter = normalizeBreakFilter(settings().breakFilter);
      return {
        mode: filter.mode,
        preset: presets.status(),
        customLength: String(filter.custom ?? '').trim().length,
        // 真正会进请求的字数（mode=off 时是 0，别被"选了预设"骗了）
        injected: (breakFilter.text() ?? '').length,
      };
    },
    });

  // ---------- 剧本生成 ----------
  // T-203 的接线：清单里漏了"首次生成剧本"这一步，不接上就永远不会自动生成
  // （之前 review.run 拿不到 active 阶段，只会 hold）。
  // 注意：**不随消息自动生成**，只由总开关 + 「生成剧本」按钮显式触发。

  let generating = false;

  /** 剧情占比 → 可读文本，喂给 GEN_OUTLINE 的 {{tone}}（T-415 起走 core/tone） */
  function toneText() {
    return coreToneText(store.get().tone);
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
    // 世界书选择是 **chat 级**的（每个聊天记自己那份），不再是全局设置
    const selection = store.get().worldSelection ?? {};
    if (!Object.keys(selection).length) return '';
    const sources = await collectWorldSources();
    return lorebook.buildText(lorebook.pick(sources, selection), { limit: settings().worldLimit ?? 20 });
  }

  /**
   * 老数据兼容：世界书选择以前存在全局 settings 里，现在搬到 chat 级。
   * 当前聊天还没有选择、而全局设置里有 → 先把全局那份搬过来（只搬一次）。
   */
  function seedWorldSelection() {
    const stateSelection = store.get().worldSelection ?? {};
    if (Object.keys(stateSelection).length) return;
    const legacy = settings().worldSelection ?? {};
    if (!Object.keys(legacy).length) return;
    store.update((draft) => ({ ...draft, worldSelection: { ...legacy } }), { track: false });
  }

  // 开局也迁一次：老用户的全局勾选不至于丢
  seedWorldSelection();

  /**
   * P0 兜底：检查剧本有没有在指挥 user（演员错位）、有没有把台词写死（会被原样复述）。
   * **只报警，不改剧本、不打断生成** —— prompt 是第一道网，这里是第二道。
   */
  function warnScriptIssues(stages, where = '剧本') {
    const actorIssues = findUserDirectives(stages);
    // §七c 单独报：达成条件要 user 配合 = 剧情会卡死，比"替 user 做决定"更致命
    const dependsOnUser = actorIssues.filter((issue) => issue.kind === 'criteria-depends-on-user');
    const directsUser = actorIssues.filter((issue) => issue.kind !== 'criteria-depends-on-user');
    if (directsUser.length) {
      console.warn(
        `[导演时间] ${where}又把 user 写成了演员（P0）：\n${describeIssues(directsUser)}\n`
        + '建议点「重新生成剧本」；若反复出现，把这段贴给维护者。'
      );
    }
    if (dependsOnUser.length) {
      console.warn(
        `[导演时间] ${where}的达成条件要 user 配合（P0：user 不配合就永远过不了）：\n${describeIssues(dependsOnUser)}\n`
        + '建议点「重新生成剧本」；若反复出现，把这段贴给维护者。'
      );
    }
    const lineIssues = findFinishedLines(stages);
    if (lineIssues.length) {
      console.warn(
        `[导演时间] ${where}把台词写死了（会被 char 原样复述）：\n${describeIssues(lineIssues)}\n`
        + '应改成"写意图不给成品"。'
      );
    }
    return { actorIssues, lineIssues };
  }

  /** 记录最近一次发给导演 API 的 user 文本，供 Debug 核对实际发送内容（T-401 验收） */
  function rememberRequest(result) {
    const user = (result?.request ?? []).find((message) => message.role === 'user');
    if (user?.content) lastDirectorRequest = user.content;
    return result;
  }

  /**
   * 生成结果一致性自检（T-402 §六）：不合人设就重生成，最多 2 次，超过用最后一次。
   * 自检关掉 / 没有侧写 / 重生成失败 → 直接用原结果。
   */
  async function ensureConsistent(result, regenerate) {
    if (settings().consistencyCheck === false) return result;
    if (!profileText(profile.read())) return result;
    // T-414：一致性自检档位 —— L0 不自动跑
    const consistencyGate = gate(settings().automation, 'consistency');
    if (!consistencyGate.auto) return result;

    let current = result;
    // T-404：锁定的阶段是用户显式写的，不参与一致性自检、也不会被重生成替换
    const checkable = () => (current.stages ?? []).filter((stage) => !stage.locked);
    if (!checkable().length) return current;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const verdict = await profile.checkConsistency({ profile: profile.read(), stages: checkable() });
      if (verdict.ok) return current;
      console.log(`[导演时间] 阶段与人设不符，重生成（第 ${attempt} 次）：${verdict.reason}`);
      const retry = rememberRequest(await regenerate());
      if (!retry.ok || !retry.stages?.length) return current;

      // T-414：L1 → 不自作主张换成重生成版本，先问用户
      if (consistencyGate.queue) {
        queue.add({
          feature: 'consistency',
          payload: { stages: retry.stages },
          summary: `自检认为不符人设（${verdict.reason}），建议换成重生成版本`,
        });
        return current;
      }
      current = retry;
    }
    return current;
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
      const vars = {
        premise,
        objective: settings().objective ?? '',
        tone: toneText(),
        profile: profileText(profile.read()),
        world: await worldText(),
        // T-412：主角列表（多个主角时，每个阶段用 actorId 指明是谁的戏）
        protagonists: protagonistText(settings().protagonists),
        // T-410：硬禁区也约束剧情生成（用户显式 > 侧写禁忌）
        hardLimits: hardLimitText(settings().hardLimits),
        // T-408：把还没回收的伏笔告诉导演，别重复埋、能回收就回收
        foreshadows: foreshadowText(store.get().outline),
        context: recentContext(),
      };
      let result = rememberRequest(await outline.generate(vars));

      if (!result.ok || !result.stages?.length) {
        const reason = result.error ?? '模型没有产出可用阶段';
        ctx.showSystemMessage?.(`导演时间：生成剧本失败（${reason}）`);
        return { ok: false, error: reason };
      }

      // 一致性自检（默认开，T-402 §六）：不合人设最多重生成 2 次
      result = await ensureConsistent(result, () => outline.generate(vars));
      // P0：剧本不许指挥 user、不许把台词写死（只报警）
      warnScriptIssues(result.stages, '生成的剧本');

      const loaded = {
        // T-408：重生成剧本时，上一份**还没回收的伏笔不能丢**（验收判据 1）
        outline: carryOver(store.get().outline, result.outline),
        // T-417：盖章记下这批 initiative 是按哪一版侧写推出来的
        stages: stampInitiative(result.stages, profile.read()),
      };

      // T-414：大纲档位 L1 → 生成完先进待审核队列，确认后才装载
      if (gate(settings().automation, 'outline').queue) {
        queue.add({
          feature: 'outline',
          payload: loaded,
          summary: `剧本《${result.outline.title}》，${result.stages.length} 个阶段`,
        });
        ctx.showSystemMessage?.(`导演时间：剧本《${result.outline.title}》已生成，等你在面板确认后生效（大纲档位 L1）`);
        return { ok: true, pending: true, outline: result.outline, stages: result.stages };
      }

      store.update((draft) => ({
        ...draft,
        ...loaded,
        activeStageId: loaded.stages[0]?.id ?? null,
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

  /**
   * T-407 投机执行：不等 user 开口，先猜下一句并提前写好指令。
   * 任何失败都静默（吞掉异常、不提示），猜不中下一轮复盘时自动降级。
   */
  let speculating = false;
  async function speculateNext() {
    if (speculating) return null;
    try {
      if (settings().speculation === false) return null;
      if (!settings().connection?.endpoint) return null;
      const active = stages.getActive();
      if (!active) return null;

      speculating = true;
      const { userMessage, charMessage } = lastTurnMessages(ctx.getMessages());
      const record = await speculate.guess({
        stage: active,
        outline: store.get().outline,
        userMessage,
        charMessage,
      });
      if (!record) return null;
      // 猜中就用：先一步把它注册成下一轮的注入（猜不中下轮复盘会静默降级）
      registry.register(record.injection);
      return record;
    } catch (error) {
      console.error('[导演时间] 投机执行失败（已静默降级）', error);
      return null;
    } finally {
      speculating = false;
    }
  }

  /** 清空剧本与历史（保留设置、花费与偏好），并清空注入 */
  function resetScript(notice = '导演时间：剧本已清空') {
    store.update((draft) => ({
      ...draft,
      outline: null,
      stages: [],
      activeStageId: null,
      history: [],
      // 投机预测跟着剧本一起作废
      runtime: { ...draft.runtime, rounds: 0, promptRegistered: false, speculation: null },
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

    const vars = {
      count: need,
      startIndex: list.length + 1,
      outline: state.outline,
      // T-416：续写必须带上主目标，否则续着续着就跑偏
      objective: state.outline?.objective ?? '',
      tone: toneText(),
      profile: profileText(profile.read()),
      world: await worldText(),
      // T-412：续写也要知道主角是谁
      protagonists: protagonistText(settings().protagonists),
      // T-410：续写同样带上硬禁区
      hardLimits: hardLimitText(settings().hardLimits),
      // T-408：续写也要知道哪些坑还没填
      foreshadows: foreshadowText(state.outline),
      history,
      context: recentContext(),
    };
    const generated = rememberRequest(await outline.extend(vars));

    if (!generated.ok || !generated.stages?.length) {
      console.warn('[导演时间] 续写阶段失败', generated.error);
      return null;
    }

    // 一致性自检（默认开，T-402 §六）
    const result = await ensureConsistent(generated, () => outline.extend(vars));
    // P0：续写的阶段同样不许指挥 user、不许写死台词（只报警）
    warnScriptIssues(result.stages, '续写的阶段');
    // T-417：同样盖章
    const fresh = stampInitiative(result.stages, profile.read());

    // T-414：阶段重生成档位 —— L0 不自动续写（手动点「续写」仍可用）；L1 先进队列
    const regenGate = gate(settings().automation, 'stageRegen');
    if (!force && !regenGate.auto) return null;
    if (!force && regenGate.queue) {
      queue.add({
        feature: 'stageRegen',
        payload: { stages: fresh },
        summary: `续写 ${fresh.length} 个阶段：${fresh.map((stage) => stage.title).join('、')}`,
      });
      console.log('[导演时间] 续写结果进入待审核队列（L1）');
      return null;
    }

    stages.append(fresh);
    // 极端情况：剧本只有一场、演完才续写 —— 补位激活第一条，别让导演停摆
    if (!store.get().activeStageId) stages.activate(fresh[0].id);
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
    // 切聊天：剧本 / 进度 / 世界书选择都跟着这一聊天的记录走（存在 chatMetadata 里）
    seedWorldSelection();
    registry.clear();
    // 换了聊天，上一轮的投机预测作废（否则会拿别的聊天的预测去猜）
    store.update((draft) => ({ ...draft, runtime: { ...draft.runtime, speculation: null } }), { track: false });
  });

  ctx.on?.(MESSAGE_RECEIVED, async () => {
    if (!settings().enabled) return;
    const { userMessage, charMessage } = lastTurnMessages(ctx.getMessages());
    // 还没有剧本就不动 —— 生成由用户显式触发，不随消息自动生成
    if (!store.get().stages?.length) return;

    try {
      const result = await review.run({ userMessage, charMessage, type: 'normal' });
      // T-410：命中硬禁区就停下，并且要让用户知道为什么停
      if (result?.action === 'halt') {
        ctx.showSystemMessage?.(`导演时间：${result.reason}，已停止本轮注入`);
      }
      // 把模型原始返回也喂给 Debug —— 云酒馆看不到控制台，只能靠面板
      const turn = review.getLastTurn();
      if (turn) debug.setLast({ ...turn, raw: turn.raw || (turn.judgement ? JSON.stringify(turn.judgement) : '') });

      // 跑过上限就清空重来，避免剧本与历史无限膨胀（上限可在配置里改）
      if (!result?.skipped && shouldResetScript(countRound(), settings().maxRounds)) {
        resetScript(`导演时间：已超过 ${normalizeMaxRounds(settings().maxRounds)} 轮，剧本已清空，点「生成剧本」开新戏`);
      } else if (!result?.skipped) {
        // T-407 投机执行：给下一轮做功课。**不 await** —— 不该拖慢本轮
        speculateNext();
      }
    } catch (error) {
      console.error('[导演时间] 复盘失败', error);
    }
  });

  // 侧写读写接口（T-402）：给设置面板的折叠区用
  const profileApi = {
    read: () => profile.read(),
    edit: (field, value) => profile.edit(field, value),
    unlock: (field) => profile.unlock(field),
    regenerate: async () => {
      const current = profile.read();
      const lockedCount = Object.values(current.locked ?? {}).filter(Boolean).length;
      if (lockedCount && ctx.capabilities?.confirmation) {
        const ok = await ctx.showConfirm?.(`有 ${lockedCount} 个字段已锁定，重新生成不会覆盖它们。继续？`);
        if (!ok) return { ok: false, error: '已取消' };
      }
      // T-414：侧写档位 L1 → 生成完先进队列，确认后才写入
      if (gate(settings().automation, 'profile').queue) {
        const generated = await profile.generate({ world: await worldText(), context: recentContext() });
        if (!generated.ok) return generated;
        const fields = { ...generated.fields };
        for (const key of PROFILE_FIELDS) {
          if (current.locked?.[key] && String(current.fields?.[key] ?? '').trim()) fields[key] = current.fields[key];
        }
        queue.add({
          feature: 'profile',
          payload: { profile: { ...current, fields, source: 'ai' } },
          summary: '重新生成的侧写（确认后覆盖，锁定字段不受影响）',
        });
        return { ok: true, pending: true, fields };
      }

      const result = await profile.regenerate({ world: await worldText(), context: recentContext() });
      if (result.ok) review.syncInjection();
      return result;
    },
  };

  /** T-414：待审核条目的落地动作（按 feature 查表，队列里只存数据不存函数） */
  const queueHandlers = {
    outline: (payload) => {
      const stages = payload?.stages ?? [];
      store.update((draft) => ({
        ...draft, outline: payload?.outline ?? null, stages, activeStageId: stages[0]?.id ?? null,
      }), { label: '确认大纲' });
      review.syncInjection();
      return true;
    },
    stageRegen: (payload) => {
      const fresh = payload?.stages ?? [];
      if (!fresh.length) return false;
      stages.append(fresh);
      if (!store.get().activeStageId) stages.activate(fresh[0].id);
      review.syncInjection();
      return true;
    },
    consistency: (payload) => {
      const fresh = payload?.stages ?? [];
      if (!fresh.length) return false;
      store.update((draft) => ({ ...draft, stages: fresh, activeStageId: fresh[0]?.id ?? draft.activeStageId }), { label: '确认重生成' });
      review.syncInjection();
      return true;
    },
    profile: (payload) => {
      if (!payload?.profile) return false;
      profile.save(payload.profile);
      review.syncInjection();
      return true;
    },
    stanceJudge: (payload) => review.applyConfirmed(payload),
    checkpointJudge: (payload) => review.applyConfirmed(payload),
  };


  // 同一时刻只允许一个面板在场：开哪个，就把另外两个收起来
  function openOnly(target) {
    if (target !== 'panel') panel?.close();
    if (target !== 'debug') debug.hide();
    if (target !== 'settings') settingsPanel.hide();
  }

  // 主页面：总开关 + 运行状态 + 配置 + 生成剧本；由菜单栏入口打开
  // T-420 一键更新：在导演时间里点一下就更新 + 自动刷新
  const MANIFEST_URL = new URL('../manifest.json', import.meta.url).href;
  const updater = createExtensionUpdater({
    ctx,
    folder: extensionFolderFromUrl(import.meta.url),
    // 更新成功后交给"版本检查"去刷新：它会记下新版本 + 打 sessionStorage 标记，避免重复刷新
    refreshVersion: () => checkForUpdate({
      ctx,
      store,
      manifestUrl: `${MANIFEST_URL}?t=${Date.now()}`,
      sessionStore: globalThis.sessionStorage,
    }),
    reload: () => globalThis.location?.reload?.(),
    // 上次试成功的那条路径记下来，下次先试它（也便于排查"这个酒馆认哪种名字"）
    remembered: () => settings().updatePath,
    remember: (candidate) => store.saveSettings({ updatePath: candidate }),
    delayMs: 400, // 面板上要来得及显示"更新完成"
  });
  const updateApi = {
    folder: () => updater.folder,
    path: () => settings().updatePath ?? null,
    version: () => settings().loadedVersion ?? '',
    apply: () => updater.apply(),
  };

  // T-414：档位与待确认队列的读写口（面板与配置页共用）
  const automationApi = {
    get: () => normalizeAutomation(settings().automation),
    set: (feature, level) => {
      store.saveSettings({ automation: setLevel(settings().automation, feature, level) });
      return normalizeAutomation(settings().automation);
    },
  };
  const queueApi = {
    list: () => queue.list(),
    approve: (id) => queue.approve(id, queueHandlers),
    reject: (id) => queue.reject(id),
    clear: () => queue.clear(),
  };

  // ---------- T-404 剧本编辑器 ----------
  const editorApi = createEditorService({
    store,
    onChanged: () => review.syncInjection(),
  });
  /** 从当前阶段往后截断，然后立刻续写一批新的（项目书 F1「截断重生成」） */
  async function truncateAndRegen() {
    const cut = editorApi.truncateAfterCurrent();
    if (!cut) return { ok: false, error: '现在没有正在演出的阶段' };
    const fresh = await topUpStages({ force: true });
    return { ok: Boolean(fresh), stages: fresh?.length ?? 0 };
  }

  // ---------- T-403 模型特化预设（红线）----------
  const modelPresetApi = {
    get: () => normalizeModelPreset(settings().modelPreset),
    kind: () => normalizeModelPreset(settings().modelPreset).kind,
    kinds: () => [...PRESET_KINDS],
    labels: () => ({ ...PRESET_LABELS }),
    text: () => redlineText(),
    /** 内置文本：不传 kind 就是当前这套的 */
    defaultText: (kind) => BUILTIN_PRESETS[kind ?? normalizeModelPreset(settings().modelPreset).kind] ?? '',
    /** patch: { kind } 选套 / { custom: '文本' } 改当前这套的文本（两套各存各的） */
    set: (patch = {}) => {
      const current = normalizeModelPreset(settings().modelPreset);
      const next = { kind: patch.kind ?? current.kind, custom: { ...current.custom } };
      if (typeof patch.custom === 'string') next.custom[next.kind] = patch.custom;
      store.saveSettings({ modelPreset: normalizeModelPreset(next) });
      review.syncInjection(); // 改完立刻重算注入（角色回复端那半）
      return normalizeModelPreset(settings().modelPreset);
    },
    reset: () => modelPresetApi.set({ custom: '' }),
  };

  // ---------- 那几个"本来只有控制台"的功能，补上界面入口（T-415 / T-412 / T-413 / T-411）----------
  const toneApi = {
    get: () => normalizeTone(store.get().tone),
    keys: () => [...TONE_KEYS],
    set: (key, value) => {
      const next = rebalanceTone(store.get().tone, key, value);
      store.update((draft) => ({ ...draft, tone: next }), { label: '调整剧情占比' });
      return next;
    },
    text: () => coreToneText(store.get().tone),
  };
  const castApi = {
    get: () => normalizeProtagonists(settings().protagonists),
    set: (list) => {
      store.saveSettings({ protagonists: normalizeProtagonists(list) });
      review.syncInjection(); // 改完主角立刻重算注入（不是他的戏就别注入）
      return normalizeProtagonists(settings().protagonists);
    },
  };
  const breakFilterApi = {
    get: () => normalizeBreakFilter(settings().breakFilter),
    set: (next) => {
      store.saveSettings({ breakFilter: normalizeBreakFilter(next) });
      return normalizeBreakFilter(settings().breakFilter);
    },
  };
  const foreshadowApi = {
    list: () => openForeshadows(store.get().outline),
    resolve: (id) => {
      let resolved = [];
      store.update((draft) => {
        const result = resolveRecalled(draft.outline, [id]);
        resolved = result.resolved;
        return { ...draft, outline: result.outline };
      });
      return resolved;
    },
  };
  const copyApi = {
    export: () => exportCopy({ state: store.get(), settings: settings(), profile: profile.read() }),
    preview: (copy) => previewCopy(copy),
    import: async (copy) => {
      const preview = previewCopy(copy);
      if (!preview.ok) return { ok: false, error: preview.error, warnings: preview.warnings };

      const lines = [
        `剧本：《${preview.summary.title || '未命名'}》 · ${preview.summary.stages} 个阶段`,
        ...preview.warnings,
        '导入会覆盖当前剧本与相关设置（导演 API 连接不受影响）。继续？',
      ];
      if (ctx.capabilities?.confirmation && !(await ctx.showConfirm?.(lines.join('\n')))) {
        return { ok: false, error: '已取消', warnings: preview.warnings };
      }

      const result = applyCopy(copy, { store, writeProfile: (next) => profile.save(next) });
      if (result.ok) review.syncInjection();
      return result;
    },
  };
  // 配置页那五个折叠区共用这一份（面板与配置页读同一套，避免两处逻辑漂移）
  const extras = {
    modelPreset: modelPresetApi,
    breakFilter: breakFilterApi,
    tone: toneApi,
    cast: castApi,
    copy: copyApi,
  };

  // 测试用配置面板：没有它就没法填 API（控制台 DirectorTime.settingsPanel.show() 仍可用）
  // 放在 extras 之后建：配置页要读那五个折叠区（T-403 / T-411 / T-415 / T-412 / T-413 的入口）
  const settingsPanel = createSettingsPanel({
    store,
    profile: profileApi,
    presets,
    automation: automationApi,
    extras,
    onTest: () => client.testConnection(settings().connection ?? {}),
    onSave: () => review.syncInjection(),
  });

  const panel = createMainPanel({
    store,
    registry,
    profile: profileApi,
    // T-418：配置页的「预设」折叠区（只读酒馆预设）
    presets,
    // T-414：档位设置 + 待确认队列（生成出来的剧本要在这儿「采用」才生效）
    automation: automationApi,
    queue: queueApi,
    // T-420：一键更新（面板上的「更新插件」）
    update: updateApi,
    // T-404：剧本编辑器（面板「剧本」页）
    editor: editorApi,
    onTruncateRegen: () => truncateAndRegen(),
    // T-408：伏笔销账（剧本页里那块）
    foreshadows: foreshadowApi,
    // T-403 / T-411 / T-415 / T-412 / T-413 的入口（配置页折叠区）
    extras,
    getCapabilities: () => ctx.capabilities,
    getLast: () => review.getLastTurn(),
    onTest: () => client.testConnection(settings().connection ?? {}),
    onSave: () => review.syncInjection(),
    onGenerate: () => regenerateScript(),
    onExtend: () => topUpStages({ force: true }),
    loadWorldSources: (force) => collectWorldSources(force),
    // 世界书选择：chat 级（T-418 追加 —— 每个聊天记自己的世界书）
    getWorldSelection: () => store.get().worldSelection ?? {},
    saveWorldSelection: (selection) => {
      store.update((draft) => ({ ...draft, worldSelection: { ...selection } }), { label: '勾选世界书' });
      return store.get().worldSelection;
    },
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
    client, stages, outline, beats, lorebook, profile, profileApi,
    registry, checkpoint, will, initiative, rules: rulesApi, speculate, review, debug,
    // T-418：破限预设（只读酒馆预设）—— UI 未做，先用控制台
    presets: {
      list: () => presets.list(),
      entries: () => presets.entries(),
      select: (name) => presets.select(name),
      selectEntries: (indices) => presets.selectEntries(indices),
      clear: () => presets.clear(),
      text: () => presets.text(),
      status: () => presets.status(),
      // 探测不到酒馆预设接口时，把这个结果贴出来（不猜、不造）
      probe: () => presets.probe(),
    },
    // T-415：剧情占比（三条线联动配平，和恒为 100）
    tone: toneApi,
    // T-414：三级自动化档位 + 待审核队列（同上面板/配置页用的那份）
    automation: automationApi,
    queue: queueApi,
    // T-420：一键更新（面板「更新插件」按钮背后就是它）
    update: updateApi,
    // T-404：剧本编辑器（面板「剧本」页背后就是它）
    editor: { ...editorApi, truncateAndRegen },
    // T-403：模型特化预设（红线）
    modelPreset: modelPresetApi,
    // T-413 副本迁移：整个副本搬走 / 搬回来
    copy: copyApi,
    // T-412：主角设置（可多选、持久化）
    cast: castApi,
    // T-411：破限词模式（off / preset / custom / append）
    breakFilter: breakFilterApi,
    // T-408：伏笔查看 / 手动销账
    foreshadows: foreshadowApi,
    generateScript, regenerateScript, topUpStages, resetScript, setEnabled,
    collectWorldSources, worldText, profileText,
    settingsPanel: settingsPanelApi, panel, unmountMenu,
  };

  if (typeof window !== 'undefined') {
    window.DirectorTime = { ...(window.DirectorTime ?? {}), ...api };
  }
  return api;
}
