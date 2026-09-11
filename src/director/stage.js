// 导演时间 · 阶段状态操作
//
// T-203。状态机：pending → active → done，违背时可 dropped。
// 不变量：任一时刻有且仅有一个 active（由 state.assertInvariants 兜底）。

export function createStageService({ store } = {}) {
  function getActive() {
    return store.get().stages.find((stage) => stage.status === 'active') ?? null;
  }

  /** 装载新剧本：第一个阶段开工 */
  function load(stages) {
    return store.update(
      (draft) => ({
        ...draft,
        stages,
        activeStageId: stages[0]?.id ?? null,
      }),
      { label: '装载剧本' }
    );
  }

  /** 推进：当前阶段完成，下一个排队阶段开工 */
  function advance() {
    const state = store.get();
    const index = state.stages.findIndex((stage) => stage.id === state.activeStageId);
    if (index === -1) return null;

    return store.update((draft) => {
      const stages = [...draft.stages];
      stages[index] = { ...stages[index], status: 'done' };
      const next = index + 1;
      if (stages[next]) {
        stages[next] = { ...stages[next], status: 'active' };
        return { ...draft, stages, activeStageId: stages[next].id };
      }
      return { ...draft, stages, activeStageId: null };
    }, { label: `推进到阶段 ${index + 2}` });
  }

  /** 卡住计数 +1，达到阈值由调用方决定是否熔断 */
  function bumpStuck(id) {
    return store.update((draft) => ({
      ...draft,
      stages: draft.stages.map((stage) =>
        stage.id === id ? { ...stage, stuckCount: (stage.stuckCount ?? 0) + 1 } : stage
      ),
    }));
  }

  function resetStuck(id) {
    return store.update((draft) => ({
      ...draft,
      stages: draft.stages.map((stage) => (stage.id === id ? { ...stage, stuckCount: 0 } : stage)),
    }));
  }

  /** 作废（用户明确违背且意愿高时使用） */
  function drop(id) {
    return store.update((draft) => {
      const stages = draft.stages.map((stage) => (stage.id === id ? { ...stage, status: 'dropped' } : stage));
      return {
        ...draft,
        stages,
        activeStageId: draft.activeStageId === id ? null : draft.activeStageId,
      };
    }, { label: '作废阶段' });
  }

  /** 插入替补阶段（作废后重生成用） */
  function insertAfter(index, stages) {
    return store.update((draft) => {
      const list = [...draft.stages];
      list.splice(index + 1, 0, ...stages);
      return { ...draft, stages: list };
    }, { label: '插入替补阶段' });
  }

  /** 更新某个阶段的内容；locked 的字段不动（项目书 §1.4） */
  function update(id, patch) {
    return store.update((draft) => ({
      ...draft,
      stages: draft.stages.map((stage) => {
        if (stage.id !== id) return stage;
        if (stage.locked) return stage;
        return { ...stage, ...patch, aiOriginal: stage.aiOriginal ?? stage };
      }),
    }));
  }

  /** 续写：把新阶段追加到末尾（全部 pending），不影响当前 active */
  function append(stages) {
    if (!stages?.length) return null;
    return store.update((draft) => ({
      ...draft,
      stages: [...draft.stages, ...stages],
    }), { label: '续写阶段' });
  }

  /**
   * 激活指定阶段。**只在没有 active 阶段时调用**，否则会破坏"有且仅有一个 active"的不变量。
   * 用途：剧本一场就演完、续写后补位。
   */
  function activate(id) {
    if (!id) return null;
    return store.update((draft) => ({
      ...draft,
      stages: draft.stages.map((stage) => (stage.id === id ? { ...stage, status: 'active' } : stage)),
      activeStageId: id,
    }), { label: '激活阶段' });
  }

  return { getActive, load, advance, bumpStuck, resetStuck, drop, insertAfter, update, append, activate };
}
