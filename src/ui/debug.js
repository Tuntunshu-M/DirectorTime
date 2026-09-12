// 导演时间 · Debug 窗口
//
// T-207。功能优先，**不做视觉美化**（禁则 G4：美化留给 UI 阶段统一处理）。
// 目标只有一个：出问题时，一眼看出卡在哪一步、模型返回了什么。
//
// 状态计算抽成纯函数 buildDebugState，便于自动化测试；DOM 渲染单独一层。

import { hitRate } from '../director/speculate.js';
import { openForeshadows } from '../director/foreshadow.js';
import { automationText } from '../core/automation.js';

/**
 * T-411 / T-418：破限词模式 + 选中的酒馆预设，压成一行。
 *
 * **这一行只能说明一件事：到底注入了没有。**
 * 之前只写「预设生效 N 字」，可模式是 off 时其实一个字都没注入 —— Debug 是排查的唯一依据，
 * 它骗人整个排查就废了。所以这里统一口径：
 *   没注入 → 「预设：X（未启用，未注入）」/「自定义：空（未注入）」
 *   真注入 → 「预设：X（已注入 N 字）」
 * 末尾还会写「本轮实际注入 N 字」兜底。
 */
export function breakFilterLine(status) {
  if (!status) return '—';
  const mode = status.mode ?? 'off';
  const preset = status.preset ?? null;
  const wantsPreset = mode === 'preset' || mode === 'append';
  const wantsCustom = mode === 'custom' || mode === 'append';
  const parts = [];

  if (mode === 'off') {
    parts.push('关闭（未注入破限词）');
    if (preset?.name) parts.push(`预设：${preset.name}（未启用，未注入）`);
    return parts.join(' · ');
  }

  parts.push(`模式 ${mode}`);

  if (preset?.name) {
    if (wantsPreset && preset.active) parts.push(`预设：${preset.name}（已注入 ${preset.length} 字）`);
    else if (wantsPreset) parts.push(`预设：${preset.name}（读不到内容，未注入）`);
    else parts.push(`预设：${preset.name}（未启用，未注入）`);
  } else if (wantsPreset) {
    parts.push(preset?.available ? '未选预设（未注入）' : '无可用预设（未注入）');
  } else {
    parts.push('未选预设（未注入）');
  }

  if (wantsCustom) {
    parts.push(status.customLength ? `自定义：已注入 ${status.customLength} 字` : '自定义：空（未注入）');
  }

  parts.push(`本轮实际注入 ${status.injected ?? 0} 字`);
  return parts.join(' · ');
}

/** 纯函数：把当前状态整理成 Debug 需要的结构 */
export function buildDebugState({
  store, registry, last = null, capabilities = null, lastTurn = null, lastRequest = null, breakStatus = null,
} = {}) {
  const state = store?.get?.() ?? {};
  const stages = state.stages ?? [];
  const active = stages.find((stage) => stage.id === state.activeStageId) ?? null;
  const index = active ? stages.findIndex((stage) => stage.id === active.id) + 1 : 0;

  const injection = registry?.getStatus?.() ?? { registered: false, length: 0, text: '' };

  return {
    stage: {
      index,
      total: stages.length,
      title: active?.title ?? '',
      goal: active?.goal ?? '',
      status: active?.status ?? 'none',
      stuckCount: active?.stuckCount ?? 0,
      activeStageId: state.activeStageId ?? null,
    },
    injection: {
      registered: injection.registered,
      length: injection.length,
      text: injection.text ?? '',
    },
    // T-407 投机执行：命中率 + 待验证的预测
    speculation: {
      ...hitRate(state.runtime?.speculationStats),
      pending: state.runtime?.speculation?.guess ?? '',
    },
    // T-408 伏笔：还没回收的（词表判断收在 foreshadow.js，别在这里重复写死状态词）
    foreshadows: openForeshadows(state.outline).map((item) => item.text),
    lastJudgement: last?.judgement ?? null,
    lastAction: last?.action ?? null,
    // T-414：当前档位一行看完 —— 排查时先确认"是不是档位设错了"
    automation: automationText(state.automation),
    lastReason: last?.reason ?? null,
    lastRaw: last?.raw ?? '',
    turn: lastTurn ?? null,
    lastReviewAt: state.runtime?.lastReviewAt ?? 0,
    cost: state.cost ?? { sessionTotal: 0, callCount: 0 },
    capabilities: capabilities ?? null,
    lastRequest: lastRequest ?? '',
    // T-411 / T-418：破限词模式与选中的酒馆预设（判据：选中后要能在这里看到生效）
    breakStatus: breakStatus ?? null,
  };
}

const PANEL_STYLE = `
  position:fixed; top:60px; right:20px; width:360px; max-width:calc(100vw - 40px);
  max-height:calc(100vh - 80px); max-height:calc(100dvh - 80px);
  overflow:auto; z-index:9999; padding:12px 14px;
  background:var(--dt-card,#f5efe1); color:var(--dt-ink,#2b2721);
  border:1px solid var(--dt-rule,rgba(43,39,33,.28)); border-radius:6px;
  font-family:var(--dt-font-mono,ui-monospace,monospace); font-size:12px; line-height:1.6;
`;

