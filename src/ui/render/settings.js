// 导演时间 · 设置弹层（UI 定稿 §5）
//
// 控件（定稿 §2.1）：模式 #34 · 测试连接/刷新模型 #35 · 剧情占比滑块/数字/锁 #36~38 ·
// 导演强度 #39 · 意愿权重 #40 · 强制爱 #41 · 投机预生成 #42 · 硬禁区 #43 · 副本导出/导入 #44 ·
// 检查更新/更新插件 #45
//
// **不画的东西**（功能还没有，按定稿 §2.1 末尾「没实现就别画」）：
//   · 单价（元/千次）—— cost 只统计调用次数，没有金额
//   · 副本的「勾选剧本/设置/侧写」—— exportCopy 是整份导出，没有部分导出
//   · 楼层节奏 min/max、轮数上限、置信阈值、卡住阈值、世界书条数上限 ——
//     这些能配但定稿界面里没有位置，先留在控制台（已列进待办清单）

import { esc, seg, toggle, tokensOf, fmtNumber } from '../dom.js';

const INTENSITY_OPTIONS = [
  { value: 'restrained', label: '克制' },
  { value: 'standard', label: '标准' },
  { value: 'assertive', label: '强势' },
];

/** 意愿权重档位（T-405 规格：0~33 剧情优先 / 34~66 平衡 / 67~100 user 优先） */
function willTier(value) {
  const n = Number(value) || 0;
  if (n <= 33) return { label: '剧情优先', note: 'char 会按自己的计划推进，user 反对也未必让步' };
  if (n <= 66) return { label: '平衡', note: '看情况：反对得明确就让步，含糊就继续' };
  return { label: 'user 优先', note: '一有明确反对，char 立刻让步并重生成后续' };
}

