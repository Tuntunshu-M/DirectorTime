// 导演时间 · 默认状态
//
// T-103。字段定义见《导演时间-项目书-v0.3.md》§6。

export const SCHEMA_VERSION = 1;

/** 三级自动化档位，逐功能点独立设置（项目书 §1.5） */
export function createDefaultAutomation() {
  return {
    outline: 'L1',
    stageRegen: 'L1',
    profile: 'L1',
    stanceJudge: 'L2',
    checkpointJudge: 'L2',
    consistency: 'L2',
  };
}

/** 剧情占比：日常 / 危机 / 亲密，开启项之和为 100（项目书 F5） */
export function createDefaultTone() {
  return { daily: 70, crisis: 30, intimate: 0 };
}

/**
 * 规则引擎的四词库（T-406）。全部可编辑：用户改的就是这一份，直接持久化。
 * - strong / weak：带归属标签，指向哪个 stance
 * - negation：否定词，会反转其后紧邻的情感词
 * - irrelevant：「转向 / 无关」词。**转折词（不过 / 但是 / 可是）也放这里** ——
 *   它把态度转向反面，和强词同时出现时属于自相矛盾，规则引擎会老实转 LLM。
 */
export function createDefaultRules() {
  return {
    strong: [
      { word: '好', stance: 'accept' },
      { word: '好啊', stance: 'accept' },
      { word: '走', stance: 'accept' },
      { word: '走吧', stance: 'accept' },
      { word: '答应', stance: 'accept' },
      { word: '同意', stance: 'accept' },
      { word: '愿意', stance: 'accept' },
      { word: '没问题', stance: 'accept' },
      { word: '就这么定了', stance: 'accept' },
      { word: '定了', stance: 'accept' },
      { word: '听你的', stance: 'accept' },
      { word: '不想去', stance: 'reject' },
      { word: '不想', stance: 'reject' },
      { word: '不愿意', stance: 'reject' },
      { word: '不要', stance: 'reject' },
      { word: '不去', stance: 'reject' },
      { word: '不行', stance: 'reject' },
      { word: '拒绝', stance: 'reject' },
      { word: '反对', stance: 'reject' },
      { word: '别烦', stance: 'reject' },
      { word: '滚', stance: 'reject' },
      { word: '讨厌', stance: 'reject' },
    ],
    weak: [
      { word: '嗯', stance: 'hesitate' },
      { word: '吧', stance: 'hesitate' },
      { word: '也许', stance: 'hesitate' },
      { word: '再说吧', stance: 'hesitate' },
      { word: '再说', stance: 'hesitate' },
      { word: '随便', stance: 'hesitate' },
      { word: '大概', stance: 'hesitate' },
    ],
    negation: ['不', '没', '无', '别', '非', '未曾', '没有'],
    irrelevant: ['天气', '对了', '换个话题', '先不说这个', '不过', '但是', '可是'],
  };
}

export function createDefaultRuntime() {
  return {
    promptRegistered: false,
    lastReviewAt: 0,
    purgeCount: 0,
    // 本场戏已经跑了多少轮（每完成一次复盘 +1；超过上限就清空剧本）
    rounds: 0,
    // T-407 投机执行：还没被验证的预测（{ guess, injection, at, stageId } | null）
    speculation: null,
    // 预测命中率（Debug 显示）
    speculationStats: { hits: 0, misses: 0 },
  };
}

export function createDefaultCost() {
  return { sessionTotal: 0, callCount: 0 };
}

export function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    // 注：档位（automation）**只在 settings 里**（全局偏好 + 跨聊天）——
    // 聊天级曾经也存过一份，导致 Debug 与配置页各看一份（bugfix 0912 P1-2，已删）
    outline: null,
    tone: createDefaultTone(),
    // 世界书选择（chat 级：每个聊天记自己勾了哪些条目）
    worldSelection: {},
    stages: [],
    activeStageId: null,
    pendingReview: [],
    runtime: createDefaultRuntime(),
    history: [],
    cost: createDefaultCost(),
  };
}

/** 操作日志上限，可在设置中调整 */
export function createDefaultSettings() {
  return {
    enabled: false,
    injectEnabled: true,
    historyLimit: 200,
    stuckThreshold: 3,
    confidenceThreshold: 0.7,
    // 用户意愿权重（T-405）：0~33 剧情优先 / 34~66 平衡 / 67~100 user 优先
    will: 80,
    // 强制爱（T-405 §七，原 T-419）：开了之后 user 口头拒绝也不让步，char 继续推进本场
    forceAffection: false,
    // 跑满这么多轮就自动清空剧本（可在配置里改）
    maxRounds: 15,
    // 生成新阶段后拿侧写做一致性自检（T-402 §六，可关）
    consistencyCheck: true,
    // T-431：流式拉取（默认开）—— 边收边拼，长生成不会超时；站子不支持时自动降级
    stream: true,
    // T-431：空闲超时毫秒（收到数据就续期；非法值回落 30000）
    timeoutMs: 30000,
    // 用户指定的主目标（T-416；留空则由 AI 自己构思一个）
    objective: '',
    // 场记页「剧情走向」输入框（2026-09-14 #2）：点「重新生成剧本」时作为"用户的想法"带给导演
    premise: '',
    // 楼层节奏：每场最少 / 最多聊几楼（T-416；阶段自己的 pacing 可覆盖）
    pacing: { min: 3, max: 8 },
    // 规则引擎四词库（T-406）：默认一份，用户改的就是这份、直接持久化
    rules: createDefaultRules(),
    // 投机执行（T-407）：开启后每轮多花一次导演 API 调用，换"下一轮零延迟"
    speculation: true,
    // 硬禁区（T-410）：用户显式填写的绝对禁区，优先级高于侧写禁忌；命中即停
    hardLimits: [],
    // 主角（T-412 多人卡）：用户显式设置、可多个；空 = 单卡老行为
    protagonists: [],
    // 破限词（T-411）：off 关闭 / preset 跟随酒馆预设 / custom 自定义 / append 预设后追加
    // 只影响导演 API 请求，不进角色回复端
    breakFilter: { mode: 'off', custom: '' },
    // 破限预设（T-418）：选中的酒馆预设名 + 自选条目下标；空 = 没选（什么都不注入）
    preset: { name: '', entries: [] },
    // 模型特化预设（T-403 / F10）：Claude（推主动）/ Gemini（收敛极端）二选一，默认关闭
    // 两套各存自己的自定义文本；custom 为空则用内置文本
    modelPreset: { kind: 'off', custom: { claude: '', gemini: '' } },
    // 一键更新：上次试成功的扩展路径（T-420），下次先试它
    updatePath: null,
    // 自动检查更新（T-430）：已提示过的远程版本号 —— 同一个版本只提示一次，别每次轮询都弹
    updateNotifiedVersion: null,
    // 文本清洗（T-425）：内置两条 thinking 规则 + 用户自定义正则；只作用于本插件消费的文本
    sanitizeEnabled: true,
    sanitizeRules: [],
    // 导演强度（T-424）：restrained / standard / assertive，默认标准档（零回归）
    directorIntensity: 'standard',
    // 三级自动化档位（T-414）：**唯一来源**，跨聊天（Debug 与配置页读的都是这份）
    automation: createDefaultAutomation(),
    // 世界书：勾选的条目（entryKey → true）与进 prompt 的条数上限（项目书 §F1 / 附录建议 20）
    worldSelection: {},
    worldLimit: 20,
    // 导演 API：独立模式自己填，主连接模式留空由酒馆提供
    connection: { mode: 'independent', endpoint: '', apiKey: '', model: '' },
  };
}
