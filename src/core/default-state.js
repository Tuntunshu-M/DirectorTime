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
    automation: createDefaultAutomation(),
    outline: null,
    tone: createDefaultTone(),
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
    // 用户指定的主目标（T-416；留空则由 AI 自己构思一个）
    objective: '',
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
    // 世界书：勾选的条目（entryKey → true）与进 prompt 的条数上限（项目书 §F1 / 附录建议 20）
    worldSelection: {},
    worldLimit: 20,
    // 导演 API：独立模式自己填，主连接模式留空由酒馆提供
    connection: { mode: 'independent', endpoint: '', apiKey: '', model: '' },
  };
}
