// 导演时间 · 最小配置面板（测试用）
//
// 存在的唯一理由：没有它就无法填 API，装进酒馆也测不了。
// **这不是最终 UI**（规范见 UI设计-完全版.md），只求能用，不求好看。
// 正式的六分类界面在 T-410 之后的 UI 阶段重写。
//
// 表单渲染抽成 renderSettingsForm，供两种宿主复用：
//   1. 主面板（src/ui/panel.js）的「配置」页 —— 不传 onClose，关闭交给主面板
//   2. 独立浮层 createSettingsPanel —— 传 onClose，自带关闭按钮

import { PROFILE_FIELDS, PROFILE_FIELD_LABELS } from '../world/character.js';

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

function escapeAttr(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/** 人物侧写折叠区（T-402 §九：放进设置面板的折叠区，不单独开视图） */
function profileSection(profile) {
  const data = profile.read?.() ?? {};
  const fields = data.fields ?? {};
  const locked = data.locked ?? {};

  const rows = PROFILE_FIELDS.map((key) => `
    <div style="margin-top:6px">
      <div>${PROFILE_FIELD_LABELS[key]}<span class="dt-profile-lock">${locked[key] ? ` 🔒 <button type="button" data-profile-unlock="${key}" style="font:inherit;padding:0 5px;cursor:pointer">解锁</button>` : ''}</span></div>
      <input data-profile-field="${key}" style="${fieldStyle()}" value="${escapeAttr(fields[key] ?? '')}">
    </div>`).join('');

  return `
    <details style="margin-top:12px">
      <summary style="cursor:pointer">人物侧写（${escapeAttr(data.charName || '当前角色')}）</summary>
      <div style="font-size:11px;opacity:.7;margin-top:4px">手改过的字段会锁定，AI 不再覆盖（存在角色卡上，跨聊天复用）</div>
      ${rows}
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        <button id="dt-profile-regen" type="button" style="font:inherit;padding:5px 12px">重新生成侧写</button>
        <button id="dt-profile-unlock-all" type="button" style="font:inherit;padding:5px 12px">全部解锁</button>
      </div>
      <div id="dt-profile-msg" style="margin-top:6px;opacity:.75">—</div>
    </details>`;
}

/** 把配置表单渲染进指定容器；传了 onClose 才显示右上角关闭按钮 */
/** T-418：预设下拉的选项（只读酒馆预设，空列表就不给下拉） */
function presetOptions(list, current) {
  const head = '<option value="">（不选）</option>';
  return head + (list ?? [])
    .map((name) => `<option value="${escapeAttr(name)}"${name === current ? ' selected' : ''}>${escapeAttr(name)}</option>`)
    .join('');
}

/** T-418：破限预设折叠区。列表读不到就显示"无可用预设"，不报错、不伪造 */
function presetSection(presets) {
  const list = presets?.list?.() ?? [];
  const status = presets?.status?.() ?? { name: '', length: 0 };
  const message = status.name
    ? `当前：${status.name}（${status.active ? `${status.length} 字` : '读不到内容，未生效'}）`
    : '未选：不注入任何破限内容';

  return `
    <details style="margin-top:12px">
      <summary>预设（破限提示词，只读酒馆预设）</summary>
      <div style="margin:8px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${list.length
    ? `<select id="dt-preset-select" style="${fieldStyle()}">${presetOptions(list, status.name)}</select>`
    : '<span id="dt-preset-empty" style="opacity:.75">无可用预设</span>'}
        <button id="dt-preset-refresh" type="button" style="font:inherit;padding:5px 12px">刷新列表</button>
      </div>
      <div id="dt-preset-msg" style="margin-top:6px;opacity:.75">${message}</div>
    </details>`;
}

export function renderSettingsForm({ container, store, onTest, onSave, onClose, profile, presets } = {}) {
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
    ${profile ? profileSection(profile) : ''}
${presets ? presetSection(presets) : ''}
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

  // ---------- 人物侧写折叠区（T-402）----------
  if (presets) {
    const presetMsg = () => node.querySelector('#dt-preset-msg');
    node.querySelector('#dt-preset-select')?.addEventListener('change', (event) => {
      const status = presets.select?.(event.target.value) ?? {};
      if (presetMsg()) {
        presetMsg().textContent = status.name
          ? `当前：${status.name}（${status.active ? `${status.length} 字` : '读不到内容，未生效'}）`
          : '未选：不注入任何破限内容';
      }
    });
    node.querySelector('#dt-preset-refresh')?.addEventListener('click', () => {
      const list = presets.list?.() ?? [];
      const select = node.querySelector('#dt-preset-select');
      if (select) select.innerHTML = presetOptions(list, presets.status?.().name ?? '');
      if (presetMsg()) presetMsg().textContent = list.length ? `可用预设 ${list.length} 个` : '无可用预设';
    });
  }

  if (profile) {
    const profileMsg = () => node.querySelector('#dt-profile-msg');

    node.querySelectorAll('input[data-profile-field]').forEach((input) => {
      input.addEventListener('change', () => {
        profile.edit?.(input.dataset.profileField, input.value);
        const msg = profileMsg();
        if (msg) msg.textContent = '已保存（该字段已锁定）';
      });
    });

    node.querySelectorAll('button[data-profile-unlock]').forEach((button) => {
      button.addEventListener('click', () => {
        profile.unlock?.(button.dataset.profileUnlock);
        button.closest('.dt-profile-lock')?.replaceChildren();
        const msg = profileMsg();
        if (msg) msg.textContent = '已解锁';
      });
    });

    node.querySelector('#dt-profile-unlock-all')?.addEventListener('click', () => {
      profile.unlock?.(null);
      node.querySelectorAll('.dt-profile-lock').forEach((marker) => marker.replaceChildren());
      const msg = profileMsg();
      if (msg) msg.textContent = '已全部解锁';
    });

    node.querySelector('#dt-profile-regen')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = '生成中…';
      try {
        const result = await profile.regenerate?.();
        const msg = profileMsg();
        if (msg) msg.textContent = result?.ok ? '侧写已重新生成（已锁定字段保持不变）' : `失败：${result?.error ?? '未知'}`;
        if (result?.ok) renderSettingsForm({ container: node, store, onTest, onSave, onClose, profile });
      } finally {
        button.disabled = false;
        button.textContent = '重新生成侧写';
      }
    });
  }

  return node;
}

export function createSettingsPanel({ store, onTest, onSave, profile } = {}) {
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
    return renderSettingsForm({ container: node, store, onTest, onSave, onClose: hide, profile });
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
