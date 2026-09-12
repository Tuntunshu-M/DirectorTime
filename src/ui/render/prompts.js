// 导演时间 · 提示词 / 预设 / 清洗弹层（UI 定稿 §5.7）
//
// 控件（定稿 §2.1）：预设下拉 #24 · 预设条目勾选 #25 · 刷新列表 #26 ·
// 破限词四模式 #27 · 模型特化三选一 #28 · 恢复内置 #29 · 输出清洗 #32 · 恢复内置（清洗）#33
//
// **不画的东西**（功能还没实现，按定稿 §2.1 末尾的要求不许画）：
//   槽位管线的拖动排序 / 槽位开关 / 「查看最终拼装结果」——
//   registry 只提供"当前注册了什么"，没有多槽位排序与开关，等实现了再画（已列进待办清单）。

import { esc, layerShell, seg, toggle, tokensOf, fmtNumber } from '../dom.js';

const BREAK_MODES = [
  { value: 'off', label: '关闭' },
  { value: 'preset', label: '跟随预设' },
  { value: 'custom', label: '自定义' },
  { value: 'append', label: '追加' },
];

const PRESET_KINDS = [
  { value: 'off', label: '关闭' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' },
];

export function render(state, ctxState) {
  const presets = state.presets ?? { list: [], status: {}, entries: [] };
  const status = presets.status ?? {};
  const entries = presets.entries ?? [];
  const filter = state.breakFilter ?? { mode: 'off', custom: '' };
  const modelPreset = state.modelPreset ?? { kind: 'off', text: '' };
  const sanitize = state.sanitize ?? { enabled: true, rules: [] };
  const customRules = (sanitize.rules ?? []).map((rule) => rule.pattern ?? rule).join('\n');
  const needsCustom = filter.mode === 'custom' || filter.mode === 'append';

  const presetName = status.name ?? '';
  const selectedCount = entries.filter((entry) => entry.selected).length;

  const body = `
    <details open>
      <summary>破限预设（跟随酒馆内预设，只读）</summary>
      <div class="dt-box">
        <div class="dt-lbl" style="margin-top:0">选择预设</div>
        <select data-act="presets.select">
          <option value="" ${presetName ? '' : 'selected'}>（不使用）</option>
          ${(presets.list ?? []).map((name) => `<option value="${esc(name)}" ${name === presetName ? 'selected' : ''}>${esc(name)}</option>`).join('')}
        </select>
        ${presetName ? `
          <div class="dt-lbl">只注入勾选的条目（一个不勾 = 全部启用条目）</div>
          <div class="dt-pipe">
            ${entries.map((entry) => `<div class="dt-pipe-row">
              <input class="chk" type="checkbox" data-act="presets.entry" data-index="${esc(entry.index)}" ${entry.selected ? 'checked' : ''} ${entry.enabled === false ? 'disabled' : ''}>
              <span>${esc(entry.label ?? entry.name ?? `条目 ${entry.index}`)}${entry.enabled === false ? ' <em style="font-style:normal;color:var(--faded)">（酒馆里已禁用）</em>' : ''}</span>
            </div>`).join('') || '<div class="dt-pipe-row"><span>这个预设读不到条目</span></div>'}
          </div>
          <div class="dt-note">已选 ${selectedCount} 条 · 注入 ${fmtNumber(status.length ?? 0)} 字${status.active ? '' : ' · 读不到内容，等于没注入'}</div>
        ` : '<div class="dt-note">选「不使用」→ 不注入任何额外内容</div>'}
        <button class="dt-mini" style="margin-top:6px" type="button" data-act="presets.refresh">刷新列表</button>
      </div>
    </details>

    <details>
      <summary>破限词模式</summary>
      <div class="dt-box">
        ${seg({ name: 'dt-break', act: 'break.setMode', value: filter.mode, options: BREAK_MODES })}
        <div class="dt-lbl">自定义破限词（自定义 / 追加 模式时用）</div>
        <textarea rows="2" data-act="break.setCustom" ${needsCustom ? '' : 'disabled'} placeholder="一行一段，追加在导演请求最前面">${esc(filter.custom ?? '')}</textarea>
        <div class="dt-note">只作用于导演 API 请求，角色回复端不注入（那端由酒馆自己的预设管）</div>
      </div>
    </details>

    <details>
      <summary>模型特化预设（三选一，不能同时开）</summary>
      <div class="dt-box">
        ${seg({ name: 'dt-mp', act: 'modelPreset.setKind', value: modelPreset.kind, options: PRESET_KINDS })}
        <div class="dt-lbl">自定义文本（改一套不串另一套）</div>
        <textarea rows="3" data-act="modelPreset.setCustom" ${modelPreset.kind === 'off' ? 'disabled' : ''}>${esc(modelPreset.text ?? '')}</textarea>
        <div class="dt-note">Gemini：收敛极端控制倾向；Claude：推主动性与情感表达。<br>
          两套方向相反，所以是三选一；<b>只注入导演请求</b>（限剧本生成），角色回复端不注入。</div>
        <button class="dt-mini" id="mp-reset" type="button" data-act="modelPreset.reset">恢复内置</button>
      </div>
    </details>

    <details>
      <summary>输出清洗</summary>
      <div class="dt-box">
        <div class="dt-toggle"><div>内置规则（&lt;thinking&gt; / &lt;think&gt; 思考块）</div>
          ${toggle({ act: 'sanitize.toggle', checked: sanitize.enabled !== false })}</div>
        <div class="dt-lbl">自定义清洗规则（正则，一行一条）</div>
        <textarea rows="2" data-act="sanitize.setRules" placeholder="^（内心独白）.+$">${esc(customRules)}</textarea>
        <div class="dt-note">只清洗插件自己看到的文本（判定输入 / 调试显示），聊天记录原文永远不动</div>
      </div>
    </details>`;

  return {
    html: layerShell({
      layer: 'prompt',
      title: '提示词 · 预设 · 清洗',
      backLabel: ctxState?.backTo ? `返回${ctxState.backTo}` : '返回',
      body,
      foot: `<span class="spacer"></span>
        <button class="dt-mini" type="button" data-act="sanitize.reset">恢复内置</button>
        <button class="dt-mini" type="button" data-act="layer.close">完成</button>`,
    }),
    actions: {
      'presets.select': (el, { api, ctx }) => {
        if (el.value) api.presets?.select?.(el.value);
        else api.presets?.clear?.();
        ctx.flashGlobal(el.value ? `已选预设「${el.value}」` : '已改为不使用预设');
        ctx.refresh();
      },
      'presets.entry': (el, { api, ctx, state }) => {
        const entries = state.presets?.entries ?? [];
        const indices = entries
          .filter((entry) => (entry.index === Number(el.dataset.index) ? el.checked : entry.selected))
          .map((entry) => entry.index);
        api.presets?.selectEntries?.(indices);
        ctx.refresh();
      },
      'presets.refresh': async (el, { api, ctx }) => {
        ctx.busyGlobal('重新读取酒馆预设…');
        await api.presets?.list?.();
        ctx.flashGlobal('已重新读取预设列表（只读，不写回酒馆）');
        ctx.refresh();
      },
      'break.setMode': (el, { api, ctx }) => {
        api.breakFilter?.set?.({ mode: el.value });
        ctx.flashGlobal(`破限词模式：${BREAK_MODES.find((item) => item.value === el.value)?.label ?? el.value}`);
        ctx.refresh();
      },
      'break.setCustom': (el, { api, ctx }) => {
        api.breakFilter?.set?.({ custom: el.value });
        ctx.flashGlobal(`已保存自定义破限词（${String(el.value).length} 字）`);
      },
      'modelPreset.setKind': (el, { api, ctx }) => {
        api.modelPreset?.set?.({ kind: el.value });
        ctx.flashGlobal(`模型特化预设：${PRESET_KINDS.find((item) => item.value === el.value)?.label ?? el.value}`);
        ctx.refresh();
      },
      'modelPreset.setCustom': (el, { api, ctx }) => {
        api.modelPreset?.set?.({ custom: el.value });
        ctx.flashGlobal(`已保存这一套的文本（${String(el.value).length} 字）`);
      },
      'modelPreset.reset': (el, { api, ctx }) => {
        api.modelPreset?.reset?.();
        ctx.flashGlobal('已恢复当前这一套的内置文本');
        ctx.refresh();
      },
      'sanitize.toggle': (el, { api, ctx }) => {
        api.sanitize?.set?.({ enabled: el.checked });
        ctx.flashGlobal(el.checked ? '已启用清洗' : '已关闭清洗：判定会看到原文（thinking 也在）');
        ctx.refresh();
      },
      'sanitize.setRules': (el, { api, ctx }) => {
        const rules = String(el.value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
        api.sanitize?.set?.({ rules });
        ctx.flashGlobal(`已保存 ${rules.length} 条自定义清洗规则（内置两条仍在）`);
        ctx.refresh();
      },
      'sanitize.reset': (el, { api, ctx }) => {
        api.sanitize?.reset?.();
        ctx.flashGlobal('已清空自定义清洗规则（内置两条仍在）');
        ctx.refresh();
      },
    },
  };
}

export { tokensOf };