export function createDebugPanel({ store, registry, getCapabilities, getLastTurn, getLastRequest, getBreakStatus } = {}) {
  let el = null;
  let last = null;

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dt-debug';
    el.style.cssText = PANEL_STYLE;
    document.body.appendChild(el);
    return el;
  }

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function row(label, value) {
    return `<div><span style="opacity:.6">${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
  }

  /** T-407：把命中率 / 待验证的预测压成一行 */

  /** T-407：把命中率 / 待验证的预测压成一行 */
  function speculationLine(spec) {
    if (!spec) return '未启用';
    const parts = [];
    if (spec.total) parts.push(`命中 ${spec.hits}/${spec.total}（${Math.round(spec.rate * 100)}%）`);
    if (spec.pending) parts.push(`待验「${spec.pending}」`);
    return parts.length ? parts.join(' · ') : '未启用';
  }

  function render() {
    const node = ensure();
    const s = buildDebugState({
      store, registry, last,
      capabilities: getCapabilities?.(),
      lastTurn: getLastTurn?.() ?? null,
      lastRequest: getLastRequest?.() ?? null,
      breakStatus: getBreakStatus?.() ?? null,
    });

    node.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:8px">
        <span style="flex:1">◆ 导演时间 · 调试</span>
        <button id="dt-debug-close" type="button" aria-label="关闭调试面板" title="关闭" style="font:inherit;padding:3px 8px;cursor:pointer">✕</button>
      </div>
      <hr style="border:none;border-top:1px dashed var(--dt-rule,rgba(43,39,33,.28))">
      <div style="margin:8px 0">
        ${row('阶段', `${s.stage.index}/${s.stage.total} ${s.stage.title}`)}
        ${row('目标', s.stage.goal || '—')}
        ${row('状态', `${s.stage.status} · 卡住 ${s.stage.stuckCount} 轮`)}
        ${row('档位', s.automation || '—')}
        ${row('注入', s.injection.registered ? `已注册 · ${s.injection.length} 字` : '未注册')}
        ${row('上次动作', s.lastAction ? `${s.lastAction}（${s.lastReason ?? ''}）` : '—')}
        ${row('伏笔', s.foreshadows?.length ? `待回收 ${s.foreshadows.length}：${s.foreshadows.join(' / ')}` : '无')}
        ${row('破限', breakFilterLine(s.breakStatus))}
        ${row('投机', speculationLine(s.speculation))}
        ${row('累计', `调用 ${s.cost.callCount} 次`)}
      </div>
      <details open style="margin-top:8px"><summary>本轮回放 · 跟随 user 输入发送了什么</summary>
        <div style="margin:6px 0">
          ${row('user 说', s.turn?.userMessage || '—')}
          ${row('本轮注入', s.turn?.usedInjection ? `${s.turn.usedInjection.length} 字` : '（空）')}
          ${row('char 回', (s.turn?.charMessage || '—').slice(0, 100))}
          ${row('判定', s.turn ? `${s.turn.action}（${s.turn.reason}）` : '—')}
          ${row('投机', s.turn?.speculation ? `${s.turn.speculation.hit ? '命中' : '失手'}（猜「${s.turn.speculation.guess}」）` : '—')}
        </div>
        <pre style="white-space:pre-wrap;margin:6px 0">${escapeHtml(s.turn?.usedInjection || '（本轮没有注入内容）')}</pre>
        <details><summary>下轮将注入</summary>
          <pre style="white-space:pre-wrap;margin:6px 0">${escapeHtml(s.turn?.nextInjection || '（空）')}</pre>
        </details>
      </details>
      <details style="margin-top:6px"><summary>注入全文</summary>
        <pre style="white-space:pre-wrap;margin:6px 0">${escapeHtml(s.injection.text || '（空）')}</pre>
      </details>
      <details style="margin-top:6px"><summary>上次判定</summary>
        <pre style="white-space:pre-wrap;margin:6px 0">${escapeHtml(s.lastJudgement ? JSON.stringify(s.lastJudgement, null, 2) : '（无）')}</pre>
      </details>
      <details style="margin-top:6px"><summary>模型原始返回</summary>
        <pre style="white-space:pre-wrap;margin:6px 0">${escapeHtml(s.lastRaw || '（无）')}</pre>
      </details>
      <details style="margin-top:6px"><summary>上次发给导演 API（实际文本）</summary>
        <pre style="white-space:pre-wrap;margin:6px 0">${escapeHtml(s.lastRequest || '（还没有请求过）')}</pre>
      </details>
      <div style="margin-top:10px"><button id="dt-debug-export" style="font:inherit;padding:4px 10px">导出状态 JSON</button></div>
    `;

    node.querySelector('#dt-debug-close')?.addEventListener('click', hide);
    node.querySelector('#dt-debug-export')?.addEventListener('click', exportJson);
    return s;
  }

  /** 复盘结束后调用，把模型原始返回与判定结果喂进来 */
  function setLast(payload) {
    last = payload;
    if (el) render();
  }

  function show() {
    ensure().style.display = 'block';
    return render();
  }

  function hide() {
    if (el) el.style.display = 'none';
  }

  function toggle() {
    if (el && el.style.display === 'none') return show();
    if (el) return hide();
    return show();
  }

  /** 导出全部状态，提 issue 时直接贴 */
  function exportJson() {
    const s = buildDebugState({
      store, registry, last,
      capabilities: getCapabilities?.(),
      lastTurn: getLastTurn?.() ?? null,
      lastRequest: getLastRequest?.() ?? null,
      breakStatus: getBreakStatus?.() ?? null,
    });
    const json = JSON.stringify(s, null, 2);
    try {
      navigator.clipboard?.writeText(json);
    } catch {
      /* 剪贴板不可用时至少 console 里能拿到 */
    }
    console.log('[导演时间] 状态导出', json);
    return json;
  }

  return { mount: ensure, render, show, hide, toggle, setLast, exportJson };
}
