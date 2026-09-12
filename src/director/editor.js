// 导演时间 · 剧本编辑器（T-404 / 项目书 F1 · P8）
//
// 手动创建剧本、增删改、复制、拖拽排序、锁定、导出导入快照（往返无损）。
// 纯逻辑在这里；UI 只负责把值读出来调这些函数（禁则 G4：不做美化）。
//
// 两条不变量要一直守住：
//   1. 任一时刻最多一个 active 阶段（删掉 active 时要有东西顶上）
//   2. **锁定 = 用户显式指定** —— AI 不许覆盖（重写 beats / 重生成 / 一致性自检都跳过）；
//      但用户在编辑器里的手改永远生效（用户显式优先于 AI，项目书 §1.4）

import { normalizeStages, STAGE_STATUSES } from './outline.js';

/** 空白大纲：手填用 */
export function blankOutline() {
  return { title: '', objective: '', premise: '', foreshadows: [], status: 'active' };
}

/** 空白阶段：手填用（走 normalizeStages，字段一次补齐，免得漏字段） */
export function blankStage(title = '') {
  const [stage] = normalizeStages([{
    title: title || '新阶段',
    goal: '',
    activity: '',
    checkpoint: { criteria: '', antiCriteria: '' },
    beats: [],
  }], { activateFirst: false });
  return stage;
}

/**
 * 修不变量：activeStageId 指空了 / 有多个 active / 一个都没有时，挑一个顶上。
 * 优先原 id → 原位置往后最近的未演完阶段 → 第一个未演完阶段。
 * @returns {{stages: Array, activeStageId: string|null}}
 */
export function repairInvariant(rawStages = [], activeStageId = null, preferredIndex = -1) {
  const stages = rawStages.map((stage) => ({ ...stage }));
  const alive = (stage) => stage.status !== 'done' && stage.status !== 'dropped';

  let active = stages.find((stage) => stage.id === activeStageId && alive(stage)) ?? null;

  if (!active) {
    const pool = stages.map((stage, i) => ({ stage, i })).filter(({ stage }) => alive(stage));
    // 优先"原来那个位置往后第一个还活着的"
    const after = pool.find(({ i }) => i >= preferredIndex) ?? pool[0] ?? null;
    active = after?.stage ?? null;
  }

  for (const stage of stages) {
    if (stage === active) stage.status = stage.status === 'ready' ? 'ready' : 'active';
    else if (stage.status === 'active' || stage.status === 'ready') stage.status = 'pending';
  }

  return { stages, activeStageId: active?.id ?? null };
}

