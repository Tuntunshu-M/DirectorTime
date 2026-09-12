// 导演时间 · 主面板外壳（UI 定稿 §2 信息架构 / §3 状态行）
//
// 抬头：标题 · 状态灯 · 五个工具图标（世界书 / 提示词 / 设置 / 日夜 / 调试）
// 三个分类：场记（默认） / 剧本 / 人物
// 弹层：头部「‹ 返回上一层」+「✕ 关闭全部」，带返回栈（从设置进世界书能退回设置）
//
// **接线方式：data-act 驱动**（定稿 §2.1 的验收就是靠它机械校验的）
//   · 每个可点控件在 markup 里写 data-act="模块.动作"
//   · 每个动作在对应 render 模块里注册同名 handler
//   · 两边对不上就是「做了控件没接动作 / 做了动作没控件」—— tests/ui.test.mjs 会把它抓出来

import { esc, iconButton } from './dom.js';
import * as journal from './render/journal.js';
import * as script from './render/script.js';
import * as cast from './render/cast.js';
import * as worldbook from './render/worldbook.js';
import * as prompts from './render/prompts.js';
import * as settings from './render/settings.js';
import * as debug from './render/debug.js';

const MODULES = [journal, script, cast, worldbook, prompts, settings, debug];

const TABS = [
  { view: 'status', label: '场记' },
  { view: 'editor', label: '剧本' },
  { view: 'cast', label: '人物' },
];

/**
 * 界面版本号：控制台 `DirectorTime.uiVersion` 一看就知道跑的是不是新代码（旧代码没有这个键）。
 * 与 `manifest.json` 的版本**保持一致**（同一份发布里跟着一起跳），
 * 这样"面板显示 0.10.0 / 更新提示 0.10.0"永远不会互相打脸 —— 一开始想只按界面改动跳，实际只会让人怀疑没更新成功。
 */
export const UI_VERSION = '0.11.0';

const PALETTE_KEY = 'dt-palette';
const LAYER_NAMES = { world: '世界书', prompt: '提示词', settings: '设置', debug: '调试面板' };
const BASE_NAME = '场记';

export function normalizePalette(value) {
  return value === 'b' ? 'b' : 'a';
}

/**
 * 分类页的显隐归一：只显示当前分类。
 *
 * 各 view 里的 `hidden` 只是**初值**（剧本 / 人物默认藏起来）。
 * 2026-09-12 实机反馈："点剧本和人物没跳转" —— 就是这里漏了：
 * 页签高亮变了、内容却还是写死的那一份。图层一直有同步逻辑，页面漏了。
 */
export function syncPageVisibility(html, active = 'status') {
  return String(html).replace(
    /<div data-page="([a-z]+)"(\s+hidden)?>/g,
    (match, name) => `<div data-page="${name}"${name === active ? '' : ' hidden'}>`,
  );
}

