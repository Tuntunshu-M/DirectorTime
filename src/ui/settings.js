// 导演时间 · 最小配置面板（测试用）
//
// 存在的唯一理由：没有它就无法填 API，装进酒馆也测不了。
// **这不是最终 UI**（规范见 UI设计-完全版.md），只求能用，不求好看。
// 正式的六分类界面在 T-410 之后的 UI 阶段重写。
//
// 表单渲染抽成 renderSettingsForm，供两种宿主复用：
//   1. 主面板（src/ui/panel.js）的「配置」页 —— 不传 onClose，关闭交给主面板
//   2. 独立浮层 createSettingsPanel —— 传 onClose，自带关闭按钮

const PANEL_STYLE = `
  position:fixed; top:60px; left:20px; width:340px; max-width:calc(100vw - 40px);
  max-height:calc(100vh - 80px); max-height:calc(100dvh - 80px);
  overflow:auto; z-index:9999; padding:12px 14px;
  background:var(--dt-card,#f5efe1); color:var(--dt-ink,#2b2721);
  border:1px solid var(--dt-rule,rgba(43,39,33,.28)); border-radius:6px;
  font-family:var(--dt-font-mono,ui-monospace,monospace); font-size:12px; line-height:1.7;
`;

function fieldStyle() {
  return 'width:100%;box-sizing:border-box;margin:3px 0 8px;padding:5px 7px;font:inherit;'
    + 'background:rgba(255,255,255,.4);color:inherit;border:1px solid var(--dt-rule,rgba(43,39,33,.3));border-radius:3px';
}

/** 把配置表单渲染进指定容器；传了 onClose 才显示右上角关闭按钮 */
export function renderSettingsForm({ container, store, onTest, onSave, onClose } = {}) {
  const node = container;
  const s = store.getSettings();
  const c = s.connection ?? {};

  node.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <div style="font-size:13px;flex:1">◆ 导演时间 · 配置（测试用）</div>
      ${onClose ? '<button id="dt-settings-close" type="button" aria-label="关闭配置" title="关闭" style="font:inherit;padding:3px 8px;cursor:pointer">✕</button>' : ''}
    </div>
    <hr style="border:none;border-top:1px dashed var(--dt-rule,rgba(43,39,33,.28))">

    <label style="display:block;margin-top:8px">
      <input type="checkbox" id="dt-enabled" ${s.enabled ? 'checked' : ''}> 启用插件（总开关）
    </label>
    <label style="display:block">
      <input type="checkbox" id="dt-inject" ${s.injectEnabled ? 'checked' : ''}> 剧情注入
    </label>

    <div style="margin-top:10px">剧本轮数上限</div>
    <input id="dt-max-rounds" type="number" min="1" style="${fieldStyle()}" value="${s.maxRounds ?? 15}">
    <div style="font-size:11px;opacity:.7">跑满这么多轮就自动清空剧本，重新开新戏</div>

    <div style="margin-top:10px">端点</div>
    <input id="dt-endpoint" style="${fieldStyle()}" placeholder="https://你的站子/v1" value="${c.endpoint ?? ''}">
    <div>密钥</div>
    <input id="dt-key" type="password" style="${fieldStyle()}" placeholder="sk-..." value="${c.apiKey ?? ''}">
    <div>模型</div>
    <input id="dt-model" style="${fieldStyle()}" placeholder="gemini-2.0-flash" value="${c.model ?? ''}">

    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <button id="dt-save" style="font:inherit;padding:5px 12px">保存</button>
      <button id="dt-test" style="font:inherit;padding:5px 12px">测试连接</button>
      <button id="dt-refresh" style="font:inherit;padding:5px 12px">刷新模型列表</button>
    </div>
    <div id="dt-msg" style="margin-top:8px;opacity:.75">—</div>
  `;

  node.querySelector('#dt-settings-close')?.addEventListener('click', () => onClose?.());

  node.querySelector('#dt-save').addEventListener('click', () => {
    store.saveSettings({
      enabled: node.querySelector('#dt-enabled').checked,
      injectEnabled: node.querySelector('#dt-inject').checked,
      maxRounds: Math.max(1, Number(node.querySelector('#dt-max-rounds').value) || 15),
      connection: {
        mode: 'independent',
        endpoint: node.querySelector('#dt-endpoint').value.trim(),
        apiKey: node.querySelector('#dt-key').value.trim(),
        model: node.querySelector('#dt-model').value.trim(),
      },
    });
    onSave?.();
    node.querySelector('#dt-msg').textContent = '已保存';
  });

  node.querySelector('#dt-test').addEventListener('click', async () => {
    const msg = node.querySelector('#dt-msg');
    msg.textContent = '测试中…';
    try {
      const result = await onTest?.();
      msg.textContent = result?.ok ? `连通，模型 ${result.models?.length ?? 0} 个` : '失败';
    } catch (error) {
      msg.textContent = error?.message ?? '失败';
    }
  });

  node.querySelector('#dt-refresh').addEventListener('click', async () => {
    const msg = node.querySelector('#dt-msg');
    try {
      const result = await onTest?.();
      msg.textContent = result?.ok ? (result.models ?? []).join(', ') || '（空列表）' : '失败';
    } catch (error) {
      msg.textContent = error?.message ?? '失败';
    }
  });

  return node;
}

export function createSettingsPanel({ store, onTest, onSave } = {}) {
  let el = null;

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dt-settings';
    el.style.cssText = PANEL_STYLE;
    document.body.appendChild(el);
    return el;
  }

  function render() {
    const node = ensure();
    return renderSettingsForm({ container: node, store, onTest, onSave, onClose: hide });
  }

  function show() { ensure().style.display = 'block'; return render(); }
  function hide() { if (el) el.style.display = 'none'; }
  function toggle() {
    if (el && el.style.display === 'none') return show();
    if (el) return hide();
    return show();
  }

  return { mount: ensure, render, show, hide, toggle };
}
