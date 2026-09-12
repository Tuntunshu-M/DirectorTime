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

const PALETTE_KEY = 'dt-palette';
const LAYER_NAMES = { world: '世界书', prompt: '提示词', settings: '设置', debug: '调试面板' };
const BASE_NAME = '场记';

export function normalizePalette(value) {
  return value === 'b' ? 'b' : 'a';
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
          ${iconButton({ act: 'shell.layer', name: 'book', title: '世界书', cls: 'dt-tool-world' })}
          ${iconButton({ act: 'shell.layer', name: 'bars', title: '提示词 / 预设 / 清洗', cls: 'dt-tool-prompt' })}
          ${iconButton({ act: 'shell.layer', name: 'gear', title: '设置', cls: 'dt-tool-settings' })}
          ${iconButton({ act: 'shell.theme', name: normalizePalette(uiState.palette) === 'a' ? 'moon' : 'sun', title: normalizePalette(uiState.palette) === 'a' ? '切到日间牛皮纸' : '切到夜间场记板' })}
          ${iconButton({ act: 'shell.debug', name: 'chart', title: '调试面板' })}
        </span>
      </div>
      <div class="dt-status"><i class="dt-dot${state.enabled ? '' : ' dt-dot-off'}"></i><span>${esc(statusText)}</span></div>
    </header>

    <nav class="dt-tabs">
      ${TABS.map((tab) => `<button class="dt-tab${active === tab.view ? ' dt-tab-on' : ''}" type="button" data-act="shell.tab" data-view="${tab.view}">${tab.label}</button>`).join('')}
    </nav>

    <div class="dt-body">${pages.join('')}</div>
    ${layers.join('')}
  </section>`;

  const realActions = {
    'shell.tab': (el, { ctx }) => { ctx.setState({ view: el.dataset.view, layer: null }); ctx.refresh(); },
    'shell.layer': (el, { ctx }) => {
      const cls = el.className;
      const layer = cls.includes('dt-tool-world') ? 'world'
        : (cls.includes('dt-tool-prompt') ? 'prompt' : 'settings');
      ctx.openLayer(layer);
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

  function flash(key, text, intoFoot = false) {
    const target = card?.querySelector(`[data-flash="${key}"]`);
    if (!target) return;
    target.hidden = false;
    target.textContent = text;
    if (intoFoot && !target.textContent) target.textContent = text;
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
        render();
      },
    };
  }

  function eventOf(element) {
    const tag = element.tagName;
    const type = element.type;
    // 搜索框要"边打边过滤"：用 input 事件，重绘后由 focusAct 把焦点还回去
    if (element.dataset.act === 'world.search') return 'input';
    if (tag === 'BUTTON' || tag === 'SPAN' || tag === 'A') return 'click';
    if (type === 'file' || type === 'text' || type === 'password' || type === 'number') return 'change';
    if (tag === 'TEXTAREA' || tag === 'SELECT') return 'change';
    return 'change'; // checkbox / radio / range
  }

  function bind() {
    card.querySelectorAll('[data-act]').forEach((element) => {
      const name = element.dataset.act;
      const handler = actions[name];
      if (!handler) {
        // 定稿 §2.1：做了控件没接动作 = 打回。这里不静默 —— 控制台点名
        console.warn(`[导演时间] 控件没有接线：data-act="${name}"`, element);
        return;
      }
      element.addEventListener(eventOf(element), (event) => {
        const result = handler(element, ctx(), event);
        if (result && typeof result.catch === 'function') {
          result.catch((error) => console.warn(`[导演时间] 动作 ${name} 出错`, error));
        }
      });
      if (element.dataset.act === 'script.lock') {
        element.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') element.click();
        });
      }
    });
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
    bind();
    // 重绘后把焦点还给"正在打字"的那个控件（搜索框边打边过滤不丢焦点）
    if (uiState.focusAct) {
      const target = card.querySelector(`[data-act="${uiState.focusAct}"]`);
      if (target && typeof target.focus === 'function') {
        target.focus();
        const end = String(target.value ?? '').length;
        try { target.setSelectionRange?.(end, end); } catch { /* 某些 input 类型不支持 */ }
      }
    }
    // 主面板右下角放一句提示（全局 flash）
    if (!card.querySelector('[data-flash="global"]')) {
      const hint = globalThis.document.createElement('div');
      hint.className = 'dt-flash';
      hint.dataset.flash = 'global';
      hint.hidden = true;
      hint.style.margin = '10px 13px 0';
      card.querySelector('.dt-body')?.append(hint);
    }
  }

  function ensure() {
    if (el) return el;
    const doc = globalThis.document;
    if (!doc) return null;
    el = doc.createElement('div');
    el.id = 'dt-panel';
    el.dataset.palette = uiState.palette;
    card = doc.createElement('div');
    card.className = 'dt-card-holder';
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
    render();
    return el;
  }

  function isOpen() { return Boolean(el?.classList.contains('dt-open')); }

  function open() {
    ensure();
    if (!el) return null;
    el.classList.add('dt-open');
    render();
    if (!uiState.worldSources) loadWorld(false);
    return el;
  }

  function hide() {
    el?.classList.remove('dt-open');
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
    /** 测试与自检用：当前渲染出来的控件 → 动作对照 */
    inspect: () => ({ actions: Object.keys(actions), state, uiState: { ...uiState } }),
  };
}
