// 导演时间 · 主面板
//
// 修 bug：菜单栏入口点进来看到的应该是主页面，而不是 API 配置。
// 主页面 = 总开关 + 运行状态（数据复用 debug.js 的纯函数）；导演 API 配置收进右上角「配置」。
//
// 尺寸 / 定位跟随酒馆页面：样式在 style.css 的 #dt-panel（fixed + 100dvh + calc 限宽限高），
// 与旧仓库 just-do-it-char 的 .stpd-overlay / .stpd-modal 同一套做法 ——
// 手机、缩小的小窗口都不会超出视口，头部（含总开关与关闭按钮）永远可见，内容在内部滚动。
//
// G4：本文件只做结构与交互，不做视觉美化（无斜纹 / 旋转 / 印章 / 装饰纹理）。

import { buildDebugState } from './debug.js';
import { renderSettingsForm } from './settings.js';

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function row(label, value) {
  return `<div><span style="opacity:.6">${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
}

// 剧本编辑页复用（T-404）：只求能用，不美化（G4）
const EDIT_BTN = 'font:inherit;padding:3px 9px;cursor:pointer';
const EDIT_FIELD = 'width:100%;box-sizing:border-box;margin:3px 0 8px;padding:4px 6px;font:inherit;'
  + 'background:rgba(255,255,255,.4);color:inherit;border:1px solid var(--dt-rule,rgba(43,39,33,.3));border-radius:3px';

export function createMainPanel({
  store,
  registry,
  onTest,
  onSave,
  onGenerate,
  onExtend,
  profile,
  // T-418：破限预设（只读酒馆预设）
  presets,
  // T-414：档位设置 + 待审核队列
  automation,
  queue,
  // T-420：一键更新
  update,
  // T-404：剧本编辑器（增删改 / 排序 / 锁定 / 快照）
  editor,
  // T-408：伏笔销账入口
  foreshadows,
  // T-404：从当前阶段往后截断重生成
  onTruncateRegen,
  // 配置页里那几个折叠区（T-403 红线 / 破限词模式 / 剧情占比 / 主角 / 副本）
  extras,
  loadWorldSources,
  getWorldSelection,
  saveWorldSelection,
  getWorldText,
  getEnabled,
  onToggleEnabled,
  onOpenDebug,
  getCapabilities,
  getLast,
} = {}) {
  let el = null;
  let escapeHandler = null;
  let view = 'status';
  let worldSources = null;
  let worldKeyword = '';
  let worldLoading = false;
  // T-404：快照文本框的内容存在这里 —— 面板每次重绘都会重建 DOM，
  // 只放在 textarea 里的话，点一下 ↑↓ 就没了（用户实测反馈：切出去就丢）
  let snapshotDraft = '';

  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'dt-panel';
    el.innerHTML = `
      <section class="dt-card" role="dialog" aria-modal="true" aria-label="导演时间">
        <header class="dt-head">
          <strong class="dt-title" id="dt-panel-title">导演时间</strong>
          <label class="dt-switch" title="导演时间总开关">
            <input type="checkbox" id="dt-panel-enabled"> 总开关
          </label>
          <button class="dt-btn" id="dt-panel-editor" type="button" title="剧本编辑器（T-404）">剧本</button>
          <button class="dt-btn" id="dt-panel-world" type="button" title="世界书接入">世界书</button>
          <button class="dt-btn" id="dt-panel-config" type="button" title="导演 API 配置">配置</button>
          <button class="dt-btn" id="dt-panel-close" type="button" aria-label="关闭导演时间" title="关闭">✕</button>
        </header>
        <div class="dt-body" id="dt-panel-body"></div>
      </section>
    `;
    document.body.appendChild(el);

    el.querySelector('#dt-panel-close').addEventListener('click', close);
    el.querySelector('#dt-panel-config').addEventListener('click', () => setView(view === 'config' ? 'status' : 'config'));
    el.querySelector('#dt-panel-world').addEventListener('click', () => setView(view === 'world' ? 'status' : 'world'));
    el.querySelector('#dt-panel-editor').addEventListener('click', () => setView(view === 'editor' ? 'status' : 'editor'));
    el.querySelector('#dt-panel-enabled').addEventListener('change', (event) => {
      onToggleEnabled?.(event.target.checked);
      render();
    });
    // 点遮罩关闭；点卡片内部不关
    el.addEventListener('click', (event) => {
      if (event.target === el) close();
    });

    escapeHandler = (event) => {
      if (event.key === 'Escape' && isOpen()) close();
    };
    document.addEventListener('keydown', escapeHandler);
    return el;
  }

  function isOpen() {
    return Boolean(el?.classList.contains('dt-open'));
  }

  function renderStatus(body) {
    const status = buildDebugState({
      store,
      registry,
      last: getLast?.() ?? null,
      capabilities: getCapabilities?.() ?? null,
      lastTurn: getLast?.() ?? null,
    });
    const noStage = status.stage.total === 0;
    const enabled = Boolean(getEnabled?.());
    const connection = store?.getSettings?.().connection ?? {};
    const tip = enabled
      ? (connection.endpoint ? '' : `
        <div style="margin-top:10px;opacity:.75">
          还没配置导演 API → 点右上角「配置」填写端点 / 密钥 / 模型
        </div>
      `)
      : '<div style="margin-top:10px;opacity:.75">总开关没开，导演时间处于停用状态</div>';

    // T-414：L1 档位的产物都在这儿等着 —— 没有这块，生成的剧本就没法启用
    const pending = queue?.list?.() ?? [];
    const pendingBlock = pending.length ? `
      <div style="margin-top:10px">
        <div style="opacity:.6;margin-bottom:4px">待确认 ${pending.length} 条（档位 L1，确认后才生效）</div>
        ${pending.map((entry) => `
          <div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:4px">
            <div style="flex:1">${escapeHtml(entry.summary || entry.feature)} <span style="opacity:.6">[${escapeHtml(entry.feature)}]</span></div>
            <button data-dt-approve="${escapeHtml(entry.id)}" type="button" style="font:inherit;padding:2px 8px;cursor:pointer">采用</button>
            <button data-dt-reject="${escapeHtml(entry.id)}" type="button" style="font:inherit;padding:2px 8px;cursor:pointer">丢弃</button>
          </div>`).join('')}
      </div>` : '';

    body.innerHTML = `
      <div style="opacity:.6;margin-bottom:4px">运行状态</div>
      ${row('阶段', noStage ? '还没有剧本' : `${status.stage.index}/${status.stage.total} ${status.stage.title}`)}
      ${row('目标', status.stage.goal || '—')}
      ${row('状态', `${status.stage.status} · 卡住 ${status.stage.stuckCount} 轮`)}
      ${row('注入', status.injection.registered ? `已注册 · ${status.injection.length} 字` : '未注册')}
      ${row('上次动作', status.lastAction ? `${status.lastAction}（${status.lastReason ?? ''}）` : '—')}
      ${row('累计', `调用 ${status.cost.callCount} 次`)}
      ${update ? row('版本', `v${update.version?.() || '—'}`) : ''}
      ${tip}
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
        ${enabled ? `<button id="dt-panel-generate" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">${noStage ? '生成剧本' : '重新生成剧本'}</button>` : ''}
        ${enabled && !noStage ? '<button id="dt-panel-extend" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">重新续写</button>' : ''}
        <button id="dt-panel-debug" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">打开调试面板</button>
        ${update ? '<button id="dt-panel-check" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">检查更新</button>' : ''}
        ${update ? '<button id="dt-panel-update" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">更新插件</button>' : ''}
      </div>
      <div id="dt-update-msg" style="margin-top:6px;opacity:.75"></div>
      ${pendingBlock}
    `;

    // T-420 追加（用户反馈 13）：先真查有没有新版本，结果写在面板上（不是控制台）
    body.querySelector('#dt-panel-check')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const msg = body.querySelector('#dt-update-msg');
      button.disabled = true;
      button.textContent = '查询中…';
      if (msg) msg.textContent = '正在对比本地与远程版本…';
      try {
        const result = await update.check?.();
        if (msg) msg.textContent = result?.message ?? '查不到结果';
        if (result?.ok && result.hasUpdate) {
          const updateButton = body.querySelector('#dt-panel-update');
          if (updateButton) updateButton.textContent = `更新到 v${result.remote}`;
        }
      } catch (error) {
        if (msg) msg.textContent = `检查更新失败：${error?.message ?? error}`;
      } finally {
        button.disabled = false;
        button.textContent = '检查更新';
      }
    });

    // T-420：一键更新 —— 成功就自动刷新；失败**不刷新**，给一句能照做的话
    body.querySelector('#dt-panel-update')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const msg = body.querySelector('#dt-update-msg');
      button.disabled = true;
      button.textContent = '更新中…';
      if (msg) msg.textContent = '正在让酒馆拉取最新版本…';
      try {
        const result = await update.apply?.();
        if (msg) msg.textContent = result?.message ?? '';
        if (result && result.ok === false) console.warn('[导演时间] 一键更新失败', result);
      } catch (error) {
        if (msg) msg.textContent = '更新出错，请到酒馆的「扩展」面板手动点更新';
        console.warn('[导演时间] 一键更新异常', error);
      } finally {
        button.disabled = false;
        button.textContent = '更新插件';
      }
    });

    // 待确认：采用 = 让判别结果真正生效（T-414 L1）
    body.querySelectorAll('[data-dt-approve]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = '处理中…';
        const result = await queue.approve?.(button.dataset.dtApprove);
        if (result && result.ok === false) console.warn('[导演时间] 采用失败：', result.error);
        render();
      });
    });
    body.querySelectorAll('[data-dt-reject]').forEach((button) => {
      button.addEventListener('click', () => {
        queue.reject?.(button.dataset.dtReject);
        render();
      });
    });

    function wireBusy(selector, action) {
      body.querySelector(selector)?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = '处理中…';
        try {
          await action?.();
        } finally {
          render();
        }
      });
    }
    wireBusy('#dt-panel-generate', onGenerate);
    wireBusy('#dt-panel-extend', onExtend);
    body.querySelector('#dt-panel-debug')?.addEventListener('click', () => onOpenDebug?.());
  }

  async function loadWorld(force) {
    worldLoading = true;
    render();
    try {
      worldSources = (await loadWorldSources?.(force)) ?? [];
    } catch (error) {
      console.warn('[导演时间] 世界书加载失败', error);
      worldSources = [];
    } finally {
      worldLoading = false;
      render();
    }
  }

  async function refreshWorldPreview(body) {
    const pre = body.querySelector('#dt-world-preview');
    if (!pre || !getWorldText) return;
    try {
      pre.textContent = (await getWorldText()) || '（没有勾选任何条目）';
    } catch (error) {
      pre.textContent = `预览失败：${error?.message ?? error}`;
    }
  }

  /** 世界书页：来源树 + 勾选 + 搜索 + 实际发送文本预览（T-401） */
  function renderWorld(body) {
    const selection = getWorldSelection?.() ?? {};
    const limit = store?.getSettings?.().worldLimit ?? 20;
    const keyword = worldKeyword.trim().toLowerCase();
    const statText = () => `已选 ${Object.keys(getWorldSelection?.() ?? {}).length} 条 · 上限 ${limit} 条`;

    // 当前可见（搜索过滤后）的条目 key —— 全选/全不选只作用于看得见的这些
    const visibleKeys = [];

    const list = (worldSources ?? []).map((source) => {
      const books = (source.books ?? []).map((book) => {
        const all = book.entries ?? [];
        const entries = all.filter((entry) => !keyword
          || book.name.toLowerCase().includes(keyword)
          || entry.name.toLowerCase().includes(keyword)
          || entry.content.toLowerCase().includes(keyword));
        if (!entries.length && !book.error) return '';
        for (const entry of entries) visibleKeys.push(entry.key);

        // 书名做成可折叠的标题（用户反馈 2：条目太多，一个个翻太累）
        // 勾选框在 summary 里 —— stopPropagation，免得点复选框连带折叠
        const head = `<summary style="cursor:pointer;opacity:.8">
            <label style="cursor:pointer"><input type="checkbox" data-world-book="${escapeHtml(book.name)}" ${all.length && all.every((entry) => selection[entry.key]) ? 'checked' : ''}> ${escapeHtml(book.name)}${book.error ? `（${escapeHtml(book.error)}）` : `　${all.length} 条`}</label>
          </summary>`;
        const items = entries.map((entry) => `
          <label style="display:block;margin-left:14px">
            <input type="checkbox" data-world-key="${escapeHtml(entry.key)}" ${selection[entry.key] ? 'checked' : ''}> ${escapeHtml(entry.name)}${entry.enabled ? '' : '<span style="opacity:.6">（禁用）</span>'}${entry.constant ? '<span style="opacity:.6">（常驻）</span>' : ''}
          </label>`).join('');
        return `<details style="margin:4px 0">${head}${items || '<div style="opacity:.6;margin-left:14px">（没有条目）</div>'}</details>`;
      }).join('');
      if (!books) return '';
      return `<div style="margin-bottom:6px"><div style="opacity:.6">${escapeHtml(source.label)}</div>${books}</div>`;
    }).join('');

    const placeholder = worldLoading
      ? '<div style="opacity:.7">加载中…</div>'
      : (worldSources
        ? (list || '<div style="opacity:.7">（没有可勾选的条目）</div>')
        : '<div style="opacity:.7">点「刷新」加载世界书</div>');

    body.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input id="dt-world-search" style="flex:1;box-sizing:border-box;padding:4px 6px;font:inherit" placeholder="搜索书名或条目" value="${escapeHtml(worldKeyword)}">
        <button id="dt-world-select-all" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">全选</button>
        <button id="dt-world-select-none" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">全不选</button>
        <button id="dt-world-reload" type="button" style="font:inherit;padding:4px 10px;cursor:pointer">刷新</button>
      </div>
      <div id="dt-world-stat" style="opacity:.7;margin-bottom:6px">${statText()}</div>
      <div>${placeholder}</div>
      <details style="margin-top:8px"><summary>将发送给导演 API 的世界书文本</summary>
        <pre id="dt-world-preview" style="white-space:pre-wrap;margin:6px 0">—</pre>
      </details>
    `;

    const search = body.querySelector('#dt-world-search');
    search?.addEventListener('input', () => {
      worldKeyword = search.value;
      render();
    });
    body.querySelector('#dt-world-reload')?.addEventListener('click', () => loadWorld(true));

    // 全选 / 全不选（只作用于当前搜出来的这些，免得误勾一堆没看见的）
    const bulk = (checked) => {
      const next = { ...(getWorldSelection?.() ?? {}) };
      for (const key of visibleKeys) {
        if (checked) next[key] = true;
        else delete next[key];
      }
      saveWorldSelection?.(next);
      render();
    };
    body.querySelector('#dt-world-select-all')?.addEventListener('click', () => bulk(true));
    body.querySelector('#dt-world-select-none')?.addEventListener('click', () => bulk(false));

    body.querySelectorAll('input[data-world-key]').forEach((box) => {
      box.addEventListener('change', () => {
        const next = { ...(getWorldSelection?.() ?? {}) };
        if (box.checked) next[box.dataset.worldKey] = true;
        else delete next[box.dataset.worldKey];
        saveWorldSelection?.(next);
        const stat = body.querySelector('#dt-world-stat');
        if (stat) stat.textContent = statText();
        refreshWorldPreview(body);
      });
    });

    // 整书勾选 / 取消（项目书 §F1「树形勾选整书或单条目」）
    body.querySelectorAll('input[data-world-book]').forEach((bookBox) => {
      // 复选框在 <summary> 里：点它不应该顺带折叠/展开
      bookBox.addEventListener('click', (event) => event.stopPropagation());
      bookBox.addEventListener('change', () => {
        const target = bookBox.dataset.worldBook;
        const next = { ...(getWorldSelection?.() ?? {}) };
        for (const source of worldSources ?? []) {
          for (const book of source.books ?? []) {
            if (book.name !== target) continue;
            for (const entry of book.entries ?? []) {
              if (bookBox.checked) next[entry.key] = true;
              else delete next[entry.key];
            }
          }
        }
        saveWorldSelection?.(next);
        render();
      });
    });

    // 搜索重渲染后把焦点与光标放回去
    if (keyword) {
      search?.focus();
      search?.setSelectionRange(worldKeyword.length, worldKeyword.length);
    }

    refreshWorldPreview(body);
  }

  /**
   * 剧本编辑页（T-404）：大纲 + 阶段树（增删改 / 复制 / 上下移 / 锁定 / 附注）+ 快照 + 伏笔销账。
   * 只做功能，不美化（G4）。字段改动不重绘（避免丢焦点），结构改动才重绘。
   */
  function renderEditor(body) {
    const state = store?.get?.() ?? {};
    const outline = state.outline ?? null;
    const stages = state.stages ?? [];
    const activeId = state.activeStageId ?? null;
    const field = (row) => `<input style="${EDIT_FIELD}" ${row}>`;

    if (!outline && !stages.length) {
      body.innerHTML = `
        <div style="opacity:.75;margin-bottom:8px">还没有剧本。可以手写一份，也可以让 AI 生成：</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button id="dt-edit-blank" type="button" style="${EDIT_BTN}">手动建空白剧本</button>
          <button id="dt-edit-ai" type="button" style="${EDIT_BTN}">让 AI 生成</button>
        </div>`;
      body.querySelector('#dt-edit-blank')?.addEventListener('click', () => {
        editor?.setOutline?.({ ...(editor.blankOutline?.() ?? {}), title: '未命名剧本' });
        editor?.addStage?.(-1, { title: '第 1 场' });
        render();
      });
      body.querySelector('#dt-edit-ai')?.addEventListener('click', () => onGenerate?.());
      return;
    }

    const blocks = stages.map((stage, index) => {
      const current = stage.id === activeId;
      const patch = `data-dt-id="${escapeHtml(stage.id)}"`;
      return `
        <details ${current ? 'open' : ''} style="margin:6px 0;padding:6px;border:1px solid var(--dt-rule,rgba(43,39,33,.2))">
          <summary style="cursor:pointer">${index + 1}. ${escapeHtml(stage.title)} ${current ? '← 当前' : ''} · ${escapeHtml(stage.status)}${stage.locked ? ' · 已锁定' : ''}</summary>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin:6px 0">
            <button type="button" data-dt-move="${index}" data-dt-dir="-1" style="${EDIT_BTN}">↑</button>
            <button type="button" data-dt-move="${index}" data-dt-dir="1" style="${EDIT_BTN}">↓</button>
            <button type="button" data-dt-dup="${escapeHtml(stage.id)}" style="${EDIT_BTN}">复制</button>
            <button type="button" data-dt-del="${escapeHtml(stage.id)}" style="${EDIT_BTN}">删除</button>
            <button type="button" data-dt-insert="${index}" style="${EDIT_BTN}">在其后插入</button>
            <label style="display:flex;align-items:center;gap:4px">
              <input type="checkbox" data-dt-lock="${escapeHtml(stage.id)}" ${stage.locked ? 'checked' : ''}> 锁定（AI 不许改这一场）
            </label>
          </div>
          <div>标题</div>${field(`data-dt-field="title" ${patch} value="${escapeHtml(stage.title)}"`)}
          <div>本场要做成（goal · 主语是 char）</div>${field(`data-dt-field="goal" ${patch} value="${escapeHtml(stage.goal)}"`)}
          <div>char 的主要活动</div>${field(`data-dt-field="activity" ${patch} value="${escapeHtml(stage.activity)}"`)}
          <div>达成条件（char 单方面就能完成）</div>${field(`data-dt-field="checkpoint.criteria" ${patch} value="${escapeHtml(stage.checkpoint?.criteria)}"`)}
          <div>反意图（antiCriteria）</div>${field(`data-dt-field="checkpoint.antiCriteria" ${patch} value="${escapeHtml(stage.checkpoint?.antiCriteria)}"`)}
          <div>走位（一行一条）</div>
          <textarea rows="3" style="${EDIT_FIELD}" data-dt-field="beats" ${patch}>${escapeHtml((stage.beats ?? []).join('\n'))}</textarea>
          <div>附注（写给自己 / 会作为「本场附注」进注入）</div>${field(`data-dt-field="notes" ${patch} value="${escapeHtml(stage.notes)}"`)}
        </details>`;
    }).join('');

    const openFs = foreshadows?.list?.() ?? [];

    body.innerHTML = `
      <details style="margin-bottom:8px"><summary>大纲</summary>
        <div>剧本标题</div>${field(`data-dt-outline="title" value="${escapeHtml(outline?.title)}"`)}
        <div>主线目标（统领所有阶段）</div>${field(`data-dt-outline="objective" value="${escapeHtml(outline?.objective)}"`)}
        <div>一句话前提</div>${field(`data-dt-outline="premise" value="${escapeHtml(outline?.premise)}"`)}
      </details>
      <div style="opacity:.7;margin-bottom:4px">阶段 ${stages.length} 个 · 当前第 ${Math.max(1, stages.findIndex((s) => s.id === activeId) + 1)} 个</div>
      ${blocks}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button id="dt-edit-add" type="button" style="${EDIT_BTN}">在末尾加一阶段</button>
        <button id="dt-edit-truncate" type="button" style="${EDIT_BTN}">从当前阶段往后截断重生成</button>
      </div>
      <details style="margin-top:10px"><summary>快照（下载 / 导入 / 回滚）</summary>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">
          <button id="dt-edit-download" type="button" style="${EDIT_BTN}">下载快照文件</button>
          <button id="dt-edit-pickfile" type="button" style="${EDIT_BTN}">从文件导入</button>
          <button id="dt-edit-export" type="button" style="${EDIT_BTN}">导出到下面</button>
          <button id="dt-edit-import" type="button" style="${EDIT_BTN}">用下面的文本导入（覆盖当前剧本）</button>
          <input id="dt-edit-file" type="file" accept=".json,application/json" style="display:none">
        </div>
        <textarea id="dt-edit-snapshot" rows="6" style="${EDIT_FIELD}" placeholder="快照 JSON（在这个框里，切页面 / 重绘都不会丢）">${escapeHtml(snapshotDraft)}</textarea>
        <div id="dt-edit-msg" style="opacity:.75">—</div>
      </details>
      <details style="margin-top:8px"><summary>伏笔（待回收 ${openFs.length}）</summary>
        ${openFs.length
    ? openFs.map((item) => `<div style="margin:4px 0">· ${escapeHtml(item.text)} <button type="button" data-dt-fs="${escapeHtml(item.id)}" style="${EDIT_BTN}">标记已回收</button></div>`).join('')
    : '<div style="opacity:.7">（没有待回收的伏笔）</div>'}
      </details>
    `;

    const msg = (text) => {
      const node = body.querySelector('#dt-edit-msg');
      if (node) node.textContent = text;
    };

    // ---------- 大纲 ----------
    body.querySelectorAll('input[data-dt-outline]').forEach((input) => {
      input.addEventListener('change', () => {
        editor?.setOutline?.({ [input.dataset.dtOutline]: input.value });
        msg('大纲已保存');
      });
    });

    // ---------- 字段（不重绘，避免丢焦点）----------
    body.querySelectorAll('[data-dt-field]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.dtField;
        const id = input.dataset.dtId;
        if (key === 'beats') {
          editor?.updateStage?.(id, { beats: input.value.split('\n').map((line) => line.trim()).filter(Boolean) });
        } else if (key.startsWith('checkpoint.')) {
          const stage = store?.get?.().stages.find((item) => item.id === id);
          editor?.updateStage?.(id, { checkpoint: { ...(stage?.checkpoint ?? {}), [key.slice('checkpoint.'.length)]: input.value } });
        } else {
          editor?.updateStage?.(id, { [key]: input.value });
        }
        msg('已保存（该阶段不会被 AI 自动改写）');
      });
    });

    // ---------- 结构操作（重绘）----------
    body.querySelectorAll('button[data-dt-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const from = Number(button.dataset.dtMove);
        editor?.moveStage?.(from, from + Number(button.dataset.dtDir));
        render();
      });
    });
    body.querySelectorAll('button[data-dt-dup]').forEach((button) => {
      button.addEventListener('click', () => { editor?.duplicateStage?.(button.dataset.dtDup); render(); });
    });
    body.querySelectorAll('button[data-dt-del]').forEach((button) => {
      button.addEventListener('click', () => { editor?.removeStage?.(button.dataset.dtDel); render(); });
    });
    body.querySelectorAll('button[data-dt-insert]').forEach((button) => {
      button.addEventListener('click', () => { editor?.addStage?.(Number(button.dataset.dtInsert)); render(); });
    });
    body.querySelectorAll('input[data-dt-lock]').forEach((box) => {
      box.addEventListener('change', () => { editor?.setLocked?.(box.dataset.dtLock, box.checked); render(); });
    });
    body.querySelector('#dt-edit-add')?.addEventListener('click', () => { editor?.addStage?.(stages.length - 1); render(); });

    // 文本框里的内容随时同步到内存草稿（重绘不丢）
    const snapshotArea = body.querySelector('#dt-edit-snapshot');
    snapshotArea?.addEventListener('input', () => { snapshotDraft = snapshotArea.value; });

    body.querySelector('#dt-edit-export')?.addEventListener('click', () => {
      snapshotDraft = editor?.exportJson?.() ?? '';
      if (snapshotArea) snapshotArea.value = snapshotDraft;
      msg(`已导出 ${snapshotDraft.length} 字（也可以点「下载快照文件」存成文件）`);
    });

    /** 真下载一份 .json —— 只在文本框里放一份，用户复制走太容易丢 */
    body.querySelector('#dt-edit-download')?.addEventListener('click', () => {
      const json = editor?.exportJson?.() ?? '';
      snapshotDraft = json;
      if (snapshotArea) snapshotArea.value = json;
      try {
        const title = (store?.get?.().outline?.title ?? '剧本').replace(/[\\/:*?"<>|]/g, '_');
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `导演时间-${title}-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        msg(`已下载快照：${link.download}`);
      } catch (error) {
        msg(`下载失败（${error?.message ?? error}），可以点「导出到下面」手动复制`);
      }
    });

    body.querySelector('#dt-edit-pickfile')?.addEventListener('click', () => {
      body.querySelector('#dt-edit-file')?.click();
    });
    body.querySelector('#dt-edit-file')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        snapshotDraft = text;
        const result = editor?.importJson?.(text);
        if (result?.ok) { render(); return; }
        msg(`导入失败：${result?.error ?? '未知'}`);
      } catch (error) {
        msg(`读文件失败：${error?.message ?? error}`);
      }
    });

    body.querySelector('#dt-edit-import')?.addEventListener('click', () => {
      const text = snapshotArea?.value ?? snapshotDraft;
      if (!String(text).trim()) { msg('文本框是空的：先点「导出到下面」或「下载快照文件」，或者粘贴一份 JSON'); return; }
      const result = editor?.importJson?.(text);
      if (result?.ok) { render(); return; }
      msg(`导入失败：${result?.error ?? '未知'}`);
    });
    body.querySelector('#dt-edit-truncate')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = '处理中…';
      try {
        await onTruncateRegen?.();
        render();
      } finally {
        button.disabled = false;
      }
    });

    // ---------- 伏笔销账（T-408 的入口）----------
    body.querySelectorAll('button[data-dt-fs]').forEach((button) => {
      button.addEventListener('click', () => { foreshadows?.resolve?.(button.dataset.dtFs); render(); });
    });
  }

  function render() {
    const title = view === 'config' ? '导演时间 · 配置'
      : (view === 'world' ? '导演时间 · 世界书' : (view === 'editor' ? '导演时间 · 剧本' : '导演时间'));
    const node = ensure();
    node.querySelector('#dt-panel-title').textContent = title;
    node.querySelector('#dt-panel-enabled').checked = Boolean(getEnabled?.());
    node.querySelector('#dt-panel-config').textContent = view === 'config' ? '返回' : '配置';
    node.querySelector('#dt-panel-world').textContent = view === 'world' ? '返回' : '世界书';
    node.querySelector('#dt-panel-editor').textContent = view === 'editor' ? '返回' : '剧本';

    const body = node.querySelector('#dt-panel-body');
    if (view === 'config') {
      renderSettingsForm({ container: body, store, onTest, onSave, profile, presets, automation, extras });
    } else if (view === 'world') {
      renderWorld(body);
    } else if (view === 'editor') {
      renderEditor(body);
    } else {
      renderStatus(body);
    }
    return node;
  }

  function setView(next) {
    view = next;
    // 第一次进世界书页自动加载一次（可能慢，先渲染「加载中」）
    if (view === 'world' && worldSources === null && !worldLoading) {
      loadWorld(false);
      return el;
    }
    return render();
  }

  function open() {
    const node = ensure();
    node.classList.add('dt-open');
    view = 'status';
    render();
    return node;
  }

  function close() {
    el?.classList.remove('dt-open');
  }

  function toggle() {
    return isOpen() ? close() : open();
  }

  function destroy() {
    if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
    el?.remove();
    el = null;
  }

  return { open, close, toggle, render, setView, destroy, isOpen };
}
