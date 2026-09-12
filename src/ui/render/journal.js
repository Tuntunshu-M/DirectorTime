// 导演时间 · 场记页（UI 定稿 §2 分类「场记」/ §3 状态行）
//
// 只回答一个问题：**现在在拍什么**。
// 控件（定稿 §2.1）：总开关 #7 · 重新生成剧本 #8 · 重新续写 #9 · 待确认 采用/丢弃 #10

import { esc, row, toggle } from '../dom.js';

const ACTION_LABEL = {
  advance: 'advance（本场过关，切下一场）',
  settle: 'settle（已达成，先收尾）',
  force: 'force（到点强制推进）',
  rewrite: 'rewrite（换个说法再试）',
  drop: 'drop（让步，作废本场）',
  regenAfter: 'regenAfter（让步并重生成后续）',
  redirect: 'redirect（改方向）',
  hold: 'hold（保持不动）',
  halt: 'halt（命中硬禁区，已停）',
};

export function render(state) {
  const stage = state.stage ?? {};
  const active = stage.active ?? null;
  const last = state.lastTurn ?? null;
  const spec = state.speculation ?? {};
  const cost = state.cost ?? {};

  const stageLine = stage.total
    ? `<span class="num">${stage.index}/${stage.total}</span> ${esc(active?.title ?? '—')}`
    : '还没有剧本';
  const stateLine = active
    ? `<span class="hl">${esc(active.status ?? '—')}</span> · 卡住 ${Number(active.stuckCount ?? 0)} 轮 · 本场第 ${Number(active.turnCount ?? 0)} 楼`
    : '—';
  const injection = state.injection?.registered
    ? `已注册（下一轮用）<span class="num"> ${Number(state.injection.length ?? 0)}</span> 字`
    : '未注册';
  const foreshadowText = (state.foreshadows ?? []).length
    ? `${state.foreshadows.length} 条未回收`
    : '无';
  const specLine = spec.total
    ? `命中 <span class="num">${spec.hits}/${spec.total}</span>（${Math.round((spec.rate ?? 0) * 100)}%）${spec.enabled ? '' : ' · 已关闭'}`
    : (spec.enabled ? '已开启（还没跑过）' : '已关闭');

  const queue = state.queue ?? [];
  const queueBlock = queue.length
    ? `<div class="dt-queue">
        <div class="dt-queue-t">待确认 ${queue.length} 条 · 档位 L1，确认后才生效</div>
        ${queue.map((item) => `<div class="dt-queue-row">
          <span style="flex:1">${esc(item.summary ?? item.feature ?? '')} <span class="dt-chip">${esc(item.feature ?? '')}</span></span>
          <button class="dt-mini" type="button" data-act="journal.adopt" data-id="${esc(item.id)}">采用</button>
          <button class="dt-mini" type="button" data-act="journal.discard" data-id="${esc(item.id)}">丢弃</button>
        </div>`).join('')}
      </div>`
    : '';

  return {
    html: `
    <div data-page="status">
      <div class="dt-toggle" style="border-bottom:1px solid var(--rule);padding-bottom:10px">
        <div><strong style="font-size:13.5px">导演时间</strong><br>
          <span class="dt-note" style="margin:0">关掉即停止一切：清空注入、停复盘</span></div>
        ${toggle({ act: 'journal.toggleEnabled', checked: Boolean(state.enabled), big: true })}
      </div>

      <div class="dt-sec" style="margin-top:11px">本场</div>
      <div class="dt-rows">
        ${row('阶段', stageLine)}
        ${row('目标', esc(active?.goal ?? '—'))}
        ${row('状态', stateLine)}
        ${row('档位', esc(state.automationText ?? '—'))}
        ${row('注入', injection)}
        ${row('上次动作', last ? esc(ACTION_LABEL[last.action] ?? last.action ?? '—') : '—')}
        ${row('伏笔', esc(foreshadowText))}
        ${row('投机', specLine)}
        ${row('累计', `调用 <span class="num">${Number(cost.callCount ?? 0)}</span> 次`)}
      </div>
      <div class="dt-actions">
        <button class="dt-btn dt-btn-primary" type="button" data-act="journal.generate">重新生成剧本</button>
        <button class="dt-btn" type="button" data-act="journal.extend" ${stage.total ? '' : 'disabled'}>重新续写</button>
      </div>
      <div class="dt-flash" data-flash="journal" hidden></div>
      ${queueBlock}
    </div>`,
    actions: {
      'journal.toggleEnabled': (el, { api, ctx }) => {
        api.onToggleEnabled?.(el.checked);
        ctx.flash('journal', el.checked ? '已启用：下一轮开始注入' : '已停用：注入已清空、复盘停止');
        ctx.refresh();
      },
      'journal.generate': async (el, { api, ctx }) => {
        ctx.busy('journal', '生成中…');
        const result = await api.onGenerate?.();
        ctx.flash('journal', result?.ok === false
          ? `生成失败：${result.reason ?? result.error ?? '原因不明'} → 到设置里检查 API，或点「重新生成剧本」再试`
          : '已提交生成；L1 档位会进「待确认」队列');
        ctx.refresh();
      },
      'journal.extend': async (el, { api, ctx }) => {
        ctx.busy('journal', '续写中…');
        const result = await api.onExtend?.();
        ctx.flash('journal', result?.ok === false
          ? `续写失败：${result.reason ?? '原因不明'} → 到设置里检查 API`
          : '已请求续写，补 2 条待演阶段');
        ctx.refresh();
      },
      'journal.adopt': (el, { api, ctx }) => {
        const result = api.queue?.approve?.(el.dataset.id);
        ctx.flash('journal', result?.ok === false ? '采用失败（这一项可能已经过期）' : '已采用：队列项已生效');
        ctx.refresh();
      },
      'journal.discard': (el, { api, ctx }) => {
        api.queue?.reject?.(el.dataset.id);
        ctx.flash('journal', '已丢弃，剧本不变');
        ctx.refresh();
      },
    },
  };
}