export function createEditorService({ store, onChanged } = {}) {
  const getState = () => store?.get?.() ?? {};

  /** 编辑器专用写入：**不受 locked 阻挡**（用户手改优先于 AI），但会记下 AI 原稿 */
  function updateStage(id, patch) {
    return store.update((draft) => ({
      ...draft,
      stages: draft.stages.map((stage) => (
        stage.id === id
          ? { ...stage, ...patch, aiOriginal: stage.aiOriginal ?? stage }
          : stage
      )),
    }), { label: '编辑阶段' });
  }

  function setOutline(patch) {
    return store.update((draft) => ({
      ...draft,
      outline: { ...(draft.outline ?? blankOutline()), ...patch },
    }), { label: '编辑大纲' });
  }

  function setForeshadows(list) {
    return store.update((draft) => ({
      ...draft,
      outline: { ...(draft.outline ?? blankOutline()), foreshadows: list },
    }), { label: '编辑伏笔' });
  }

  /** 在 afterIndex 之后插入一个空白阶段（afterIndex = -1 → 插到最前） */
  function addStage(afterIndex = -1, patch = {}) {
    const stage = { ...blankStage(patch.title ?? ''), ...patch };
    return store.update((draft) => {
      const list = [...draft.stages];
      list.splice(afterIndex + 1, 0, stage);
      const fixed = list.map((item, i) => ({ ...item, index: i + 1 }));
      const repaired = repairInvariant(fixed, draft.activeStageId, afterIndex + 1);
      return { ...draft, ...repaired };
    }, { label: '插入阶段' });
  }

  /** 复制一个阶段（新 id、排队状态、不继承锁定） */
  function duplicateStage(id) {
    const index = getState().stages.findIndex((stage) => stage.id === id);
    if (index === -1) return null;
    const source = getState().stages[index];
    const [copy] = normalizeStages([{
      title: `${source.title}（副本）`,
      goal: source.goal,
      activity: source.activity,
      checkpoint: { ...source.checkpoint },
      beats: [...(source.beats ?? [])],
      pacing: source.pacing,
      will: source.will,
      actorId: source.actorId,
      initiative: source.initiative,
      notes: source.notes,
    }], { activateFirst: false });
    return store.update((draft) => {
      const list = [...draft.stages];
      list.splice(index + 1, 0, copy);
      const fixed = list.map((item, i) => ({ ...item, index: i + 1 }));
      const repaired = repairInvariant(fixed, draft.activeStageId, index + 1);
      return { ...draft, ...repaired };
    }, { label: '复制阶段' });
  }

  /** 删除阶段：删的是 active 就让它后面最近的未演完阶段顶上（守住不变量） */
  function removeStage(id) {
    const { stages: current, activeStageId } = getState();
    const index = current.findIndex((stage) => stage.id === id);
    if (index === -1) return null;
    const wasActive = activeStageId === id;

    return store.update((draft) => {
      const list = draft.stages.filter((stage) => stage.id !== id).map((stage, i) => ({ ...stage, index: i + 1 }));
      const repaired = repairInvariant(list, wasActive ? null : draft.activeStageId, index);
      return { ...draft, ...repaired };
    }, { label: '删除阶段' });
  }

  /** 排序（拖拽 / 上下移动）：id 不变，所以 active 不受影响 */
  function moveStage(from, to) {
    return store.update((draft) => {
      const list = [...draft.stages];
      if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return draft;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      const fixed = list.map((item, i) => ({ ...item, index: i + 1 }));
      const repaired = repairInvariant(fixed, draft.activeStageId, to);
      return { ...draft, ...repaired };
    }, { label: '调整阶段顺序' });
  }

  function setLocked(id, locked) {
    return store.update((draft) => ({
      ...draft,
      stages: draft.stages.map((stage) => (stage.id === id ? { ...stage, locked: Boolean(locked) } : stage)),
    }), { label: locked ? '锁定阶段' : '解锁阶段' });
  }

  /** 从当前阶段往后截断（保留当前，删掉它后面所有未演完的）—— 供「截断重生成」 */
  function truncateAfterCurrent() {
    const { stages: list, activeStageId } = getState();
    const index = list.findIndex((stage) => stage.id === activeStageId);
    if (index === -1) return null;
    return store.update((draft) => ({
      ...draft,
      stages: draft.stages.slice(0, index + 1),
    }), { label: '截断后续阶段' });
  }

  /** 快照（导出 / 回滚都靠它） */
  function snapshot() {
    const state = getState();
    return {
      version: 1,
      outline: state.outline ?? null,
      stages: state.stages ?? [],
      activeStageId: state.activeStageId ?? null,
    };
  }

  function exportJson() {
    return JSON.stringify(snapshot(), null, 2);
  }

  /**
   * 导入快照（project 书 P8：导出导入往返无损）。
   * 校验不过就**原样返回失败**，一个字段都不写（G5）。
   */
  function importJson(text) {
    let data = null;
    try {
      data = typeof text === 'string' ? JSON.parse(text) : text;
    } catch {
      return { ok: false, error: '不是合法的 JSON' };
    }

    if (!data || typeof data !== 'object') return { ok: false, error: '快照要是一个对象' };
    if (!Array.isArray(data.stages)) return { ok: false, error: '快照里缺 stages 数组' };
    if (!data.stages.length) return { ok: false, error: '快照里没有任何阶段' };

    // preserve：id / 状态 / 计数 / 锁定全部照原样还原，这样才能"往返无损"
    const stages = normalizeStages(data.stages, { preserve: true });
    const repaired = repairInvariant(stages, data.activeStageId ?? stages[0]?.id ?? null, 0);

    store.update((draft) => ({
      ...draft,
      outline: data.outline ?? draft.outline ?? null,
      ...repaired,
    }), { label: '导入剧本' });

    onChanged?.();
    return { ok: true, stages: repaired.stages.length, activeStageId: repaired.activeStageId };
  }

  return {
    blankOutline,
    blankStage,
    updateStage,
    setOutline,
    setForeshadows,
    addStage,
    duplicateStage,
    removeStage,
    moveStage,
    setLocked,
    truncateAfterCurrent,
    snapshot,
    exportJson,
    importJson,
  };
}

export { STAGE_STATUSES };