/** 面板 HTML（纯函数：state + 临时 UI 状态 → 字符串 + 动作表） */
export function renderPanel(state, uiState = {}) {
  const actions = {};
  const pages = [];
  const layers = [];

  for (const mod of MODULES) {
    const out = mod.render(state, uiState);
    Object.assign(actions, out.actions ?? {});
    if (String(out.html).trimStart().startsWith('<div class="dt-layer"')) layers.push(out.html);
    else pages.push(out.html);
  }

  const active = uiState.view ?? 'status';
  const stage = state.stage ?? {};
  const statusText = `${state.enabled ? '启用中' : '已停用'} · ${stage.total
    ? `第 ${stage.index} 场 / 共 ${stage.total} 场 · 本场第 ${Number(stage.active?.turnCount ?? 0)} 楼`
    : '还没有剧本'}`;

  const html = `
  <section class="dt-card" role="dialog" aria-label="导演时间">
    <div class="dt-clapper"></div>
    <header class="dt-head">
      <div class="dt-head-top">
        <strong class="dt-title">导演时间</strong>
        <span class="dt-sub">DIRECTOR TIME</span>
        <span class="spacer"></span>
        <span class="dt-tools">
          ${iconButton({ act: 'shell.layer', name: 'book', title: '世界书', cls: 'dt-tool-world', layer: 'world' })}
          ${iconButton({ act: 'shell.layer', name: 'bars', title: '提示词 / 预设 / 清洗', cls: 'dt-tool-prompt', layer: 'prompt' })}
          ${iconButton({ act: 'shell.layer', name: 'gear', title: '设置', cls: 'dt-tool-settings', layer: 'settings' })}
          ${iconButton({ act: 'shell.theme', name: normalizePalette(uiState.palette) === 'a' ? 'moon' : 'sun', title: normalizePalette(uiState.palette) === 'a' ? '切到日间牛皮纸' : '切到夜间场记板' })}
          ${iconButton({ act: 'shell.debug', name: 'chart', title: '调试面板' })}
        </span>
      </div>
      <div class="dt-status"><i class="dt-dot${state.enabled ? '' : ' dt-dot-off'}"></i><span>${esc(statusText)}</span></div>
      <!-- 全局提示位：动作出错/没接线就写在这儿（一直可见，不用开控制台） -->
      <div class="dt-flash" data-flash="global" hidden></div>
    </header>

    <nav class="dt-tabs">
      ${TABS.map((tab) => `<button class="dt-tab${active === tab.view ? ' dt-tab-on' : ''}" type="button" data-act="shell.tab" data-view="${tab.view}">${tab.label}</button>`).join('')}
    </nav>

    <div class="dt-body">${syncPageVisibility(pages.join(''), active)}</div>
    ${layers.join('')}
  </section>`;

  const realActions = {
    'shell.tab': (el, { ctx }) => { ctx.setState({ view: el.dataset.view, layer: null }); ctx.refresh(); },
    'shell.layer': (el, { ctx }) => {
      // 目标层写在 data-open-layer 上（不再靠 class 名猜 —— 猜法脆，改个样式就失效）
      ctx.openLayer(el.dataset.openLayer || 'settings');
    },
    'shell.debug': (el, { ctx }) => { ctx.openLayer('debug'); },
    'shell.theme': (el, { ctx }) => { ctx.togglePalette(); },
    'layer.close': (el, { ctx }) => { ctx.closeLayers(); },
    'layer.back': (el, { ctx }) => { ctx.backLayer(); },
  };

  return { html, actions: { ...actions, ...realActions } };
}

/**
 * 装配主面板。
 * @param {{ getApi: () => object }} options getApi 在**点击时**取 api（装配顺序无关）
 */
