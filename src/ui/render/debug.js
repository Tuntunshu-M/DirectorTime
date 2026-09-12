// 导演时间 · 调试弹层（UI 定稿 §9）
//
// 控件（定稿 §2.1）：原文/清洗后 #48 · 撤销上一步 AI 修改 #49 · 清空剧本 #50
//
// **不画的东西**（定稿 §9 硬性要求 3：没实现就别画）：
//   · 「导演 API 日志」（时间/耗时/tokens）—— client 没有留调用日志，等实现了再画

import { esc, layerShell, row } from '../dom.js';
import { breakFilterLine, stanceSourceLine } from '../debug.js';

export function render(state, ctxState) {
  const debug = state.debug ?? {};
  const turn = debug.turn ?? null;
  const showRaw = Boolean(ctxState?.debugShowRaw);
  const stage = debug.stage ?? {};
  const spec = debug.speculation ?? {};
  const lastInjection = debug.lastInjection ?? null;
  const foreshadows = debug.foreshadows ?? [];

  const reply = showRaw ? (turn?.charMessageRaw ?? '') : (turn?.charCleaned ?? turn?.charMessage ?? '');
  const judgement = debug.lastJudgement
    ? `status: ${debug.lastJudgement.status}\nconfidence: ${debug.lastJudgement.confidence}\nreason: ${debug.lastJudgement.reason ?? ''}\n→ 动作 ${debug.lastAction ?? ''}（${debug.lastReason ?? ''}）`
    : '这一轮还没有判定';

  const body = `
    <div class="dt-sec">运行状态</div>
    <div class="dt-rows">
      ${row('阶段', `<span class="num">${stage.index ?? 0}/${stage.total ?? 0}</span> ${esc(stage.title ?? '')}`)}
      ${row('目标', esc(stage.goal ?? '—'))}
      ${row('状态', `<span class="hl">${esc(stage.status ?? '—')}</span> · 卡住 ${Number(stage.stuckCount ?? 0)} 轮`)}
      ${row('档位', esc(debug.automation ?? '—'))}
      ${row('已注册', debug.injection?.registered ? `（下一轮用）<span class="num"> ${Number(debug.injection.length ?? 0)}</span> 字` : '未注册')}
      ${row('上次动作', esc(debug.lastAction ? `${debug.lastAction}（${debug.lastReason ?? ''}）` : '—'))}
      ${row('判定来源', esc(stanceSourceLine(turn?.stance)))}
      ${row('伏笔', foreshadows.length ? esc(foreshadows.join('、')) : '无')}
      ${row('破限', esc(breakFilterLine(debug.breakStatus)))}
      ${row('投机', spec.total
    ? `命中 <span class="num">${spec.hits}/${spec.total}</span>（${Math.round((spec.rate ?? 0) * 100)}%）${spec.pending ? ` · 待验「${esc(spec.pending)}」` : ''}`
    : (spec.pending ? `待验「${esc(spec.pending)}」` : '还没跑过'))}
      ${row('累计', `调用 <span class="num">${Number(debug.cost?.callCount ?? 0)}</span> 次`)}
    </div>

    <div class="dt-sec" style="margin-top:12px">本轮回放 · 跟随 user 输入发送了什么</div>

    <details open><summary>注入全文（下一轮用、当前挂着的那份）</summary>
      <pre>${esc(debug.injection?.text ?? '（没有注册任何注入）')}</pre>
    </details>

    <details><summary>上次判定</summary><pre>${esc(judgement)}</pre></details>

    <details><summary>模型原始返回</summary><pre>${esc(debug.lastRaw || '（没有记录）')}</pre></details>

    <details><summary>上次发给导演 API（实际文本）</summary><pre>${esc(debug.lastRequest || '（没有记录）')}</pre></details>

    <details open><summary>上一轮注入（实际发送的那一份）</summary>
      <pre>${esc(lastInjection?.text ?? '（还没有跑过完整一轮）')}</pre>
      <div class="dt-note">${lastInjection?.speculation
    ? `上一轮投机：${lastInjection.speculation.hit ? '命中' : '失手'}（猜「${esc(lastInjection.speculation.guess ?? '')}」）`
    : '上一轮没有投机'}</div>
    </details>

    <details><summary>角色回复 · 原文 / 清洗后</summary>
      <div class="dt-seg2" style="margin:8px 0 6px">
        <button type="button" class="${showRaw ? '' : 'on'}" data-act="debug.showCleaned">清洗后</button>
        <button type="button" class="${showRaw ? 'on' : ''}" data-act="debug.showRaw">显示原文</button>
      </div>
      <pre>${esc(reply || '（这一轮还没有角色回复）')}</pre>
      <div class="dt-note">清洗只作用于插件自己看到的文本，聊天记录原文永远不动</div>
    </details>`;

  return {
    html: layerShell({
      layer: 'debug',
      title: '调试面板',
      backLabel: ctxState?.backTo ? `返回${ctxState.backTo}` : '返回',
      body,
      foot: `<span class="spacer"></span>
        <button class="dt-mini" type="button" data-act="debug.undo">撤销上一步 AI 修改</button>
        <button class="dt-mini" type="button" data-act="debug.reset">清空剧本</button>
        <span data-flash="debug" hidden></span>`,
    }),
    actions: {
      'debug.showRaw': (el, { ctx }) => { ctx.setState({ debugShowRaw: true }); ctx.refresh(); },
      'debug.showCleaned': (el, { ctx }) => { ctx.setState({ debugShowRaw: false }); ctx.refresh(); },
      'debug.undo': (el, { api, ctx }) => {
        const result = api.undo?.();
        ctx.flash('debug', result === false ? '没有可撤销的步骤' : '已撤销上一步 AI 修改', true);
        ctx.refresh();
      },
      'debug.reset': (el, { api, ctx }) => {
        api.resetScript?.();
        ctx.flash('debug', '剧本 / 历史 / 注入已清空，轮数归零', true);
        ctx.refresh();
      },
    },
  };
}
