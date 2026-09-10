// 导演时间 · 最小配置面板（测试用）
//
// 存在的唯一理由：没有它就无法填 API，装进酒馆也测不了。
// **这不是最终 UI**（规范见 UI设计-完全版.md），只求能用，不求好看。
// 正式的六分类界面在 T-410 之后的 UI 阶段重写。

const PANEL_STYLE = `
  position:absolute; top:60px; left:20px; width:340px; max-height:76vh;
  overflow:auto; z-index:9999; padding:12px 14px;
  background:var(--dt-card,#f5efe1); color:var(--dt-ink,#2b2721);
  border:1px solid var(--dt-rule,rgba(43,39,33,.28)); border-radius:6px;
  font-family:var(--dt-font-mono,ui-monospace,monospace); font-size:12px; line-height:1.7;
`;

function fieldStyle() {
  return 'width:100%;box-sizing:border-box;margin:3px 0 8px;padding:5px 7px;font:inherit;'
    + 'background:rgba(255,255,255,.4);color:inherit;border:1px solid var(--dt-rule,rgba(43,39,33,.3));border-radius:3px';
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
    const s = store.getSettings();
    const c = s.connection ?? {};

    node.innerHTML = `
      <div style="font-size:13px;margin-bottom:8px">◆ 导演时间 · 配置（测试用）</div>
      <hr style="border:none;border-top:1px dashed var(--dt-rule,rgba(43,39,33,.28))">

      <label style="display:block;margin-top:8px">
        <input type="checkbox" id="dt-enabled" ${s.enabled ? 'checked' : ''}> 启用插件（总开关）
      </label>
      <label style="display:block">
        <input type="checkbox" id="dt-inject" ${s.injectEnabled ? 'checked' : ''}> 剧情注入
      </label>

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

    node.querySelector('#dt-save').addEventListener('click', () => {
      store.saveSettings({
        enabled: node.querySelector('#dt-enabled').checked,
        injectEnabled: node.querySelector('#dt-inject').checked,
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

  function show() { ensure().style.display = 'block'; return render(); }
  function hide() { if (el) el.style.display = 'none'; }
  function toggle() {
    if (el && el.style.display === 'none') return show();
    if (el) return hide();
    return show();
  }

  return { mount: ensure, render, show, hide, toggle };
}