export function render(state, ctxState) {
  const connection = state.connection ?? {};
  const models = state.models ?? [];
  const tone = state.tone ?? {};
  const toneKeys = state.toneKeys ?? [];
  const toneLabels = state.toneLabels ?? {};
  const lockedTones = state.toneLocked ?? [];
  const will = Number(state.will ?? 80);
  const automation = state.automation ?? {};
  const rules = state.rules ?? {};
  const params = state.params ?? {};
  const tier = willTier(will);
  const showKey = Boolean(ctxState?.showKey);
  const total = toneKeys.reduce((sum, key) => sum + Number(tone[key] ?? 0), 0);

  // 世界书状态行（定稿 §5.2：设置里只放一行状态 + 入口，完整界面在弹层里）
  const selection = state.world?.selection ?? {};
  const worldEntries = [];
  for (const source of (ctxState?.worldSources ?? state.world?.sources ?? [])) {
    for (const book of source.books ?? []) for (const entry of book.entries ?? []) worldEntries.push(entry);
  }
  const picked = worldEntries.filter((entry) => selection[entry.key]);
  const worldTokens = picked.reduce((sum, entry) => sum + tokensOf(entry.text ?? ''), 0);

  const toneRows = toneKeys.map((key, index) => {
    const locked = lockedTones.includes(key);
    return `<div class="dt-line">
      <span class="dt-k2">${esc(toneLabels[key] ?? key)}</span>
      <input class="tone" type="range" min="0" max="100" value="${Number(tone[key] ?? 0)}" data-act="tone.slide" data-key="${esc(key)}" data-index="${index}" aria-label="${esc(toneLabels[key] ?? key)}占比">
      <input class="dt-tone-num" type="number" min="0" max="100" value="${Number(tone[key] ?? 0)}" data-act="tone.number" data-key="${esc(key)}" aria-label="${esc(toneLabels[key] ?? key)}占比">
      <button class="dt-lockbtn${locked ? ' on' : ''}" type="button" data-act="tone.lock" data-key="${esc(key)}">${locked ? '已锁' : '锁'}</button>
    </div>`;
  }).join('');

  const body = `
    <details open>
      <summary>导演 API</summary>
      <div class="dt-box">
        <div class="dt-lbl" style="margin-top:0">模式</div>
        ${seg({
          name: 'dt-api', act: 'conn.setMode', value: connection.mode ?? 'independent',
          options: [{ value: 'independent', label: '独立 API' }, { value: 'main', label: '主连接' }],
        })}
        <div class="dt-lbl">端点</div><input type="text" data-act="conn.set" data-field="endpoint" value="${esc(connection.endpoint ?? '')}" placeholder="https://api.example.com/v1">
        <div class="dt-lbl">密钥</div>
        <div style="display:flex;gap:6px">
          <input type="${showKey ? 'text' : 'password'}" data-act="conn.set" data-field="apiKey" value="${esc(connection.apiKey ?? '')}" placeholder="sk-…">
          <button class="dt-mini" type="button" data-act="conn.showKey">${showKey ? '隐藏' : '显示'}</button>
        </div>
        <div class="dt-lbl">模型</div>
        ${models.length
    ? `<select data-act="conn.set" data-field="model">${models.map((name) => `<option value="${esc(name)}" ${name === connection.model ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`
    : `<input type="text" data-act="conn.set" data-field="model" value="${esc(connection.model ?? '')}" placeholder="模型名（点「刷新模型」拉列表）">`}
        <div style="display:flex;gap:6px;margin-top:9px">
          <button class="dt-btn" type="button" data-act="conn.test">测试连接</button>
          <button class="dt-btn" type="button" data-act="conn.models">刷新模型</button>
        </div>
        <div class="dt-note" data-flash="conn" hidden></div>
        <div class="dt-note">密钥明文存在本机 settings.json，共享环境慎用</div>
      </div>
    </details>

    <details>
      <summary>世界书</summary>
      <div class="dt-box">
        <div class="dt-line"><span style="flex:1">已选 ${picked.length} 条 · 约 ${fmtNumber(worldTokens)} tokens</span>
          <button class="dt-mini" type="button" data-act="settings.world">管理 ▸</button></div>
        <div class="dt-note">点「管理」打开世界书弹层：搜索、按书折叠、全选/全不选、勾选条目</div>
      </div>
    </details>

    <details>
      <summary>偏好</summary>
      <div class="dt-box">
        <div class="dt-lbl" style="margin-top:0">剧情占比（和恒为 100，可单锁）</div>
        ${toneRows || '<div class="dt-note">占比还没初始化</div>'}
        <div class="dt-note">锁住的线不参与配平；调一条，其余未锁的按比例分（和恒为 100）<br>
          <span style="color:var(--accent)">当前合计 ${total}%</span></div>

        <div class="dt-lbl">导演强度（只改注入语气，判定不受影响）</div>
        ${seg({ name: 'dt-intensity', act: 'intensity.set', value: state.intensity ?? 'standard', options: INTENSITY_OPTIONS })}
        <div class="dt-note" id="dt-intensity-hint">${esc(state.intensityHint ?? '')}</div>

        <div class="dt-lbl">意愿权重（越大 = user 越优先）</div>
        <div class="dt-line"><input type="range" min="0" max="100" value="${will}" data-act="will.slide" aria-label="意愿权重"><span class="dt-val">${will}</span></div>
        <div class="dt-note" data-will-note>${esc(tier.label)} · ${esc(tier.note)}</div>

        <div class="dt-toggle">
          <div>强制爱<br><span class="dt-note" style="margin:0">user 口头拒绝不再触发让步，char 继续推进</span></div>
          ${toggle({ act: 'will.setForceAffection', checked: Boolean(state.forceAffection) })}
        </div>
        <div class="dt-note">只覆盖「口头拒绝」：硬禁区、总开关、其它立场一律不覆盖。<br>它改的是剧情走向，改不了模型本身的安全策略。</div>

        <div class="dt-toggle">
          <div>投机预生成<br><span class="dt-note" style="margin:0">每轮多一次预判调用：命中才用得上针对性注入，失手就白花</span></div>
          ${toggle({ act: 'speculation.toggle', checked: state.speculation !== false })}
        </div>

        <div class="dt-lbl">档位（L0 全手动 / L1 待确认 / L2 全自动）</div>
        <div class="dt-pipe">
          ${(automation.features ?? []).map((feature) => `<div class="dt-pipe-row">
            <span style="flex:1">${esc(automation.featureLabels?.[feature] ?? feature)}</span>
            <select data-act="automation.set" data-feature="${esc(feature)}" style="width:auto">
              ${(automation.levelList ?? []).map((level) => `<option value="${esc(level)}" ${automation.levels?.[feature] === level ? 'selected' : ''}>${esc(level)}${automation.levelLabels?.[level] ? ` · ${esc(automation.levelLabels[level])}` : ''}</option>`).join('')}
            </select>
          </div>`).join('')}
        </div>
        <div class="dt-note">L1 = 结果先进「场记」的待确认队列，点「采用」才生效；L0 = 那一步完全不跑</div>
      </div>
    </details>

    <details>
      <summary>词库（规则引擎：判得准就不花钱调 API）</summary>
      <div class="dt-box">
        <div class="dt-note" style="margin-top:0">这些词用来在本地判 user 的态度 —— 判得准就<b>一次 API 都不发</b>。<br>
          一行一条；强词 / 弱词可以写「<b>词 = 立场</b>」（接受 / 拒绝 / 犹豫 / 转向，也可以写 accept / reject / hesitate / redirect）。<br>
          <b>清空某一本 = 这一类不判，老实交给 LLM</b>（不会硬猜）。</div>
        ${(rules.keys ?? []).map((key) => `<div class="dt-lbl">${esc(rules.labels?.[key] ?? key)}</div>
          <textarea rows="3" data-act="rules.save" data-key="${esc(key)}" placeholder="一行一条">${esc(rules.texts?.[key] ?? '')}</textarea>`).join('')}
        <div class="dt-actions">
          <button class="dt-btn" type="button" data-act="rules.saveAll">保存词库</button>
          <button class="dt-btn" type="button" data-act="rules.reset">恢复默认词库</button>
        </div>
        <div class="dt-note" data-flash="rules" hidden></div>
      </div>
    </details>

    <details>
      <summary>调参（默认值就能用，不懂别动）</summary>
      <div class="dt-box">
        <div class="dt-lbl" style="margin-top:0">每场楼层（min ~ max）</div>
        <div class="dt-line">
          <input class="dt-tone-num" type="number" min="1" max="20" data-act="params.save" data-field="pacing.min" value="${Number(params.pacing?.min ?? 3)}" aria-label="每场最少楼层">
          <span style="opacity:.6">~</span>
          <input class="dt-tone-num" type="number" min="1" max="30" data-act="params.save" data-field="pacing.max" value="${Number(params.pacing?.max ?? 8)}" aria-label="每场最多楼层">
        </div>
        <div class="dt-note">一场戏最少演几楼才允许切场；聊满 max 楼无论如何强制换场</div>

        <div class="dt-lbl">轮数上限</div>
        <input class="dt-tone-num" type="number" min="1" max="200" data-act="params.save" data-field="maxRounds" value="${Number(params.maxRounds ?? 15)}" aria-label="轮数上限">
        <div class="dt-note">跑满这么多轮就提示并清空剧本（默认 15）</div>

        <div class="dt-lbl">置信阈值</div>
        <input class="dt-tone-num" type="number" min="0" max="1" step="0.05" data-act="params.save" data-field="confidenceThreshold" value="${Number(params.confidenceThreshold ?? 0.7)}" aria-label="置信阈值">
        <div class="dt-note">判定把握低于它一律按"接受"放行 —— <b>调高会更严，也更容易卡住</b>（默认 0.7）</div>

        <div class="dt-lbl">卡住阈值</div>
        <input class="dt-tone-num" type="number" min="1" max="10" data-act="params.save" data-field="stuckThreshold" value="${Number(params.stuckThreshold ?? 3)}" aria-label="卡住阈值">
        <div class="dt-note">连续几轮没推进就强制跳场（默认 3，防死锁）</div>

        <div class="dt-lbl">世界书条数上限</div>
        <input class="dt-tone-num" type="number" min="1" max="200" data-act="params.save" data-field="worldLimit" value="${Number(params.worldLimit ?? 20)}" aria-label="世界书条数上限">
        <div class="dt-note">勾选再多也只把最相关的这么多条进 prompt（默认 20）</div>

        <div class="dt-toggle">
          <div>生成后一致性自检<br><span class="dt-note" style="margin:0">写完剧本再花一次调用检查前后矛盾；关掉省一次调用</span></div>
          ${toggle({ act: 'params.toggleConsistency', checked: params.consistencyCheck !== false })}
        </div>
        <div class="dt-note" data-flash="params" hidden></div>
      </div>
    </details>

    <details>
      <summary>安全（硬禁区）</summary>
      <div class="dt-box">
        <div class="dt-lbl" style="margin-top:0">命中即停：清空注入、本轮终止，硬禁区优先于一切</div>
        <textarea rows="2" data-act="hardLimits.set" placeholder="一行一条">${esc((state.hardLimits ?? []).join('\n'))}</textarea>
        <div class="dt-note">优先级高于人物侧写的「禁忌」字段</div>
      </div>
    </details>

    <details>
      <summary>副本迁移</summary>
      <div class="dt-box">
        <div style="display:flex;gap:6px">
          <button class="dt-btn" type="button" data-act="copy.export">导出为 JSON</button>
          <button class="dt-btn" type="button" data-act="copy.import">导入</button>
        </div>
        <input type="file" accept="application/json,.json" data-act="copy.file" hidden>
        <div class="dt-note" data-flash="copy" hidden></div>
        <div class="dt-note">导出的是整份副本（剧本 + 设置 + 侧写）；<b>端点与密钥不进副本</b></div>
      </div>
    </details>`;

  return {
    html: `
    <div class="dt-layer" data-layer="settings">
      <div class="dt-layer-head">
        <button class="dt-back" type="button" data-act="layer.back">${'<svg viewBox="0 0 24 24"><path d="M15.4 4.6 8 12l7.4 7.4 1.4-1.4L10.8 12l6-6-1.4-1.4z"/></svg>'}返回</button>
        <strong class="dt-layer-title">设置</strong><span class="spacer"></span>
        <button class="dt-icon" type="button" data-act="layer.close" title="关闭" aria-label="关闭"><svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 12 12 5.7 5.7 7.1 4.3 13.4 10.6 12 12l1.4 1.4 6.3 6.3-1.4 1.4z"/></svg></button>
      </div>
      <div class="dt-layer-body">${body}</div>
      <div class="dt-layer-foot"><span>v${esc(state.version ?? '—')}</span><span class="spacer"></span>
        <button class="dt-mini" type="button" data-act="update.check">检查更新</button>
        <button class="dt-mini" type="button" data-act="update.apply">更新插件</button>
        <span data-flash="update" hidden></span>
      </div>
    </div>`,
    actions: {
      'settings.world': (el, { ctx }) => { ctx.openLayer('world'); },
      // 批复 §二-1：档位（六个功能点各自 L0/L1/L2）
      'automation.set': (el, { api, ctx }) => {
        api.automation?.set?.(el.dataset.feature, el.value);
        ctx.flash('params', `档位已改：${el.dataset.feature} → ${el.value}（Debug 的「档位」行同步）`);
        ctx.refresh();
      },
      // 批复 §二-2：词库（改完立刻生效；清空某一本 = 这一类转 LLM）
      'rules.save': (el, { api, ctx }) => {
        const result = api.saveRules?.(el.dataset.key, el.value);
        ctx.flash('rules', result?.dropped?.length
          ? `已保存 ${result.count} 条；有 ${result.dropped.length} 条立场认不出，已跳过（${result.dropped.join('、')}）`
          : `已保存 ${result?.count ?? 0} 条（这一本改完立刻生效）`);
      },
      'rules.saveAll': (el, { api, ctx }) => {
        const boxes = [...(ctx.root()?.querySelectorAll('[data-act="rules.save"]') ?? [])];
        let saved = 0;
        const droppedAll = [];
        for (const box of boxes) {
          const result = api.saveRules?.(box.dataset.key, box.value);
          saved += result?.count ?? 0;
          droppedAll.push(...(result?.dropped ?? []));
        }
        ctx.flash('rules', droppedAll.length
          ? `已保存 ${saved} 条；有 ${droppedAll.length} 条立场认不出，已跳过（${droppedAll.join('、')}）`
          : `已保存 ${saved} 条（四本词库都生效了）`);
      },
      'rules.reset': (el, { api, ctx }) => {
        api.resetRules?.();
        ctx.flash('rules', '已恢复默认词库');
        ctx.refresh();
      },
      // 批复 §二-3：六个数字参数 + 一致性自检开关
      'params.save': (el, { api, ctx, state }) => {
        const field = el.dataset.field ?? '';
        const value = Number(el.value);
        if (field.startsWith('pacing.')) {
          const key = field.split('.')[1];
          api.saveSettings?.({ pacing: { ...(state.params?.pacing ?? {}), [key]: value } });
        } else {
          api.saveSettings?.({ [field]: value });
        }
        ctx.flash('params', `已保存：${field} = ${value}`);
      },
      'params.toggleConsistency': (el, { api, ctx }) => {
        api.saveSettings?.({ consistencyCheck: Boolean(el.checked) });
        ctx.flash('params', el.checked ? '一致性自检已开（生成后会多一次调用）' : '一致性自检已关（省一次调用）');
        ctx.refresh();
      },
      'conn.setMode': (el, { api, ctx, state }) => {
        api.saveSettings?.({ connection: { ...(state.connection ?? {}), mode: el.value } });
        ctx.flashGlobal(el.value === 'main' ? '已切到主连接' : '已切到独立 API');
        ctx.refresh();
      },
      'conn.set': (el, { api, ctx, state }) => {
        const field = el.dataset.field;
        api.saveSettings?.({ connection: { ...(state.connection ?? {}), [field]: el.value } });
        ctx.flash('conn', `已保存${field === 'apiKey' ? '密钥' : field === 'model' ? '模型' : '端点'}`);
      },
      'conn.showKey': (el, { ctx }) => {
        ctx.setState({ showKey: !ctx.getState().showKey });
        ctx.refresh();
      },
      'conn.test': async (el, { api, ctx }) => {
        ctx.flash('conn', '测试中…');
        const result = await api.onTest?.();
        ctx.flash('conn', result?.ok
          ? `连接成功${result.model ? ` · ${result.model} 可用` : ''}${result.latency ? `（${result.latency}）` : ''}`
          : `连接失败：${result?.reason ?? result?.error ?? '原因不明'} → 检查端点 / 密钥 / 模型名`);
      },
      'conn.models': async (el, { api, ctx, state }) => {
        ctx.flash('conn', '正在拉取模型列表…');
        try {
          const list = await api.client?.listModels?.(state.connection ?? {});
          ctx.setModels(Array.isArray(list) ? list : []);
          ctx.flash('conn', Array.isArray(list) && list.length ? `已拉取 ${list.length} 个模型` : '没拉到模型列表（接口不返回 / 需要密钥）');
        } catch (error) {
          ctx.flash('conn', `拉取失败：${error?.message ?? '原因不明'}`);
        }
        ctx.refresh();
      },
      'tone.slide': (el, { api, ctx, state }) => {
        api.tone?.set?.(el.dataset.key, Number(el.value), state.toneLocked ?? []);
        ctx.refresh();
      },
      'tone.number': (el, { api, ctx, state }) => {
        api.tone?.set?.(el.dataset.key, Number(el.value), state.toneLocked ?? []);
        ctx.refresh();
      },
      'tone.lock': (el, { api, ctx, state }) => {
        const key = el.dataset.key;
        const locked = new Set(state.toneLocked ?? []);
        if (locked.has(key)) locked.delete(key); else locked.add(key);
        api.tone?.set?.(key, Number(state.tone?.[key] ?? 0), [...locked]);
        ctx.refresh();
      },
      'intensity.set': (el, { api, ctx }) => {
        api.intensity?.set?.(el.value);
        ctx.flashGlobal(`导演强度：${INTENSITY_OPTIONS.find((item) => item.value === el.value)?.label ?? el.value}（下一轮注入立刻生效）`);
        ctx.refresh();
      },
      'will.slide': (el, { api, ctx }) => {
        api.saveSettings?.({ will: Number(el.value) });
        ctx.refresh();
      },
      'will.setForceAffection': (el, { api, ctx }) => {
        api.saveSettings?.({ forceAffection: Boolean(el.checked) });
        ctx.flashGlobal(el.checked ? '强制爱已开：口头拒绝不再让步' : '强制爱已关');
        ctx.refresh();
      },
      'speculation.toggle': (el, { api, ctx }) => {
        api.speculate?.setEnabled?.(el.checked);
        ctx.flashGlobal(el.checked ? '投机预生成已开（每轮多一次预判调用）' : '投机预生成已关：不再发投机调用');
        ctx.refresh();
      },
      'hardLimits.set': (el, { api, ctx }) => {
        const hardLimits = String(el.value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
        api.saveSettings?.({ hardLimits });
        ctx.flashGlobal(`已保存 ${hardLimits.length} 条硬禁区（命中即停）`);
      },
      'copy.export': (el, { api, ctx }) => {
        const copy = api.copy?.export?.();
        try {
          const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'director-time-副本.json';
          link.click();
          URL.revokeObjectURL(url);
          ctx.flash('copy', '已导出 director-time-副本.json（端点/密钥不进副本）');
        } catch (error) {
          ctx.flash('copy', `导出失败：${error?.message ?? '原因不明'}`);
        }
      },
      'copy.import': (el, { ctx }) => {
        ctx.root()?.querySelector('[data-act="copy.file"]')?.click();
      },
      'copy.file': async (el, { api, ctx }) => {
        const file = el.files?.[0];
        if (!file) return;
        try {
          const copy = JSON.parse(await file.text());
          const preview = api.copy?.preview?.(copy);
          if (!preview?.ok) {
            ctx.flash('copy', `这份副本有问题：${preview?.reason ?? '格式不对'}，没有导入`);
            return;
          }
          const ok = typeof confirm === 'function'
            ? confirm(`将导入：剧本 ${preview.stages ?? 0} 场、侧写 ${preview.hasProfile ? '有' : '无'}、设置若干。\n当前内容会被覆盖，确定吗？`)
            : true;
          if (!ok) { ctx.flash('copy', '已取消导入'); return; }
          await api.copy?.import?.(copy);
          ctx.flash('copy', '导入完成（端点与密钥没动）');
          ctx.refresh();
        } catch (error) {
          ctx.flash('copy', `导入失败：${error?.message ?? '不是合法的 JSON'}`);
        }
      },
      'update.check': async (el, { api, ctx }) => {
        ctx.flash('update', '检查中…', true);
        const result = await api.checkUpdate?.();
        ctx.flash('update', result?.action === 'reload'
          ? '有新版本，正在刷新页面…'
          : (result?.action === 'prompt' ? `有新版本（${result.version ?? ''}）→ 点「更新插件」` : '已是最新版'), true);
      },
      'update.apply': async (el, { api, ctx }) => {
        ctx.flash('update', '更新中…', true);
        const result = await api.update?.apply?.();
        ctx.flash('update', result?.message ?? '更新失败，请到酒馆「扩展」面板手动更新', true);
      },
    },
  };
}
