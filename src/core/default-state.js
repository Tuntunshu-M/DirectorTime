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

export function createDefaultRuntime() {
  return {
    promptRegistered: false,
    lastReviewAt: 0,
    purgeCount: 0,
    // 本场戏已经跑了多少轮（每完成一次复盘 +1；超过上限就清空剧本）
    rounds: 0,
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
    // 跑满这么多轮就自动清空剧本（可在配置里改）
    maxRounds: 15,
    // 世界书：勾选的条目（entryKey → true）与进 prompt 的条数上限（项目书 §F1 / 附录建议 20）
    worldSelection: {},
    worldLimit: 20,
    // 导演 API：独立模式自己填，主连接模式留空由酒馆提供
    connection: { mode: 'independent', endpoint: '', apiKey: '', model: '' },
  };
}
