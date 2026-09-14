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
import { resolveRules, RULE_KEYS, RULE_LABELS, rulesToText, textToRules } from './director/rules.js';
import { createBreakFilterService, normalizeBreakFilter } from './llm/break-filter.js';
import { createPresetService } from './inject/preset.js';
import { createSpeculationService, hitRate } from './director/speculate.js';
import { createCombinedJudge } from './director/judge-combined.js';
import { carryOver, foreshadowText, openForeshadows, resolveRecalled } from './director/foreshadow.js';
import { hardLimitText } from './director/hard-limits.js';
import { findUserDirectives, findFinishedLines, describeIssues } from './director/actor-guard.js';
import { normalizeProtagonists, protagonistText } from './world/cast.js';
import { gate, setLevel, normalizeAutomation, FEATURES, LEVELS, FEATURE_LABELS, LEVEL_LABELS } from './core/automation.js';
import { createReviewQueue } from './core/review-queue.js';
import {
  BUILTIN_PRESETS, PRESET_LABELS, PRESET_KINDS, normalizeModelPreset, modelPresetText,
} from './core/model-preset.js';
import { createEditorService } from './director/editor.js';
import { normalizeCleanRules, sanitizeConfig } from './core/sanitize.js';
import { INTENSITY_LEVELS, INTENSITY_LABELS, normalizeIntensity } from './core/intensity.js';
import {
  extensionFolderFromUrl, createExtensionUpdater, createUpdateChecker, checkForUpdate,
} from './core/update-check.js';
import {
  toneText as coreToneText, rebalanceTone, normalizeTone, TONE_KEYS, TONE_LABELS,
  toneHintsOf as coreToneHintsOf, normalizeToneHints, DEFAULT_TONE_HINTS, TONE_HINT_MAX,
} from './core/tone.js';
import { automationText } from './core/automation.js';
import { intensityHint } from './core/intensity.js';
import { createDefaultRules } from './core/default-state.js';
import { exportCopy, previewCopy, applyCopy } from './core/portable.js';
import { createCheckpointService } from './director/checkpoint.js';
import { createReviewService } from './director/review.js';
import { createPromptRegistry } from './inject/prompt-registry.js';
import { createLorebookService } from './world/lorebook.js';
import { createProfileService, profileText, PROFILE_FIELDS, PROFILE_FIELD_LABELS } from './world/character.js';
import { buildDebugState } from './ui/debug.js';
import { createMainPanel, UI_VERSION } from './ui/panel.js';
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
    // 批复 §二-5：导演 API 调用日志（时间 / 耗时 / tokens / 调用名 / 结果）
    onResult: (entry) => recordApiCall(entry),
    // T-431：流式开关（默认开）+ 超时秒数可配（超时 = 空闲超时，长生成不再被掐断）
    getStream: () => settings().stream !== false,
    getTimeoutMs: () => {
      const value = Number(settings().timeoutMs);
      return Number.isFinite(value) && value > 0 ? value : 30000;
    },
    // P0（bugfix 0912 第二波）：调用计数挂在真正发请求的地方。
    // 状态单一来源 = 本 store（聊天级，已持久化）—— 刷新页面不清零，且跟聊天走。
    onCall: () => store.update((draft) => ({
      ...draft,
      cost: {
        sessionTotal: (draft.cost?.sessionTotal ?? 0) + 1,
        callCount: (draft.cost?.callCount ?? 0) + 1,
      },
    }), { track: false }),
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

  // T-426：合并判定（一次调用拿三段）
  const combinedJudge = createCombinedJudge({
    client,
    stages,
    getConnection: () => settings().connection ?? {},
    getOutline: () => store.get().outline,
  });

  const review = createReviewService({
    checkpoint,
    combinedJudge,
    will,
    initiative,
    speculate,
    beats,
    topUp: topUpStages,
    queue,
    getProfile: () => profile.read(),
    // T-425：判定输入要过清洗层（thinking 块不污染判定）
    getCleanRules: () => sanitizeConfig(settings()),
    // P1-4：判定也要带最近对话（与生成类共用同一份 recentContext，不再"单轮失忆"）
    getContext: () => recentContext(),
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
  /**
   * 配置一改就重算注入，并把 Debug 的「下轮将注入」一起刷新。
   * （用户反馈：改了红线/破限后「注入全文」变了，但「下轮将注入」还是旧的 —— 要等下一轮复盘才更新）
   */
  function refreshInjection() {
    const text = review.syncInjection();
    // T-427：调试弹层每次都现读状态（uiApi.read），不再需要往里推
    return text;
  }

  // 旧调试浮窗（createDebugPanel）已并入主面板的「调试」弹层（T-427）：
  // 状态仍由 buildDebugState 统一算（uiApi.read().debug），不再单独挂一个窗。

  // ---------- 剧本生成 ----------
  // T-203 的接线：清单里漏了"首次生成剧本"这一步，不接上就永远不会自动生成
  // （之前 review.run 拿不到 active 阶段，只会 hold）。
  // 注意：**不随消息自动生成**，只由总开关 + 「生成剧本」按钮显式触发。

  let generating = false;

  /**
   * 剧情占比 → 可读文本，喂给 GEN_OUTLINE 的 {{tone}}（T-415 起走 core/tone）。
   * 2026-09-14：带上三条线的释义（用户改过的覆盖内置），见 core/tone.js 的说明。
   */
  function toneText() {
    return coreToneText(store.get().tone, { hints: store.get().toneHints });
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

  /** 调用日志（批复 §二-5）：最近 30 次，跟聊天走、已持久化；调试弹层那张表用它 */
  function recordApiCall(entry) {
    store.update((draft) => ({
      ...draft,
      runtime: {
        ...draft.runtime,
        apiLog: [entry, ...(draft.runtime?.apiLog ?? [])].slice(0, 30),
      },
    }), { track: false });
  }

  /**
   * 枚举世界书全部来源。
   *
   * T-434：**不再预读每本书的条目** —— `collect()` 只给书名（读过的才带条目）。
   * 30 秒内复用缓存；force=true 丢掉已读缓存重来（界面上点「刷新」）。
   */
  async function collectWorldSources(force = false) {
    if (force) lorebook.forget();
    if (!force && worldCache.sources.length && Date.now() - worldCache.at < 30000) return worldCache.sources;
    const sources = lorebook.collect();
    worldCache = { at: Date.now(), sources };
    return sources;
  }

  /**
   * T-434：读一本书（展开哪本读哪本）。读完让来源缓存失效，下次 collect 就带上它的条目。
   */
  async function loadWorldBook(name) {
    const book = await lorebook.loadBook(name);
    rememberWorldSizes(book?.entries);
    worldCache = { at: 0, sources: [] };
    return book;
  }

  /**
   * 记下"已经知道的条目字数"（键 → 字符数）。
   *
   * 懒加载之后，未读过的书没有条目可数，所以「已选 N 条 · 约 X tokens」得靠这份账本：
   * 勾选只能发生在读过的书上（⇒ 勾的时候就有字数），注入时再补一遍更准的。
   */
  function rememberWorldSizes(entries) {
    const known = entries ?? [];
    if (!known.length) return;
    const sizes = { ...(store.get().runtime?.worldSizes ?? {}) };
    let changed = false;
    for (const entry of known) {
      if (!entry?.key) continue;
      const chars = String(entry.content ?? '').length;
      if (sizes[entry.key] !== chars) { sizes[entry.key] = chars; changed = true; }
    }
    if (!changed) return;
    store.update((draft) => ({ ...draft, runtime: { ...draft.runtime, worldSizes: sizes } }), { track: false });
  }

  /** 已选条数 + token 估算（懒加载下：已知的按账本算，未知的标 approx） */
  function worldStats(selection = store.get().worldSelection ?? {}) {
    const sizes = store.get().runtime?.worldSizes ?? {};
    const keys = Object.keys(selection ?? {}).filter((key) => selection[key]);
    let chars = 0;
    let unknown = 0;
    for (const key of keys) {
      if (Number.isFinite(Number(sizes[key]))) chars += Number(sizes[key]);
      else unknown += 1;
    }
    return { count: keys.length, tokens: Math.round(chars / 2.5), unknown, approx: unknown > 0 };
  }

  /** 勾选条目 → 喂给 {{world}} 的文本；一条没勾就返回空串，不占 prompt */
  async function worldText() {
    // 世界书选择是 **chat 级**的（每个聊天记自己那份），不再是全局设置
    const selection = store.get().worldSelection ?? {};
    if (!Object.keys(selection).length) return '';
    const sources = await collectWorldSources();
    // T-434：只读"有勾选的"那些书（未勾的书一本都不读）
    const picked = await lorebook.pickSelected(sources, selection);
    rememberWorldSizes(picked);
    return lorebook.buildText(picked, { limit: settings().worldLimit ?? 20 });
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
   *
   * T-427：重生成要**带上上一版被否的原因**（`regenerate(reason)`）——
   * 以前是盲重生成，很可能又犯同样的毛病，白花 2 次调用。
   * 第 2 轮带上两次的原因（最新那条必含，两条都有信息量就拼两行）。
   */
  async function ensureConsistent(result, regenerate) {
    if (settings().consistencyCheck === false) return result;
    if (!profileText(profile.read())) return result;
    // T-414：一致性自检档位 —— L0 不自动跑
    const consistencyGate = gate(settings().automation, 'consistency');
    if (!consistencyGate.auto) return result;

    let current = result;
    const reasons = [];
    // T-404：锁定的阶段是用户显式写的，不参与一致性自检、也不会被重生成替换
    const checkable = () => (current.stages ?? []).filter((stage) => !stage.locked);
    if (!checkable().length) return current;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const verdict = await profile.checkConsistency({ profile: profile.read(), stages: checkable() });
      if (verdict.ok) return current;
      console.log(`[导演时间] 阶段与人设不符，重生成（第 ${attempt} 次）：${verdict.reason}`);
      // T-427：这一轮的原因攒起来，交给 regenerate 写进请求（模型不必再蒙眼重抽）
      if (verdict.reason) reasons.push(String(verdict.reason).trim());
      const retry = rememberRequest(await regenerate(reasons.join('\n')));
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
      // T-427：重生成带上驳回原因（首轮 rejectReason 为空串 → 请求文本与原来逐字一致）
      result = await ensureConsistent(result, (rejectReason = '') => outline.generate({ ...vars, rejectReason }));
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
    // 2026-09-14 反馈 #2：场记页那个「剧情走向」输入框存进 settings.premise，
    // 点「重新生成剧本」时作为"用户的想法"带给导演（角色回复端不受影响）
    return generateScript({ premise: settings().premise ?? '' });
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
      // T-426：这一轮的投机已经随「合并判定」搭车回来了 → 别再单独发一次调用
      if (speculate.consumeCombined?.()) {
        const pending = store.get().runtime?.speculation;
        if (pending?.injection) {
          registry.register(pending.injection);
          return pending;
        }
        return null;
      }
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

    // 一致性自检（默认开，T-402 §六）；T-427：续写的重生成同样带上驳回原因
    const result = await ensureConsistent(generated, (rejectReason = '') => outline.extend({ ...vars, rejectReason }));
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
    // 上一轮的复盘记录也是上一个聊天的，一并清掉（否则 Debug 会串、连续性检查会误报）
    review.resetTurn?.();
    // 换了聊天，上一轮的投机预测作废（否则会拿别的聊天的预测去猜）
    store.update((draft) => ({ ...draft, runtime: { ...draft.runtime, speculation: null } }), { track: false });
    // 界面要跟着换到这一聊天的剧本，否则会停在上一份（看起来像"剧本丢了"）
    try { panel?.render?.(); debug?.render?.(); } catch (error) { console.warn('[导演时间] 切聊天后刷新界面失败', error); }
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


  // 主页面：总开关 + 运行状态 + 剧本 + 人物；由菜单栏入口打开
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
  // T-420 追加（用户反馈 13）：要**真去查**有没有新版本，不能只报"更新成功"
  const checker = createUpdateChecker({ manifestUrl: MANIFEST_URL });

  /**
   * T-430：**真去 GitHub 查一次**，结果存进 runtime（面板一打开就能看到有没有新版本）。
   *
   * 与 `checkForUpdate` 的分工（以前两件事被混成一件，导致"永远最新"）：
   *   · 这个 = 远程 vs 本地（GitHub 上有没有更新的）→ 给用户看、由用户决定更不更
   *   · `checkForUpdate` = 本地文件 vs 上次记录（酒馆点 Update 后文件变了）→ 自动刷新页面
   *
   * @param {{notify?: boolean}} options notify=true 时，发现新版本会提示一次（**每个版本只提示一次**，
   *   不然每 15 秒轮询一次就会反复弹）
   */
  async function checkRemoteUpdate({ notify = false } = {}) {
    const result = await checker.check();
    store.update((draft) => ({
      ...draft,
      runtime: { ...draft.runtime, update: { ...result, checkedAt: Date.now() } },
    }), { track: false });

    if (notify && result.ok && result.hasUpdate && settings().updateNotifiedVersion !== result.remote) {
      store.saveSettings({ updateNotifiedVersion: result.remote });
      ctx.showSystemMessage?.(
        `导演时间：有新版本 v${result.remote}（当前 v${result.local}）。打开面板 → 设置 → 底部点「更新插件」即可。`,
      );
    }
    return result;
  }

  const updateApi = {
    folder: () => updater.folder,
    path: () => settings().updatePath ?? null,
    version: () => settings().loadedVersion ?? '',
    /** 比本地与远程版本：{ ok, local, remote, hasUpdate, message } */
    check: () => checkRemoteUpdate(),
    apply: () => updater.apply(),
    /** 最近一次远程检查结果（面板/调试面板直接读，不用再查一遍） */
    last: () => store.get().runtime?.update ?? null,
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
    onChanged: () => refreshInjection(),
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
      refreshInjection(); // 改完立刻重算注入，并刷新 Debug 的「下轮将注入」
      return normalizeModelPreset(settings().modelPreset);
    },
    reset: () => modelPresetApi.set({ custom: '' }),
  };

  // ---------- 那几个"本来只有控制台"的功能，补上界面入口（T-415 / T-412 / T-413 / T-411）----------
  const toneApi = {
    get: () => normalizeTone(store.get().tone),
    keys: () => [...TONE_KEYS],
    /**
     * locked：锁住的线不参与配平（T-415 用户反馈 3）。
     *
     * 2026-09-14 反馈 #4：`rebalanceTone` / `normalizeTone` 只认三条占比，**会把 locked 洗掉** ——
     * 于是"锁"点了也没用（重绘后 `state.tone.locked` 永远是空）。
     * 现在：给 locked（数组）就按它存；**不给（null/undefined）就沿用已存的** —— 拖滑块不会把锁弄丢。
     */
    set: (key, value, locked = null) => {
      const stored = store.get().tone ?? {};
      const source = Array.isArray(locked) ? locked : (Array.isArray(stored.locked) ? stored.locked : []);
      const nextLocked = source.filter((item) => TONE_KEYS.includes(item));
      const next = { ...rebalanceTone(stored, key, value, { locked: nextLocked }), locked: nextLocked };
      store.update((draft) => ({ ...draft, tone: next }), { label: '调整剧情占比' });
      return next;
    },
    text: () => coreToneText(store.get().tone, { hints: store.get().toneHints }),
    // ---------- 释义（2026-09-14：占比的数字含义要让用户能改）----------
    /** 生效释义（内置 + 用户改过的），界面直接显示这一份 */
    hints: () => coreToneHintsOf(store.get().toneHints),
    /** 内置原文（占位提示 + 「恢复内置」的对照） */
    hintDefaults: () => ({ ...DEFAULT_TONE_HINTS }),
    /** 改一条释义；**空串 = 这条回落内置**（删掉覆盖，不是存空字符串） */
    setHint: (key, text) => {
      const next = { ...normalizeToneHints(store.get().toneHints) };
      const value = typeof text === 'string' ? text.trim().slice(0, TONE_HINT_MAX) : '';
      if (value && TONE_KEYS.includes(key)) next[key] = value;
      else delete next[key];
      store.update((draft) => ({ ...draft, toneHints: next }), { label: '调整剧情占比释义' });
      return coreToneHintsOf(next);
    },
    /** 三条全部恢复内置 */
    resetHints: () => {
      store.update((draft) => ({ ...draft, toneHints: {} }), { label: '恢复剧情占比释义' });
      return coreToneHintsOf({});
    },
  };
  const castApi = {
    get: () => normalizeProtagonists(settings().protagonists),
    set: (list) => {
      store.saveSettings({ protagonists: normalizeProtagonists(list) });
      refreshInjection(); // 改完主角立刻重算注入（不是他的戏就别注入）
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
      if (result.ok) refreshInjection();
      return result;
    },
  };
  // ---------- T-424：导演强度（只改注入文案；判定 / 状态机 / 熔断 / 意愿矩阵一律不受影响）----------
  const intensityApi = {
    get: () => normalizeIntensity(settings().directorIntensity),
    levels: () => [...INTENSITY_LEVELS],
    labels: () => ({ ...INTENSITY_LABELS }),
    set: (level) => {
      store.saveSettings({ directorIntensity: normalizeIntensity(level) });
      refreshInjection(); // 切档即生效，不用重开聊天
      return normalizeIntensity(settings().directorIntensity);
    },
  };

  // ---------- P2-2：投机开关（以前只有闸门，没有入口）----------
  const speculateApi = {
    guess: (input) => speculate.guess(input),
    settle: (userMessage) => speculate.settle(userMessage),
    /** 开关（默认开）。关掉后本轮起不再发投机调用 */
    setEnabled: (enabled) => {
      store.saveSettings({ speculation: Boolean(enabled) });
      return speculateApi.status();
    },
    status: () => ({
      enabled: settings().speculation !== false,
      ...hitRate(store.get().runtime?.speculationStats),
      pending: store.get().runtime?.speculation?.guess ?? '',
    }),
  };

  // 老数据兼容：v0.6.0 把清洗配置存在 settings.textClean 里，现在按规格换成
  // sanitizeEnabled / sanitizeRules（只迁一次，迁完删掉旧键）
  function migrateLegacySanitize() {
    const legacy = settings().textClean;
    if (!legacy || typeof legacy !== 'object') return;
    const patch = { sanitizeEnabled: legacy.enabled !== false };
    if (Array.isArray(legacy.rules) && legacy.rules.length) patch.sanitizeRules = normalizeCleanRules(legacy.rules);
    store.saveSettings({ ...patch, textClean: undefined });
  }
  migrateLegacySanitize();

  // 配置页那几个折叠区共用这一份（面板与配置页读同一套，避免两处逻辑漂移）
  const extras = {
    modelPreset: modelPresetApi,
    breakFilter: breakFilterApi,
    tone: toneApi,
    cast: castApi,
    copy: copyApi,
    speculate: speculateApi,
    intensity: intensityApi,
  };

  // ---------- T-427 UI：界面要的那一份（读写都收在这里，界面不碰 store/settings 内部）----------
  // 只读快照：面板每次重绘读一次；写入口：saveSettings / 各功能自己的 api
  const uiApi = {
    read: () => {
      const state = store.get();
      const stages = state.stages ?? [];
      const active = stages.find((stage) => stage.id === state.activeStageId) ?? null;
      const profile = profileApi.read();
      return {
        enabled: Boolean(settings().enabled),
        version: settings().loadedVersion ?? '',
        connection: { ...(settings().connection ?? {}) },
        will: Number(settings().will ?? 80),
        forceAffection: Boolean(settings().forceAffection),
        speculation: settings().speculation !== false,
        hardLimits: [...(settings().hardLimits ?? [])],
        pacing: { ...(settings().pacing ?? {}) },
        stage: {
          index: active ? stages.findIndex((stage) => stage.id === active.id) + 1 : 0,
          total: stages.length,
          active,
        },
        stages,
        activeStageId: state.activeStageId ?? null,
        automationText: automationText(automationApi.get()),
        // 批复 §二-1：档位现在是可改的（六个下拉）
        automation: {
          levels: automationApi.get(),
          features: [...FEATURES],
          featureLabels: { ...FEATURE_LABELS },
          levelList: [...LEVELS],
          levelLabels: { ...LEVEL_LABELS },
        },
        // 批复 §二-3：六个数字参数 + 一致性自检开关
        params: {
          pacing: { min: Number(settings().pacing?.min ?? 3), max: Number(settings().pacing?.max ?? 8) },
          maxRounds: Number(settings().maxRounds ?? 15),
          confidenceThreshold: Number(settings().confidenceThreshold ?? 0.7),
          stuckThreshold: Number(settings().stuckThreshold ?? 3),
          worldLimit: Number(settings().worldLimit ?? 20),
          consistencyCheck: settings().consistencyCheck !== false,
          // T-431：流式开关（默认开）+ 超时毫秒
          stream: settings().stream !== false,
          timeoutMs: Number(settings().timeoutMs ?? 30000),
        },
        // 批复 §二-2：四本词库（界面按行编辑，带立场的写成 `词 = 立场`）
        rules: {
          keys: [...RULE_KEYS],
          labels: { ...RULE_LABELS },
          texts: Object.fromEntries(RULE_KEYS.map((key) => [key, rulesToText(resolveRules(settings().rules), key)])),
        },
        injection: registry.getStatus?.() ?? { registered: false, length: 0, text: '' },
        lastTurn: review.getLastTurn(),
        queue: queueApi.list(),
        foreshadows: foreshadowApi.list(),
        speculation: settings().speculation !== false,
        speculationStatus: speculateApi.status(),
        cost: state.cost ?? { sessionTotal: 0, callCount: 0 },
        tone: toneApi.get(),
        toneKeys: [...TONE_KEYS],
        toneLabels: { ...TONE_LABELS },
        toneLocked: state.tone?.locked ?? [],
        // 释义（生效 / 内置 / 被改过的那几条）——界面上的小折叠用它渲染（2026-09-14）
        toneHints: toneApi.hints(),
        toneHintDefaults: toneApi.hintDefaults(),
        toneHintsCustom: normalizeToneHints(state.toneHints),
        // 场记页「剧情走向」输入框（2026-09-14 #2）
        premise: settings().premise ?? '',
        intensity: intensityApi.get(),
        intensityHint: intensityHint(intensityApi.get()),
        breakFilter: breakFilterApi.get(),
        modelPreset: { ...modelPresetApi.get(), text: modelPresetApi.text() },
        sanitize: sanitizeConfig(settings()),
        presets: {
          list: presets.list(),
          status: presets.status(),
          entries: presets.entries(),
        },
        cast: { list: castApi.get(), current: ctx.getCharacterData?.()?.name ?? '' },
        profile,
        profileFields: PROFILE_FIELDS.map((key) => ({ key, label: PROFILE_FIELD_LABELS[key] ?? key })),
        world: {
          sources: [],
          selection: { ...(state.worldSelection ?? {}) },
          // T-434 懒加载：未读过的书没有条目可数，所以条数/token 走这份统计（含"还没读"的条数）
          stats: worldStats(state.worldSelection ?? {}),
        },
        update: {
          version: updateApi.version(),
          path: updateApi.path(),
          // T-430：最近一次远程检查结果（面板一打开就能看到"有没有新版本"，不用先点检查）
          checked: updateApi.last(),
        },
        debug: buildDebugState({
          store,
          registry,
          last: review.getLastTurn(),
          capabilities: ctx.capabilities,
          automation: automationApi.get(),
          lastRequest: lastDirectorRequest,
          breakStatus: {
            mode: normalizeBreakFilter(settings().breakFilter).mode,
            preset: presets.status(),
            customLength: String(normalizeBreakFilter(settings().breakFilter).custom ?? '').trim().length,
            injected: (breakFilter.text() ?? '').length,
          },
        }),
      };
    },
    /** 批复 §二-1：档位六个下拉（沿用 §5.4 那行「档位」的显示位做控件） */
    setAutomation: (feature, level) => automationApi.set(feature, level),
    /** 批复 §二-2：词库编辑（清空某个库 = 规则引擎什么都不判，老实转 LLM） */
    saveRules: (key, text) => {
      const current = resolveRules(settings().rules);
      const { list, dropped } = textToRules(text, key);
      store.saveSettings({ rules: { ...current, [key]: list } });
      return { count: list.length, dropped };
    },
    resetRules: () => rulesApi.reset(),
    /** 界面上的小设置（意愿权重 / 强制爱 / 硬禁区…）：存 + 立刻刷注入 */
    saveSettings: (patch) => {
      store.saveSettings(patch);
      refreshInjection();
      return settings();
    },
    /** T-425：撤回上一步 AI 写入（一切可回退） */
    undo: () => {
      const ok = store.undo?.();
      refreshInjection();
      return ok;
    },
    /**
     * T-430：手动查一次远程版本（GitHub）。
     * 以前这里走的是 `checkForUpdate`（本地文件 vs 上次记录）—— 那条永远相等，
     * 所以按钮无论 GitHub 多新都说"已是最新版"。现在真去比远程。
     */
    checkUpdate: () => checkRemoteUpdate(),
    loadWorldSources: (force) => collectWorldSources(force),
    /** T-434：读一本世界书（展开哪本读哪本） */
    loadWorldBook: (name) => loadWorldBook(name),
    saveWorldSelection: (selection) => {
      store.update((draft) => ({ ...draft, worldSelection: { ...selection } }), { label: '勾选世界书' });
      // 勾选只能发生在"读过的书"上 → 顺手把这些条目的字数记进账本（token 估算用）
      rememberWorldSizes(
        (worldCache.sources ?? []).flatMap((source) => (source.books ?? []).flatMap((book) => book.entries ?? [])),
      );
      return store.get().worldSelection;
    },
    onTest: () => client.testConnection(settings().connection ?? {}),
    onGenerate: () => regenerateScript(),
    onExtend: () => topUpStages({ force: true }),
    onToggleEnabled: (value) => setEnabled(value),
    resetScript,
  };

  const panel = createMainPanel({ getApi: () => api });

  // 入口挂在酒馆扩展菜单（#extensionsMenu）。点开是主页面，不再自动弹配置
  const unmountMenu = mountMenuEntry({ onOpen: () => { panel.open(); } });

  // 控制台入口（设置弹层现在在主面板里，进设置 = 开面板 + 切到设置层）
  const settingsPanelApi = {
    show: () => { panel.open(); panel.layer('settings'); return panel; },
    hide: () => panel.hide(),
  };

  const api = {
    client, stages, outline, beats, lorebook, profile, profileApi,
    registry, checkpoint, will, initiative, rules: rulesApi, speculate: speculateApi, review,
    // T-427：界面那份读写口 + 调试面板（现在是主面板里的弹层）
    ui: uiApi,
    // 界面代码版本：控制台 `DirectorTime.uiVersion` 读不到 = 跑的是旧代码（浏览器/酒馆缓存住了）
    uiVersion: UI_VERSION,
    // 界面上这几个动作走 api 顶层（界面只认 api.xxx）——
    // tests/ui.test.mjs 会扫界面源码里的 api.xxx，对不上就报错（这些漏过一次）
    saveSettings: (patch) => uiApi.saveSettings(patch),
    undo: () => uiApi.undo(),
    checkUpdate: () => uiApi.checkUpdate(),
    onTest: () => uiApi.onTest(),
    onGenerate: () => uiApi.onGenerate(),
    onExtend: () => uiApi.onExtend(),
    onToggleEnabled: (value) => uiApi.onToggleEnabled(value),
    loadWorldSources: (force) => uiApi.loadWorldSources(force),
    loadWorldBook: (name) => uiApi.loadWorldBook(name),
    saveWorldSelection: (selection) => uiApi.saveWorldSelection(selection),
    // 批复 §二-1/§二-2：档位与词库（界面走这两个）
    setAutomation: (feature, level) => uiApi.setAutomation(feature, level),
    saveRules: (key, text) => uiApi.saveRules(key, text),
    resetRules: () => uiApi.resetRules(),
    debug: {
      show: () => { panel.open(); panel.layer('debug'); },
      hide: () => panel.hide(),
      state: () => uiApi.read().debug,
    },
    onOpenDebug: () => { panel.open(); panel.layer('debug'); },
    // T-426：合并判定（控制台可直接调，便于排查"三段各自解析到了没有"）
    judgeCombined: combinedJudge,
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
    // T-425：输出清洗规则（内置 thinking + 用户自定义正则）
    sanitize: {
      get: () => sanitizeConfig(settings()),
      set: (next) => {
        const current = sanitizeConfig(settings());
        const enabled = next?.enabled === undefined ? current.enabled : Boolean(next.enabled);
        const rules = normalizeCleanRules(next?.rules === undefined ? current.rules : next.rules);
        store.saveSettings({ sanitizeEnabled: enabled, sanitizeRules: rules });
        return sanitizeConfig(settings());
      },
      reset: () => {
        store.saveSettings({ sanitizeEnabled: true, sanitizeRules: [] });
        return sanitizeConfig(settings());
      },
    },
    // T-424：导演强度（只改注入语气；判定 / 状态机不受影响）
    intensity: intensityApi,
    // T-413 副本迁移：整个副本搬走 / 搬回来
    copy: copyApi,
    // T-412：主角设置（可多选、持久化）
    cast: castApi,
    // T-411：破限词模式（off / preset / custom / append）
    breakFilter: breakFilterApi,
    // T-408：伏笔查看 / 手动销账
    foreshadows: foreshadowApi,
    generateScript, regenerateScript, topUpStages, resetScript, setEnabled,
    // T-430：启动/轮询时自动查一次 GitHub（index.js 调它，有新版本会提示一次）
    checkRemoteUpdate,
    collectWorldSources, worldText, profileText,
    settingsPanel: settingsPanelApi, panel, unmountMenu,
  };

  if (typeof window !== 'undefined') {
    window.DirectorTime = { ...(window.DirectorTime ?? {}), ...api };
  }
  return api;
}