export function createMainPanel({ getApi = () => ({}) } = {}) {
  let el = null;
  let card = null;
  let actions = {};
  let state = {};
  let escapeHandler = null;
  const uiState = {
    view: 'status',
    layer: null,
    stack: [],
    keyword: '',
    showKey: false,
    debugShowRaw: false,
    models: [],
    palette: readPalette(),
  };

  function readPalette() {
    try {
      return normalizePalette(globalThis.localStorage?.getItem(PALETTE_KEY));
    } catch {
      return 'a';
    }
  }

  function savePalette(value) {
    try { globalThis.localStorage?.setItem(PALETTE_KEY, value); } catch { /* 隐私模式：只影响本次 */ }
  }

  /** 当前弹层的「返回」目标名（返回栈） */
  function backToName() {
    const from = uiState.stack[uiState.stack.length - 1] ?? null;
    if (!from || from === 'status') return BASE_NAME;
    return LAYER_NAMES[from] ?? BASE_NAME;
  }

  /** 事件到达统计 + 最近一次动作/错误（诊断用：把"事件到没到"和"动作对不对"分开） */
  const stats = { seen: 0, byType: {}, lastAct: '', lastError: '', lastAt: 0 };

  function flash(key, text) {
    const target = card?.querySelector(`[data-flash="${key}"]`);
    if (!target) return;
    target.hidden = false;
    target.textContent = text;
  }

  /**
   * 出错要**在界面上**说（批复 §〇之二 强烈建议）：
   * 以前只 console.warn —— 用户看到的是"点了没反应"，还得每次开控制台猜。
   * 现在同时写全局提示位（抬头下方，一直可见）＋控制台留详细堆栈。
   */
  function surface(text, detail = '') {
    stats.lastError = text;
    flash('global', text);
    console.warn(`[导演时间] ${text}`, detail);
  }

  function ctx() {
    return {
      api: getApi(),
      state,
      getState: () => uiState,
      setState: (patch) => { Object.assign(uiState, patch); },
      setModels: (list) => { uiState.models = list; },
      flash,
      flashGlobal: (text) => flash('global', text),
      busy: (key, text) => flash(key, text),
      busyGlobal: (text) => flash('global', text),
      refresh: () => render(),
      root: () => card,
      openLayer: (name) => {
        if (uiState.layer) uiState.stack.push(uiState.layer);
        uiState.layer = name;
        render();
      },
      closeLayers: () => { uiState.layer = null; uiState.stack = []; render(); },
      backLayer: () => {
        uiState.layer = uiState.stack.pop() ?? null;
        render();
      },
      togglePalette: () => {
        uiState.palette = normalizePalette(uiState.palette) === 'a' ? 'b' : 'a';
        savePalette(uiState.palette);
        if (el) { el.dataset.palette = uiState.palette; applyShellStyle(); }
        render();
      },
    };
  }

  let delegated = false;

  /**
   * 事件接线：**在面板根节点上委托 + 捕获阶段**。
   *
   * 为什么不用"逐元素绑定"（2026-09-12 实机反馈："看得到但完全点不了"）：
   *   1. 酒馆自己会在 document/body 上处理点击、有的地方还会 stopPropagation ——
   *      逐元素监听在冒泡阶段收不到事件；挂根节点 + **capture:true** 就绕开了。
   *   2. 面板每次重绘都换掉整棵子树，委托监听只挂一次，永远不会漏。
   */
  function bindDelegated() {
    if (delegated || !el) return;
    delegated = true;

    const route = (event) => {
      const target = event.target?.closest?.('[data-act]');
      if (!target || !el.contains(target)) return;

      // 统计"事件到底有没有到面板"：diagnose 里 seen=0 = 被宿主挡了 / 被透明层盖了
      stats.seen += 1;
      stats.byType[event.type] = (stats.byType[event.type] ?? 0) + 1;
      stats.lastAct = target.dataset.act ?? '';
      stats.lastAt = Date.now();

      // 实时过滤（世界书搜索）用 input；其余输入类交给 change（保存时才触发）
      if (event.type === 'input' && !String(target.dataset.act).endsWith('.search')) return;
      // 开关/单选由 click 处理（再收一次 change 会做两遍）
      if (event.type === 'change' && (target.type === 'checkbox' || target.type === 'radio')) return;
      // 其余输入类不是 click 的活儿（避免"点一下就保存"）
      if (event.type === 'click') {
        const tag = target.tagName;
        const type = target.type;
        if (tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(type)) return;
      }

      const name = target.dataset.act;
      const handler = actions[name];
      if (!handler) {
        // 定稿 §2.1：做了控件没接动作 = 打回。界面上+控制台都点名（别静默）
        surface(`控件没有接线：${name}`, target);
        return;
      }
      // 调用约定（全项目统一）：handler(元素, { ctx, api, state }, 事件)
      // —— 第二个参数是**打包对象**，不是 ctx 本身。以前直接传 ctx()，
      //    (el, { ctx }) 解构出来就是 undefined → "Cannot read properties of undefined (reading 'setState')"
      const context = ctx();
      try {
        const result = handler(target, { ctx: context, api: context?.api ?? getApi(), state }, event);
        if (result && typeof result.catch === 'function') {
          result.catch((error) => surface(`动作 ${name} 出错：${error?.message ?? error}`, error));
        }
      } catch (error) {
        surface(`动作 ${name} 抛异常：${error?.message ?? error}`, error);
      }
    };

    // 捕获阶段挂三种事件：click（按钮/开关）+ change（输入框/下拉/滑块）+ input（搜索）
    el.addEventListener('click', route, true);
    el.addEventListener('change', route, true);
    el.addEventListener('input', route, true);

    // 键盘可达：锁芯片（span）用 Enter/空格也能点
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target?.closest?.('[data-act]');
      if (target?.dataset.act === 'script.lock') {
        event.preventDefault();
        target.click();
      }
    }, true);
  }

  /** 仅用于自检：数一数界面上有多少个可点控件 */
  function countControls() {
    return card ? card.querySelectorAll('[data-act]').length : 0;
  }

  /** 世界书来源是异步的：打开面板时读一次，缓存进 uiState（弹层与设置里的状态行共用） */
  async function loadWorld(force = false) {
    const api = getApi();
    if (!api?.loadWorldSources) return;
    try {
      uiState.worldSources = await api.loadWorldSources(force) ?? [];
    } catch (error) {
      console.warn('[导演时间] 读取世界书失败（面板里会显示为空）', error);
      uiState.worldSources = uiState.worldSources ?? [];
    }
    render();
  }

  function render() {
    if (!card) return;
    const api = getApi();
    state = api?.ui?.read?.() ?? {};
    if (uiState.worldSources) state.world = { ...(state.world ?? {}), sources: uiState.worldSources };
    const out = renderPanel(state, { ...uiState, backTo: backToName() });
    actions = out.actions;
    card.innerHTML = out.html;
    if (el) el.dataset.palette = uiState.palette;
    // 弹层显隐：只有当前这一层打开
    card.querySelectorAll('.dt-layer').forEach((layer) => {
      layer.classList.toggle('dt-layer-on', layer.dataset.layer === uiState.layer);
    });
    // 分类页显隐（与图层同理：markup 里的 hidden 只是初值，这里按当前分类归一）
    card.querySelectorAll('[data-page]').forEach((page) => {
      page.hidden = page.dataset.page !== (uiState.view ?? 'status');
    });
    bindDelegated();
    // 旧引擎不认 :has() —— 给选中的单选补一个 .dt-on（视觉兜底，见 style.css）
    card.querySelectorAll('.dt-seg input:checked, .dt-radio input:checked').forEach((input) => {
      input.closest?.('label')?.classList.add('dt-on');
    });
    // 重绘后把焦点还给"正在打字"的那个控件（搜索框边打边过滤不丢焦点）
    if (uiState.focusAct) {
      const target = card.querySelector(`[data-act="${uiState.focusAct}"]`);
      if (target && typeof target.focus === 'function') {
        target.focus();
        const end = String(target.value ?? '').length;
        try { target.setSelectionRange?.(end, end); } catch { /* 某些 input 类型不支持 */ }
      }
    }
    // 全局提示位由 shell 模板提供（抬头下方，任何分类页都可见）——这里不再动态塞
  }

  /**
   * 骨架几何与配色**写死在内联样式上**：酒馆的全局样式会抢外链 CSS / CSS 可能被缓存成旧版，
   * 外链样式万一没生效，面板也必须"立得住、看得清"。
   * 内联只兜底"定位 + 居中 + 配色变量"，字体/间距/边框仍由 style.css 负责。
   */
  const SHELL_VARS = {
    a: '--bg:#141310;--card:#232019;--card-2:#1c1a17;--field:#2b271f;--field-2:#322c23;'
      + '--ink:#ece3d0;--ink-2:#a89c88;--faded:#776e5f;--accent:#d9a04b;--accent-soft:rgba(217,160,75,.14);'
      + '--ok:#8fb573;--rule:rgba(236,227,208,.16);--rule-soft:rgba(236,227,208,.09);--on-accent:#201c16;',
    b: '--bg:#4a443a;--card:#f4eee1;--card-2:#faf6ec;--field:#fdfbf4;--field-2:#efe8da;'
      + '--ink:#2b2721;--ink-2:#5f5647;--faded:#8d8371;--accent:#8c3a2b;--accent-soft:rgba(140,58,43,.08);'
      + '--ok:#4f7040;--rule:rgba(43,39,33,.26);--rule-soft:rgba(43,39,33,.13);--on-accent:#f7f2e7;',
  };

  function applyShellStyle() {
    if (!el) return;
    const palette = normalizePalette(uiState.palette);
    el.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;width:100vw;height:100vh;z-index:10000;'
      + `display:${isOpen() || el.classList.contains('dt-open') ? 'grid' : 'none'};place-items:center;`
      + 'box-sizing:border-box;overflow:auto;padding:12px;background:rgba(24,20,15,.5);'
      + `color:var(--ink);font-family:var(--sans);${SHELL_VARS[palette]}`;
  }

  function ensure() {
    if (el) return el;
    const doc = globalThis.document;
    if (!doc) return null;
    el = doc.createElement('div');
    el.id = 'dt-panel';
    el.dataset.palette = uiState.palette;
    applyShellStyle();
    card = doc.createElement('div');
    card.className = 'dt-card-holder';
    card.style.cssText = 'width:100%;max-width:440px;max-height:calc(100vh - 24px);box-sizing:border-box;';
    el.append(card);
    doc.body.appendChild(el);

    // 点遮罩关闭；点卡片内部不关
    el.addEventListener('click', (event) => {
      if (event.target === el) hide();
    });
    escapeHandler = (event) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      // 有弹层先退弹层（返回栈），没有才关面板
      if (uiState.layer) ctx().backLayer();
      else hide();
    };
    doc.addEventListener('keydown', escapeHandler);
    console.log(`[导演时间] 界面已挂载（UI ${UI_VERSION}）—— 控制台可跑 DirectorTime.panel.diagnose() 自检`);
    render();
    return el;
  }

  function isOpen() {
    // 显隐以**内联样式**为准（CSS 的 .dt-open 只是给样式表用的钩子）
    return Boolean(el && el.style.display !== 'none' && el.classList.contains('dt-open'));
  }

  function open() {
    ensure();
    if (!el) return null;
    el.classList.add('dt-open');
    el.dataset.palette = normalizePalette(uiState.palette);
    // grid（不是 block）—— 居中靠 place-items:center；整块样式由 applyShellStyle 统一写
    applyShellStyle();
    render();
    if (!uiState.worldSources) loadWorld(false);
    return el;
  }

  function hide() {
    el?.classList.remove('dt-open');
    applyShellStyle();
    if (uiState.layer) { uiState.layer = null; uiState.stack = []; }
  }

  function openLayer(name) {
    open();
    uiState.layer = name;
    uiState.stack = ['status'];
    render();
  }

  return {
    open,
    hide,
    isOpen,
    refresh: render,
    layer: openLayer,
    /** 测试与自检用：当前渲染出来的控件 → 动作对照 + 事件到达统计 */
    inspect: () => ({
      actions: Object.keys(actions),
      stats: { ...stats, byType: { ...stats.byType } },
      uiVersion: UI_VERSION,
      state,
      uiState: { ...uiState },
    }),
    /**
     * 实机排障用（控制台 `DirectorTime.panel.diagnose()`）：
     * 面板塌成一条 / 没居中时，一眼看出是"外链样式没加载"还是"被宿主样式覆盖"。
     */
    diagnose: () => {
      const style = el && globalThis.getComputedStyle ? globalThis.getComputedStyle(el) : null;
      if (!el) {
        return {
          uiVersion: UI_VERSION,
          exists: false,
          open: false,
          position: '(面板还没创建过)',
          display: '',
          zIndex: '',
          cssLoaded: false,
          cardWidth: 0,
          cardHeight: 0,
          viewport: { w: globalThis.innerWidth ?? 0, h: globalThis.innerHeight ?? 0 },
          palette: uiState.palette,
          controls: 0,
          delegated: false,
          layer: uiState.layer,
          clicksSeen: stats.seen,
          eventsByType: { ...stats.byType },
          lastAct: '(还没点过面板)',
          lastError: '(没有报错)',
          hitTest: '(面板还没创建)',
          hint: '面板还没创建过（先点扩展菜单打开一次）；如果连 DirectorTime.uiVersion 都读不到，说明跑的还是旧代码 → 重启酒馆',
        };
      }
      const cardNode = card?.firstElementChild ?? card ?? null;
      const box = cardNode?.getBoundingClientRect?.();
      return {
        exists: Boolean(el),
        open: isOpen(),
        position: style?.position ?? '(读不到)',
        display: style?.display ?? '',
        zIndex: style?.zIndex ?? '',
        // --card 只在 style.css 的配色块里定义：读不到 = 外链样式根本没生效
        cssLoaded: style ? Boolean(style.getPropertyValue('--card')) : false,
        cardWidth: box ? Math.round(box.width) : 0,
        cardHeight: box ? Math.round(box.height) : 0,
        viewport: { w: globalThis.innerWidth ?? 0, h: globalThis.innerHeight ?? 0 },
        palette: uiState.palette,
        // ---- 点不了时看这几项（批复 §〇之二：把"事件到没到"与"动作对不对"分开）----
        controls: countControls(),
        delegated,
        layer: uiState.layer,
        // 事件到达计数：先点一下面板上的按钮，再跑 diagnose ——
        //   seen = 0 → 事件根本没到面板（被宿主拦 / 被透明层盖住，看 hitTest）
        //   seen > 0 但界面没反应 → handler 的问题，看 lastAct / lastError
        clicksSeen: stats.seen,
        eventsByType: { ...stats.byType },
        lastAct: stats.lastAct || '(还没点过面板)',
        lastError: stats.lastError || '(没有报错)',
        // 卡片头部正中间那个点上，命中的是谁？（不是面板里的东西 = 被别的东西盖住了）
        hitTest: (() => {
          if (!box || typeof globalThis.document?.elementFromPoint !== 'function') return '(无法测量)';
          const node = globalThis.document.elementFromPoint(box.left + box.width / 2, box.top + 24);
          if (!node) return '(没命中任何元素)';
          if (el.contains(node)) return `面板内：${node.tagName}.${node.className || ''}`.slice(0, 80);
          return `⚠ 被外面盖住：${node.tagName}.${node.className || ''}`.slice(0, 80);
        })(),
        hint: style && style.position !== 'fixed'
          ? '定位没生效 → 样式表没加载或被酒馆样式覆盖：先重启酒馆 / Ctrl+F5 强刷（CSS 会被浏览器缓存）'
          : (countControls() === 0
            ? '面板里一个控件都没有 → 渲染没跑完'
            : (stats.seen === 0
              ? '还没收到任何面板内的点击：点一个按钮再看 clicksSeen；仍是 0 就看 hitTest 是不是"被外面盖住"'
              : `事件能到（已收到 ${stats.seen} 次），最近一次动作 ${stats.lastAct || '—'}；动作出错会直接写在面板上`)),
      };
    },
  };
}
