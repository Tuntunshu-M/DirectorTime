// 导演时间 · 剧本页（UI 定稿 §4）
//
// 控件（定稿 §2.1）：↑↓ 重排 #11 · 复制 #12 · 删除 #13 · 🔒 锁定 #14 · goal/走位手改 #15
// 伏笔区（T-408）：未回收的伏笔列在这里，可手动销账。

import { esc } from '../dom.js';

const STATUS_LABEL = {
  active: '当前',
  ready: '当前（ready）',
  done: '已完成',
  pending: '等待中',
};

function stageStatus(stage, activeId) {
  if (stage.id === activeId) return STATUS_LABEL[stage.status] ?? '当前';
  return STATUS_LABEL[stage.status] ?? '等待中';
}

function stageBlock(stage, index, total, activeId, pacing) {
  const current = stage.id === activeId;
  const min = stage.pacing?.min ?? pacing?.min ?? 3;
  const max = stage.pacing?.max ?? pacing?.max ?? 8;
  const floor = current
    ? `楼层：min ${min} / max ${max} · 本场第 ${Number(stage.turnCount ?? 0)} 楼${stage.status === 'ready' ? ' · 已达成，收尾中' : ''}`
    : `楼层：min ${min} / max ${max} · 第 ${Number(stage.turnCount ?? 0)} 楼`;

  return `
  <details class="dt-stage${current ? ' dt-stage-cur' : ''}" ${current ? 'open' : ''} data-stage="${esc(stage.id)}">
    <summary>${index + 1}. ${esc(stage.title || '未命名')} · ${esc(stageStatus(stage, activeId))}</summary>
    <div class="dt-stage-body">
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin:6px 0">
        <button class="dt-mini" type="button" data-act="script.move" data-id="${esc(stage.id)}" data-delta="-1" ${index === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
        <button class="dt-mini" type="button" data-act="script.move" data-id="${esc(stage.id)}" data-delta="1" ${index === total - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
        <button class="dt-mini" type="button" data-act="script.duplicate" data-id="${esc(stage.id)}">复制</button>
        <button class="dt-mini" type="button" data-act="script.remove" data-id="${esc(stage.id)}">删除</button>
        <span class="dt-chip${stage.locked ? ' dt-chip-lock' : ''}" role="button" tabindex="0" data-act="script.lock" data-id="${esc(stage.id)}" title="点击切换：锁定后 AI 不许改这一场">${stage.locked ? '已锁定' : '未锁定'}</span>
      </div>
      <div class="dt-lbl">本场要做成（goal · 主语是 char）</div>
      <input type="text" data-act="script.setGoal" data-id="${esc(stage.id)}" value="${esc(stage.goal ?? '')}" placeholder="char 这一场要达成什么">
      <div class="dt-lbl">走位（一行一条）</div>
      <textarea rows="2" data-act="script.setBeats" data-id="${esc(stage.id)}" placeholder="char 的具体动作，一行一条">${esc((stage.beats ?? []).join('\n'))}</textarea>
      <div class="dt-note">${esc(floor)}</div>
    </div>
  </details>`;
}

export function render(state) {
  const stages = state.stages ?? [];
  const activeId = state.activeStageId ?? null;
  const activeIndex = stages.findIndex((stage) => stage.id === activeId);
  const foreshadows = state.foreshadows ?? [];
  const pacing = state.pacing ?? {};

  const head = stages.length
    ? `阶段 ${stages.length} 个 · 当前第 ${activeIndex >= 0 ? activeIndex + 1 : '—'} 个`
    : '阶段 0 个 · 先去「场记」生成剧本';

  const foreshadowBlock = foreshadows.length
    ? `<details class="dt-fold" id="fh" open>
        <summary>伏笔（${foreshadows.length} 条未回收）</summary>
        ${foreshadows.map((item) => `<div class="dt-entry">
          <span>${esc(item.text ?? item.summary ?? '')}<em>${item.stageTitle ? ` · ${esc(item.stageTitle)}埋下` : ''}</em></span>
          <button class="dt-mini" type="button" data-act="script.payoff" data-id="${esc(item.id)}">销账</button>
        </div>`).join('')}
        <div class="dt-note">重生成剧本时未回收的伏笔不丢失</div>
      </details>`
    : `<details class="dt-fold" id="fh">
        <summary>伏笔（已全部回收）</summary>
        <div class="dt-note">还没有埋下伏笔，或者都已经回收了</div>
      </details>`;

  return {
    html: `
    <div data-page="editor" hidden>
      <div class="dt-sec">${esc(head)}</div>
      ${stages.map((stage, index) => stageBlock(stage, index, stages.length, activeId, pacing)).join('')}
      <div class="dt-actions">
        <button class="dt-btn" type="button" data-act="script.add">＋ 新增一场</button>
      </div>
      <div class="dt-flash" data-flash="script" hidden></div>
      ${foreshadowBlock}
    </div>`,
    actions: {
      'script.move': (el, { api, ctx, state }) => {
        const stages = state.stages ?? [];
        const index = stages.findIndex((stage) => stage.id === el.dataset.id);
        const to = index + Number(el.dataset.delta ?? 0);
        if (index < 0 || to < 0 || to >= stages.length) return;
        api.editor?.moveStage?.(index, to);
        ctx.flash('script', '已重排，序号已重算');
        ctx.refresh();
      },
      'script.duplicate': (el, { api, ctx }) => {
        api.editor?.duplicateStage?.(el.dataset.id);
        ctx.flash('script', '已复制一场（标题带「副本」）');
        ctx.refresh();
      },
      'script.remove': (el, { api, ctx }) => {
        api.editor?.removeStage?.(el.dataset.id);
        ctx.flash('script', '已删除这一场');
        ctx.refresh();
      },
      'script.lock': (el, { api, ctx, state }) => {
        const stage = (state.stages ?? []).find((item) => item.id === el.dataset.id);
        api.editor?.setLocked?.(el.dataset.id, !stage?.locked);
        ctx.flash('script', stage?.locked ? '已解锁：AI 可以改这一场' : '已锁定：AI 不许改这一场');
        ctx.refresh();
      },
      'script.setGoal': (el, { api, ctx }) => {
        api.editor?.updateStage?.(el.dataset.id, { goal: el.value });
        ctx.flash('script', '已手改本场目标（这一场已锁定，AI 不再覆盖）');
        ctx.refresh();
      },
      'script.setBeats': (el, { api, ctx }) => {
        const beats = String(el.value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
        api.editor?.updateStage?.(el.dataset.id, { beats });
        ctx.flash('script', `已手改走位（${beats.length} 条）`);
        ctx.refresh();
      },
      'script.add': (el, { api, ctx, state }) => {
        api.editor?.addStage?.((state.stages ?? []).length - 1, { title: '新的一场' });
        ctx.flash('script', '已新增一场（在末尾）');
        ctx.refresh();
      },
      'script.payoff': (el, { api, ctx }) => {
        const result = api.foreshadows?.resolve?.(el.dataset.id);
        ctx.flash('script', result?.ok === false ? '销账失败（可能已经销过）' : '已销账：这条不再重生成时携带');
        ctx.refresh();
      },
    },
  };
}
