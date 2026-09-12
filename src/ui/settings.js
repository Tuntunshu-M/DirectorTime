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
import { FEATURES, LEVELS, FEATURE_LABELS, LEVEL_LABELS } from '../core/automation.js';
import { TONE_KEYS, TONE_LABELS } from '../core/tone.js';

const BTN = 'font:inherit;padding:3px 9px;cursor:pointer';

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
  const entries = status.name ? (presets?.entries?.() ?? []) : [];
  const message = status.name
    ? `当前：${status.name}（${status.active ? `${status.length} 字` : '读不到内容，未生效'}）`
    : '未选：不注入任何破限内容';

  // 自选条目：不勾 = 用全部启用的条目（与 T-418 原本行为一致）
  const entryBoxes = entries.length > 1 ? `
      <div style="margin-top:6px">
        <div style="opacity:.6">自选条目（一个都不勾 = 用全部启用的条目）</div>
        ${entries.map((entry) => `
          <label style="display:block;margin:2px 0"><input type="checkbox" data-dt-preset-entry="${entry.index}"${entry.selected ? ' checked' : ''}> ${escapeAttr(entry.name)}${entry.enabled ? '' : '<span style="opacity:.6">（酒馆里禁用了）</span>'}</label>`).join('')}
      </div>` : '';

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
      ${entryBoxes}
    </details>`;
}

/** T-414：六个功能点的档位下拉（L0 全手动 / L1 待确认 / L2 全自动） */
function automationSection(automation) {
  const current = automation?.get?.() ?? {};
  const rows = FEATURES.map((feature) => `
    <div style="display:flex;gap:6px;align-items:center;margin:4px 0">
      <div style="flex:1">${FEATURE_LABELS[feature]}</div>
      <select data-dt-automation="${feature}" style="${fieldStyle()}">
        ${LEVELS.map((level) => `<option value="${level}"${current[feature] === level ? ' selected' : ''}>${level} ${LEVEL_LABELS[level]}</option>`).join('')}
      </select>
    </div>`).join('');

  return `
    <details style="margin-top:12px">
      <summary>自动化档位（L0 全手动 / L1 待确认 / L2 全自动）</summary>
      <div style="margin:8px 0">${rows}</div>
      <div id="dt-automation-msg" style="margin-top:6px;opacity:.75">L1 的产物会进主面板的「待确认」，确认后才生效</div>
    </details>`;
}

/**
 * 模型特化预设（T-403 / F10）：按模型做**反向矫正**，二选一（方向相反，不能同时开）
 *   Claude 容易被动 → 推主动；Gemini 容易极端 → 拉回边界
 */
function modelPresetSection(modelPreset) {
  const current = modelPreset?.get?.() ?? { kind: 'off', custom: {} };
  const kind = current.kind ?? 'off';
  const kinds = modelPreset?.kinds?.() ?? ['off', 'claude', 'gemini'];
  const labels = modelPreset?.labels?.() ?? {};
  const text = modelPreset?.text?.() ?? '';
  const editing = kind === 'off' ? '' : (current.custom?.[kind] || modelPreset?.defaultText?.(kind) || '');

  return `
    <details style="margin-top:12px">
      <summary>模型特化预设（按模型反向矫正，二选一）</summary>
      <div style="margin:8px 0">
        ${kinds.map((key) => `<label style="display:block;margin:2px 0">
          <input type="radio" name="dt-redline-kind" value="${key}" ${kind === key ? 'checked' : ''}> ${escapeAttr(labels[key] ?? key)}
        </label>`).join('')}
      </div>
      <div style="font-size:11px;opacity:.7">
        开启后<b>两端都注入</b>：导演请求（剧情生成）+ 每轮指令（角色回复）。只开一端会撕裂。<br>
        Claude 容易写成被动等待 → 选 Claude；Gemini 容易极端模板化 → 选 Gemini。两套方向相反，不能同时开。
        当前${text ? `生效 ${text.length} 字` : '未注入任何内容'}。
      </div>
      <textarea id="dt-redline-text" rows="8" style="${fieldStyle()}" ${kind === 'off' ? 'disabled placeholder="先在上面选一套"' : ''}>${escapeAttr(editing)}</textarea>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="dt-redline-save" type="button" style="${BTN}" ${kind === 'off' ? 'disabled' : ''}>保存</button>
        <button id="dt-redline-reset" type="button" style="${BTN}" ${kind === 'off' ? 'disabled' : ''}>恢复内置</button>
      </div>
      <div id="dt-redline-msg" style="margin-top:6px;opacity:.75">—</div>
    </details>`;
}

/** 破限词模式（T-411 的界面入口）：off / preset / custom / append */
function breakFilterSection(breakFilter, presets) {
  const current = breakFilter?.get?.() ?? { mode: 'off', custom: '' };
  const presetName = presets?.status?.().name ?? '';
  const modes = [
    ['off', '关闭（不注入破限词）'],
    ['preset', '跟随酒馆预设'],
    ['custom', '只用下面自定义'],
    ['append', '预设 + 自定义'],
  ];
  return `
    <details style="margin-top:12px">
      <summary>破限词模式</summary>
      <div style="margin:8px 0">
        <select id="dt-break-mode" style="${fieldStyle()}">
          ${modes.map(([value, label]) => `<option value="${value}"${current.mode === value ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div>自定义破限词（custom / append 模式用）</div>
      <textarea id="dt-break-custom" rows="4" style="${fieldStyle()}">${escapeAttr(current.custom)}</textarea>
      <div id="dt-break-msg" style="opacity:.75">
        ${current.mode === 'off' ? '当前不注入任何破限词' : (presetName ? `当前预设：${escapeAttr(presetName)}` : '还没选预设（在上面「预设」区里选）')}
        <button id="dt-break-save" type="button" style="${BTN}">保存</button>
      </div>
    </details>`;
}

/** 剧情占比（T-415 的界面入口）：三条线联动配平，和恒为 100 */
function toneSection(tone) {
  const current = tone?.get?.() ?? {};
  const rows = TONE_KEYS.map((key) => `
    <div style="display:flex;gap:6px;align-items:center;margin:4px 0">
      <div style="flex:1">${escapeAttr(TONE_LABELS[key] ?? key)}</div>
      <input type="number" min="0" max="100" data-dt-tone="${key}" value="${Number(current[key] ?? 0)}" style="width:5em;font:inherit;padding:3px 5px">
    </div>`).join('');
  return `
    <details style="margin-top:12px">
      <summary>剧情占比（三条线联动，和恒为 100）</summary>
      <div style="margin:8px 0">${rows}</div>
      <div id="dt-tone-msg" style="opacity:.75">拖一条，另外两条按原比例配平</div>
    </details>`;
}

/** 主角（T-412 多人卡的界面入口） */
function castSection(cast) {
  const names = (cast?.get?.() ?? []).map((item) => item.name).filter(Boolean).join('、');
  return `
    <details style="margin-top:12px">
      <summary>主角（多人卡）</summary>
      <input id="dt-cast-names" style="${fieldStyle()}" placeholder="用、或逗号分隔；留空 = 单卡老行为" value="${escapeAttr(names)}">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button id="dt-cast-save" type="button" style="${BTN}">保存</button>
      </div>
      <div id="dt-cast-msg" style="margin-top:6px;opacity:.75">只在这些主角说话时注入；不是他的戏不注入</div>
    </details>`;
}

/** 副本迁移（T-413 的界面入口）：导出 / 导入 */
function copySection(copy) {
  return `
    <details style="margin-top:12px">
      <summary>副本迁移（导出 / 导入）</summary>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
        <button id="dt-copy-export" type="button" style="${BTN}">导出到下面</button>
        <button id="dt-copy-import" type="button" style="${BTN}">从下面导入</button>
      </div>
      <textarea id="dt-copy-area" rows="5" style="${fieldStyle()}" placeholder="副本 JSON"></textarea>
      <div id="dt-copy-msg" style="opacity:.75">副本不含端点与密钥；导入前会给你看概览与警告</div>
    </details>`;
}

export function renderSettingsForm({
  container, store, onTest, onSave, onClose, profile, presets, automation, extras,
} = {}) {
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
${automation ? automationSection(automation) : ''}
${extras?.modelPreset ? modelPresetSection(extras.modelPreset) : ''}
${extras?.breakFilter ? breakFilterSection(extras.breakFilter, presets) : ''}
${extras?.tone ? toneSection(extras.tone) : ''}
${extras?.cast ? castSection(extras.cast) : ''}
${extras?.copy ? copySection(extras.copy) : ''}
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
  if (automation) {
    const autoMsg = () => node.querySelector('#dt-automation-msg');
    node.querySelectorAll('select[data-dt-automation]').forEach((select) => {
      select.addEventListener('change', (event) => {
        const feature = event.target.dataset.dtAutomation;
        automation.set?.(feature, event.target.value);
        const msg = autoMsg();
        if (msg) msg.textContent = `${feature} → ${event.target.value}（L1 的产物进「待确认」）`;
      });
    });
  }

  if (presets) {
    const presetMsg = () => node.querySelector('#dt-preset-msg');
    node.querySelector('#dt-preset-select')?.addEventListener('change', (event) => {
      const status = presets.select?.(event.target.value) ?? {};
      if (presetMsg()) {
        presetMsg().textContent = status.name
          ? `当前：${status.name}（${status.active ? `${status.length} 字` : '读不到内容，未生效'}）`
          : '未选：不注入任何破限内容';
      }
      // 换预设 → 条目列表跟着换，重绘一次最省事（面板是临时界面，不做局部刷新）
      renderSettingsForm({ container: node, store, onTest, onSave, onClose, profile, presets, automation, extras });
    });
    node.querySelectorAll('input[data-dt-preset-entry]').forEach((input) => {
      input.addEventListener('change', () => {
        const picked = [...node.querySelectorAll('input[data-dt-preset-entry]')]
          .filter((box) => box.checked)
          .map((box) => Number(box.dataset.dtPresetEntry));
        const status = presets.selectEntries?.(picked) ?? {};
        if (presetMsg()) {
          presetMsg().textContent = picked.length
            ? `已选 ${picked.length} 条（生效 ${status.length ?? 0} 字）`
            : `未勾条目：用全部启用的条目（生效 ${status.length ?? 0} 字）`;
        }
      });
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
        // 先重绘再写提示 —— 反过来的话提示会被重绘冲掉，用户只能看到"一片空白"（P0 修正）
        if (result?.ok) renderSettingsForm({ container: node, store, onTest, onSave, onClose, profile, presets, automation, extras });
        const msg = profileMsg();
        if (msg) {
          msg.textContent = result?.ok
            ? (result?.pending ? '侧写已生成，等你在「待确认」里采用（侧写档位 L1）' : '侧写已重新生成（已锁定字段保持不变）')
            : `失败：${result?.error ?? '未知'}`;
        }
      } finally {
        button.disabled = false;
        button.textContent = '重新生成侧写';
      }
    });
  }

  // ---------- 模型特化预设（T-403）----------
  if (extras?.modelPreset) {
    const msg = () => node.querySelector('#dt-redline-msg');
    node.querySelectorAll('input[name="dt-redline-kind"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const next = extras.modelPreset.set({ kind: radio.value });
        // 换套要把文本框换成那一套的文本，重绘最省事（面板是临时界面，不做局部刷新）
        renderSettingsForm({ container: node, store, onTest, onSave, onClose, profile, presets, automation, extras });
        const after = node.querySelector('#dt-redline-msg');
        if (after) {
          after.textContent = next.kind === 'off'
            ? '已关闭：两端都不注入'
            : `已启用 ${next.kind}：导演请求与每轮指令都会带上（${extras.modelPreset.text().length} 字）`;
        }
      });
    });
    node.querySelector('#dt-redline-save')?.addEventListener('click', () => {
      const text = node.querySelector('#dt-redline-text').value;
      extras.modelPreset.set({ custom: text });
      if (msg()) msg().textContent = `已保存（${extras.modelPreset.text().length} 字生效）`;
    });
    node.querySelector('#dt-redline-reset')?.addEventListener('click', () => {
      extras.modelPreset.set({ custom: '' });
      const area = node.querySelector('#dt-redline-text');
      if (area) area.value = extras.modelPreset.defaultText();
      if (msg()) msg().textContent = '已恢复内置红线';
    });
  }

  // ---------- 破限词模式（T-411）----------
  if (extras?.breakFilter) {
    const msg = () => node.querySelector('#dt-break-msg');
    node.querySelector('#dt-break-save')?.addEventListener('click', () => {
      const mode = node.querySelector('#dt-break-mode').value;
      const custom = node.querySelector('#dt-break-custom').value;
      const next = extras.breakFilter.set({ mode, custom });
      if (msg()) {
        msg().textContent = next.mode === 'off'
          ? '已保存：不注入任何破限词'
          : `已保存：模式 ${next.mode}；选中预设后才会真的注入`;
      }
    });
  }

  // ---------- 剧情占比（T-415）----------
  if (extras?.tone) {
    const boxes = () => [...node.querySelectorAll('input[data-dt-tone]')];
    boxes().forEach((box) => {
      box.addEventListener('change', () => {
        const next = extras.tone.set(box.dataset.dtTone, Number(box.value));
        // 联动配平：把另外两条的新值写回输入框（不重绘，免得丢焦点）
        for (const other of boxes()) other.value = Number(next?.[other.dataset.dtTone] ?? 0);
        const msg = node.querySelector('#dt-tone-msg');
        if (msg) msg.textContent = `日常 ${next.daily} / 危机 ${next.crisis} / 亲密 ${next.intimate}（合计 ${next.daily + next.crisis + next.intimate}）`;
      });
    });
  }

  // ---------- 主角（T-412）----------
  if (extras?.cast) {
    node.querySelector('#dt-cast-save')?.addEventListener('click', () => {
      const names = node.querySelector('#dt-cast-names').value
        .split(/[、,，\s]+/).map((name) => name.trim()).filter(Boolean);
      const list = extras.cast.set(names);
      const msg = node.querySelector('#dt-cast-msg');
      if (msg) {
        msg.textContent = list.length
          ? `已保存 ${list.length} 个主角：${list.map((item) => item.name).join('、')}`
          : '已清空：回到单卡老行为';
      }
    });
  }

  // ---------- 副本迁移（T-413）----------
  if (extras?.copy) {
    const msg = () => node.querySelector('#dt-copy-msg');
    node.querySelector('#dt-copy-export')?.addEventListener('click', () => {
      const area = node.querySelector('#dt-copy-area');
      if (area) area.value = JSON.stringify(extras.copy.export(), null, 2);
      if (msg()) msg().textContent = '已导出（不含端点与密钥）';
    });
    node.querySelector('#dt-copy-import')?.addEventListener('click', async () => {
      const area = node.querySelector('#dt-copy-area');
      try {
        const result = await extras.copy.import(JSON.parse(area?.value ?? '{}'));
        if (msg()) msg().textContent = result?.ok ? '已导入' : `失败：${result?.error ?? '未知'}`;
      } catch (error) {
        if (msg()) msg().textContent = `失败：${error?.message ?? '不是合法 JSON'}`;
      }
    });
  }

  return node;
}

export function createSettingsPanel({ store, onTest, onSave, profile, presets, automation, extras } = {}) {
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
    return renderSettingsForm({ container: node, store, onTest, onSave, onClose: hide, profile, presets, automation, extras });
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
