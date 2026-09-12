// T-427 测试：UI 重做（定稿 §2.1 的两条硬性验收）
//
//   □ 每个控件都有对应动作 —— 点了必须有反应（data-act 必须能在动作表里找到 handler）
//   □ 每个功能都有可达入口 —— 从 UI 真能走到（动作表里的每一项都要真的出现在界面上）
//
// 再加两条不变的 guard：
//   □ 样式全部收在 #dt-panel 作用域里（插件样式不许漏进酒馆）
//   □ 界面里不出现 emoji（定稿 §7：图标代替 emoji）

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderPanel, createMainPanel, normalizePalette } from '../src/ui/panel.js';
import { bootstrap } from '../src/bootstrap.js';
import { createStateStore } from '../src/core/state.js';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

/** 异步断言（要 await —— 否则失败会变成"没接住的 promise"，测试照样显示通过） */
async function acheck(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

/** 一份尽量齐全的假状态（每个渲染分支都要能跑过） */
function fakeState(patch = {}) {
  return {
    enabled: true,
    version: '0.7.0',
    connection: { mode: 'independent', endpoint: 'https://x/v1', apiKey: 'k', model: 'm' },
    will: 80,
    forceAffection: false,
    speculation: true,
    hardLimits: ['任何形式的公开羞辱'],
    pacing: { min: 3, max: 8 },
    stage: {
      index: 2,
      total: 3,
      active: { id: 's2', title: '幽暗庭院的重逢', goal: 'char 把边界立起来', status: 'ready', stuckCount: 0, turnCount: 7 },
    },
    stages: [
      { id: 's1', index: 1, title: '深夜的敲门', goal: 'g1', beats: ['b1'], status: 'done', locked: false, turnCount: 4 },
      { id: 's2', index: 2, title: '幽暗庭院的重逢', goal: 'g2', beats: ['b2', 'b3'], status: 'ready', locked: true, turnCount: 7 },
      { id: 's3', index: 3, title: '天亮之前', goal: 'g3', beats: [], status: 'pending', locked: false, turnCount: 0 },
    ],
    activeStageId: 's2',
    automationText: '大纲 L1 · 阶段重生成 L1 · 侧写 L1 · 立场判定 L2 · 推进点判定 L2 · 一致性自检 L2',
    automation: {
      levels: { outline: 'L1', stageRegen: 'L1', profile: 'L1', stanceJudge: 'L2', checkpointJudge: 'L2', consistency: 'L2' },
      features: ['outline', 'stageRegen', 'profile', 'stanceJudge', 'checkpointJudge', 'consistency'],
      featureLabels: { outline: '大纲', stageRegen: '阶段重生成', profile: '侧写', stanceJudge: '立场判定', checkpointJudge: '推进点判定', consistency: '一致性自检' },
      levelList: ['L0', 'L1', 'L2'],
      levelLabels: { L0: '全手动', L1: '待确认', L2: '全自动' },
    },
    params: { pacing: { min: 3, max: 8 }, maxRounds: 15, confidenceThreshold: 0.7, stuckThreshold: 3, worldLimit: 20, consistencyCheck: true },
    rules: {
      keys: ['strong', 'weak', 'negation', 'irrelevant'],
      labels: { strong: '强词（直接表态）', weak: '弱词（含糊）', negation: '否定（反转）', irrelevant: '转向（聊别的）' },
      texts: { strong: '好 = accept\n不要 = reject', weak: '嗯 = hesitate', negation: '不\n没', irrelevant: '天气\n吃什么' },
    },
    injection: { registered: true, length: 67, text: '[本场目标] …' },
    lastTurn: {
      action: 'settle',
      reason: '已达成，先收尾',
      charMessage: '他停住了',
      charMessageRaw: '<thinking>要不要回头</thinking>他停住了',
      charCleaned: '他停住了',
      stance: { source: 'combined', sections: { stance: true, judgement: true, speculation: false } },
    },
    queue: [{ id: 'q1', feature: 'stageRegen', summary: '续写 2 个阶段：露台上的对话、天亮之前' }],
    foreshadows: [{ id: 'fs1', text: '她提过的那封没寄出的信', stageTitle: '第 3 场' }],
    speculationStatus: { enabled: true, hits: 0, misses: 8, total: 8, rate: 0, pending: 'user 会因为醉意想宣泄' },
    cost: { callCount: 6, sessionTotal: 6 },
    tone: { daily: 70, crisis: 30, intimate: 0 },
    toneKeys: ['daily', 'crisis', 'intimate'],
    toneLabels: { daily: '日常', crisis: '危机', intimate: '亲密' },
    toneLocked: ['crisis'],
    intensity: 'standard',
    intensityHint: '现状（推荐）：推进语气不变',
    breakFilter: { mode: 'preset', custom: '' },
    modelPreset: { kind: 'gemini', text: '收敛极端控制倾向' },
    sanitize: { enabled: true, rules: [{ pattern: '<status>.*</status>' }] },
    presets: {
      list: ['【Ako】1.9-0517 测试版', '另一个预设'],
      status: { name: '【Ako】1.9-0517 测试版', available: 2, entries: 3, length: 2938, active: true },
      entries: [
        { index: 0, label: '开场引导', enabled: true, selected: true },
        { index: 1, label: 'NSFW 允许', enabled: true, selected: true },
        { index: 2, label: '结局偏好', enabled: true, selected: false },
      ],
    },
    cast: { list: ['罗德里戈', '艾拉'], current: '罗德里戈' },
    profile: {
      fields: { coreDesire: '被需要', fear: '被抛弃' },
      locked: { coreDesire: true },
      generatedAtText: '上次生成：3 轮前',
    },
    profileFields: [
      { key: 'coreDesire', label: '核心欲望' },
      { key: 'fear', label: '恐惧' },
      { key: 'speech', label: '说话方式' },
      { key: 'attitudeToUser', label: '对 user 态度' },
      { key: 'conflictStyle', label: '处理冲突' },
      { key: 'proactivity', label: '主动程度' },
      { key: 'intimacy', label: '亲密表达' },
      { key: 'taboo', label: '禁忌' },
    ],
    world: { sources: [], selection: { 'book-a:0': true } },
    update: { version: '0.7.0', path: null },
    debug: {
      stage: { index: 2, total: 3, title: '幽暗庭院的重逢', goal: 'g', status: 'ready', stuckCount: 0 },
      injection: { registered: true, length: 67, text: '[本场目标] …' },
      speculation: { hits: 0, misses: 8, total: 8, rate: 0, pending: 'user 会因为醉意想宣泄' },
      foreshadows: ['她提过的那封没寄出的信'],
      automation: '大纲 L1 · …',
      cost: { callCount: 6 },
      lastAction: 'settle',
      lastReason: '已达成，先收尾',
      lastRaw: '{"status":"achieved"}',
      lastRequest: 'system: 你是导演…',
      lastJudgement: { status: 'achieved', confidence: 0.82, reason: '边界已建立' },
      lastInjection: { text: '[本场目标] …', speculation: { hit: false, guess: '她说想去海边' } },
      breakStatus: { mode: 'preset', preset: { name: 'Ako', active: true, length: 2938 }, customLength: 0, injected: 2938 },
      turn: {
        charMessageRaw: '<thinking>x</thinking>他停住了',
        charCleaned: '他停住了',
        stance: { source: 'combined', sections: { stance: true, judgement: true, speculation: true } },
      },
    },
    ...patch,
  };
}

function controlsOf(html) {
  return [...html.matchAll(/data-act="([^"]+)"/g)].map((match) => match[1]);
}

const worldSources = [{
  type: 'character', label: '角色卡内嵌',
  books: [{ name: '洛佩兹家', entries: [
    { key: 'book-a:0', name: '罗德里戈的性格', enabled: true, text: 'x'.repeat(320) },
    { key: 'book-a:1', name: '两人的过往', enabled: true, text: 'y'.repeat(810) },
    { key: 'book-a:2', name: '老宅布局', enabled: false, text: 'z'.repeat(240) },
  ] }],
}];

console.log('T-427 面板渲染');

check('三个分类页 + 四个弹层都在', () => {
  const { html } = renderPanel(fakeState(), { worldSources });
  for (const page of ['status', 'editor', 'cast']) assert.ok(html.includes(`data-page="${page}"`), `缺分类页 ${page}`);
  for (const layer of ['world', 'prompt', 'settings', 'debug']) assert.ok(html.includes(`data-layer="${layer}"`), `缺弹层 ${layer}`);
});

check('抬头五个工具图标都在，且日夜图标随配色变', () => {
  const day = renderPanel(fakeState(), { worldSources, palette: 'a' }).html;
  const night = renderPanel(fakeState(), { worldSources, palette: 'b' }).html;
  assert.ok(day.includes('dt-tool-world') && day.includes('dt-tool-prompt') && day.includes('dt-tool-settings'));
  assert.ok(day.includes('shell.theme') && day.includes('shell.debug'));
  assert.notEqual(day, night, '切换配色要换掉日月图标');
  assert.equal(normalizePalette('乱填'), 'a');
});

check('状态行跟着总开关变（启用中 / 已停用）', () => {
  assert.ok(renderPanel(fakeState(), {}).html.includes('启用中 · 第 2 场 / 共 3 场'));
  assert.ok(renderPanel(fakeState({ enabled: false }), {}).html.includes('已停用'));
});

console.log('T-427 定稿 §2.1 验收①：每个控件都有对应动作');

check('界面上每个 data-act 都能在动作表里找到 handler', () => {
  const { html, actions } = renderPanel(fakeState(), { worldSources });
  const missing = [...new Set(controlsOf(html))].filter((name) => typeof actions[name] !== 'function');
  assert.deepEqual(missing, [], `这些控件点了没反应：${missing.join('、')}`);
});

check('动作表里每一项都真的出现在界面上（没有够不着的入口）', () => {
  const { html, actions } = renderPanel(fakeState(), { worldSources });
  const rendered = new Set(controlsOf(html));
  const unreachable = Object.keys(actions).filter((name) => !rendered.has(name));
  assert.deepEqual(unreachable, [], `这些功能界面里够不着：${unreachable.join('、')}`);
});

check('界面上的可点控件数量达到定稿的量级（≥ 40 个 data-act）', () => {
  const { html } = renderPanel(fakeState(), { worldSources });
  const names = new Set(controlsOf(html));
  assert.ok(names.size >= 24, `控件太少（${names.size} 个），是不是漏做了`);
  assert.ok(controlsOf(html).length >= 40, `控件实例太少（${controlsOf(html).length} 个）`);
});

console.log('T-427 空状态不崩（没剧本 / 没侧写 / 没预设 / 没世界书）');

check('空状态全渲染一遍不抛异常', () => {
  const empty = fakeState({
    enabled: false,
    stage: { index: 0, total: 0, active: null },
    stages: [],
    activeStageId: null,
    lastTurn: null,
    queue: [],
    foreshadows: [],
    speculationStatus: { enabled: true, hits: 0, misses: 0, total: 0, rate: 0 },
    presets: { list: [], status: {}, entries: [] },
    cast: { list: [], current: '' },
    profile: { fields: {}, locked: {} },
    tone: { daily: 0, crisis: 0, intimate: 0 },
    world: { sources: [], selection: {} },
    debug: {},
  });
  const { html, actions } = renderPanel(empty, { worldSources: [] });
  assert.ok(html.includes('data-page="status"'));
  assert.ok(Object.keys(actions).length > 10);
  const missing = [...new Set(controlsOf(html))].filter((name) => typeof actions[name] !== 'function');
  assert.deepEqual(missing, []);
});

console.log('T-427 样式与用词的两条 guard');

check('style.css 全部收在 #dt-panel 作用域里（没有裸选择器漏出去）', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const leaked = css.split('\n')
    .filter((line) => /^[.#a-zA-Z*]/.test(line) && line.includes('{'))
    .filter((line) => !/^#dt-panel/.test(line) && !/^@/.test(line) && !/^\s*\/\*/.test(line));
  assert.deepEqual(leaked, [], `这些规则会漏进酒馆页面：\n${leaked.join('\n')}`);
  assert.ok(css.includes('#dt-panel[data-palette="a"]'), '要保留定稿的 A 版配色');
  assert.ok(css.includes('#dt-panel[data-palette="b"]'), '要保留定稿的 B 版配色');
});

console.log('实机塌陷的两类原因（用户截图：面板变成页面里一条）');

check('style.css 不许再用 `inset` 简写（旧引擎不认 → 定位失效 → 面板塌成一条）', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const usesInset = css.split('\n').filter((line) => /(^|[\s{])inset\s*:/.test(line));
  assert.deepEqual(usesInset, [], `这些地方要改成 top/right/bottom/left 四件套：\n${usesInset.join('\n')}`);
});

check('几何用的是"旧版实机验证过的那套配方"（grid 居中，不是 block 居中）', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('place-items:center'), '居中必须靠 place-items:center');
  assert.ok(css.includes('#dt-panel.dt-open{display:grid}'), '打开时是 display:grid（不是 block —— 曾经因此塌成一条）');
  assert.equal(/#dt-panel\.dt-open\{display:block/.test(css), false, '不许再写 display:block');
  assert.ok(css.includes('z-index:10000'), 'z-index 必须是 10000（酒馆自己的层能到几千）');
  assert.ok(css.includes('height:100vh'), '高度要写 100vh');
  assert.ok(css.includes('height:100dvh'), '移动端补 100dvh');
  assert.ok(css.includes('#dt-panel .dt-card{width:100%;max-width:440px;max-height:calc(100vh - 24px)'), '卡片要限宽 + 限高');
});

check('骨架几何与配色写在 JS 内联样式里（外链样式没加载也不能塌、不能变黑字）', () => {
  const code = fs.readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
  assert.ok(code.includes('applyShellStyle'), '外壳样式要集中在一个函数里写');
  assert.ok(code.includes('el.style.cssText'), '根节点要有内联几何');
  assert.ok(code.includes('place-items:center'), '内联几何也要 grid 居中');
  assert.ok(code.includes('z-index:10000'), '内联 z-index 也要 10000');
  assert.ok(code.includes("'grid'"), '打开态显示 grid（居中才行）');
  assert.ok(code.includes('SHELL_VARS'), '配色变量也要内联（外链 CSS 挂了也不会黑字黑底）');
  assert.ok(code.includes('UI_VERSION'), '要有界面版本号（用来判断跑的是不是旧代码）');
});

check('事件走"根节点委托 + 捕获阶段"（宿主的 stopPropagation 拦不住，重绘也不丢）', () => {
  const code = fs.readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
  assert.ok(code.includes('bindDelegated'), '要用委托绑定');
  assert.ok(code.includes("el.addEventListener('click', route, true)"), 'click 要挂捕获阶段（第三个参数 true）');
  assert.ok(code.includes("el.addEventListener('change', route, true)"), 'change 也要捕获阶段');
  assert.equal(code.includes('forEach((element) => {\n      const name = element.dataset.act'), false, '不要再逐元素绑定（实机点不了）');
});

check('点不了的兜底：没打开的弹层不吃点击、卡片自己收事件', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('#dt-panel .dt-layer:not(.dt-layer-on){display:none !important;pointer-events:none !important'), '隐藏的弹层必须既不可见也不吃点击');
  assert.ok(css.includes('#dt-panel button, #dt-panel input, #dt-panel select, #dt-panel textarea, #dt-panel summary, #dt-panel [data-act]{pointer-events:auto !important}'), '控件要能收事件');
});

check('动作出错要显示在界面上（不能只 console.warn）', () => {
  const code = fs.readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
  assert.ok(code.includes('function surface('), '要有一个"出错就往界面写"的出口');
  assert.ok(code.includes('flash(\'global\', text)'), '出错要写到全局提示位');
  assert.ok(code.includes('surface(`控件没有接线：${name}`'), '没接线也要写在界面上');
  assert.ok(code.includes('surface(`动作 ${name} 抛异常：'), '抛异常要写在界面上');
  assert.ok(code.includes('surface(`动作 ${name} 出错：'), '异步出错也要写在界面上');
  // 壳里必须有全局提示位（抬头下方，任何分类页都看得见）
  const { html } = renderPanel(fakeState(), { worldSources });
  assert.ok(html.includes('data-flash="global"'), '壳里要有全局提示位');
  assert.ok(html.indexOf('data-flash="global"') < html.indexOf('dt-tabs'), '提示位要在抬头区（切分类也看得到）');
});

check('面板自带 diagnose()（实机排障：一行看出样式/事件到底通没通）', () => {
  const panel = createMainPanel({ getApi: () => ({ ui: { read: () => fakeState() } }) });
  const result = panel.diagnose();
  assert.equal(result.exists, false, 'Node 里没 DOM，应该如实说没有');
  for (const key of ['position', 'cssLoaded', 'hint', 'controls', 'delegated', 'clicksSeen', 'lastAct', 'lastError', 'hitTest']) {
    assert.ok(key in result, `diagnose 缺字段 ${key}`);
  }
  // inspect 也要能看动作数与事件统计（批复里的 B/C 两步）
  const info = panel.inspect();
  assert.ok(Array.isArray(info.actions));
  assert.ok('stats' in info && typeof info.uiVersion === 'string');
});

check('style.css 里不许出现 `#dt-panel :root`（那是永远匹配不到的后代选择器）', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.equal(css.includes('#dt-panel :root'), false, '写成 #dt-panel :root 的话字体变量永远不生效 —— 必须是 #dt-panel{');
  assert.ok(css.includes('#dt-panel{'), '变量块要挂在 #dt-panel 上');
});

check('预览生成器带 #dt-panel 壳（少这层壳 = 黑底黑字）', async () => {
  const { buildPreviewHtml } = await import('../tools/make-ui-preview.mjs');
  const html = buildPreviewHtml();
  assert.ok(html.includes('id="dt-panel"'), '预览页必须自己带 #dt-panel 壳');
  assert.ok(html.includes('class="dt-open"'), '预览页要是打开态（否则看不到卡片）');
  assert.ok(html.includes('class="dt-card"'), '壳里要有卡片');
  assert.ok(html.includes('#dt-panel .dt-card'), '要带上真实 style.css');
  assert.ok(html.includes('place-items:center'), '预览页也要带上 grid 居中的配方');
});

check('界面里不出现 emoji（定稿 §7：图标用 SVG）', () => {
  const { html } = renderPanel(fakeState(), { worldSources });
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emoji.test(html), false, `界面里有 emoji：${html.match(emoji)?.[0]}`);
});

console.log('T-427 面板本身（无 DOM 环境下不崩）');

check('createMainPanel 在 Node（没有 document）里也是安全的', () => {
  const panel = createMainPanel({ getApi: () => ({ ui: { read: () => fakeState() } }) });
  assert.equal(panel.open(), null, '没有 document 就返回 null，不许抛');
  assert.equal(panel.isOpen(), false);
  panel.refresh();
  const info = panel.inspect();
  assert.ok(Array.isArray(info.actions));
});

console.log('T-427 界面 ↔ 装配：调用的 api 必须真的存在');

/** 起一个真装配（Node 里没有酒馆，用最小 ctx 兜底） */
function bootApi() {
  const meta = {};
  const settingsStore = {};
  const ctx = {
    capabilities: {},
    getExtensionSettings: () => settingsStore,
    saveSettings: () => true,
    getChatState: () => meta,
    saveChatState: () => true,
    getCurrentChatKey: () => 'ui-test',
    getMessages: () => [],
    on: () => () => {},
    showSystemMessage: () => {},
    setExtensionPrompt: () => true,
    clearExtensionPrompt: () => true,
    characters: [{ name: 'C', data: { extensions: {} } }],
    getCharacterId: () => 0,
  };
  const store = createStateStore(ctx, 'director_time');
  return bootstrap({ ctx, store });
}

check('界面模块里出现的 api.xxx 都能在真 api 上找到', () => {
  const api = bootApi();
  const files = ['panel.js', 'render/journal.js', 'render/script.js', 'render/cast.js',
    'render/worldbook.js', 'render/prompts.js', 'render/settings.js', 'render/debug.js'];
  const missing = new Map();
  for (const file of files) {
    const code = fs.readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
    // 注意跳过域名写法（`api.example.com` 那种会误报成接口名）
    for (const match of code.matchAll(/(?<![\w/])api\??\.([a-zA-Z_$][\w$]*)(?![\w$.])/g)) {
      const name = match[1];
      if (!(name in api)) missing.set(name, file);
    }
  }
  assert.deepEqual([...missing.entries()], [], `这些接口不存在：${[...missing.entries()].map(([n, f]) => `${n}（${f}）`).join('、')}`);
});

check('ui.read() 在真装配下给得出界面要的字段', () => {
  const api = bootApi();
  const state = api.ui.read();
  for (const key of ['enabled', 'connection', 'will', 'stages', 'stage', 'injection', 'tone', 'toneKeys',
    'toneLabels', 'intensity', 'breakFilter', 'modelPreset', 'sanitize', 'presets', 'cast', 'profile',
    'profileFields', 'world', 'update', 'debug', 'automationText', 'cost']) {
    assert.ok(key in state, `ui.read() 缺 ${key}`);
  }
  assert.equal(state.profileFields.length, 8, '侧写八个字段要给全');
  // 真状态渲染一遍，确认不崩
  const { html, actions } = renderPanel(state, { worldSources });
  const missing = [...new Set(controlsOf(html))].filter((name) => typeof actions[name] !== 'function');
  assert.deepEqual(missing, []);
});

check('面板入口齐备：panel / settingsPanel / 更新与调试都够得着', () => {
  const api = bootApi();
  assert.equal(typeof api.panel?.open, 'function');
  assert.equal(typeof api.settingsPanel?.show, 'function', '控制台 DirectorTime.settingsPanel.show() 仍要能用');
  assert.equal(typeof api.debug?.show, 'function');
  assert.equal(typeof api.onOpenDebug, 'function');
  assert.equal(typeof api.ui?.saveSettings, 'function');
  assert.equal(typeof api.undo, 'function');
  assert.equal(typeof api.checkUpdate, 'function');
});

console.log('T-428 批复补的三块：档位 / 词库 / 调参 / 调用日志');

check('档位：六个功能点各一个下拉，选中值来自 settings（单一来源）', () => {
  const { html } = renderPanel(fakeState(), { worldSources });
  const selects = [...html.matchAll(/data-act="automation\.set" data-feature="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(selects, ['outline', 'stageRegen', 'profile', 'stanceJudge', 'checkpointJudge', 'consistency']);
  assert.ok(html.includes('>L1 · 待确认</option>'), '下拉里要有 L1 的中文含义');
  assert.ok(html.includes('>L2 · 全自动</option>'));
});

check('词库：四本都在，且带"清空 = 转 LLM"的说明', () => {
  const { html } = renderPanel(fakeState(), { worldSources });
  for (const key of ['strong', 'weak', 'negation', 'irrelevant']) {
    assert.ok(html.includes(`data-act="rules.save" data-key="${key}"`), `缺词库 ${key}`);
  }
  assert.ok(html.includes('清空某一本'), '要写清"清空某一本 = 这一类不判"');
  assert.ok(html.includes('恢复默认词库'));
});

check('调参：六个参数都在，且每个有人话说明', () => {
  const { html } = renderPanel(fakeState(), { worldSources });
  for (const field of ['pacing.min', 'pacing.max', 'maxRounds', 'confidenceThreshold', 'stuckThreshold', 'worldLimit']) {
    assert.ok(html.includes(`data-field="${field}"`), `缺参数 ${field}`);
  }
  assert.ok(html.includes('data-act="params.toggleConsistency"'), '一致性自检开关要有');
  assert.ok(html.includes('连续几轮没推进就强制跳场'), 'stuckThreshold 要有人话说明');
});

check('调用日志表：时间 / 耗时 / tokens / 调用名 / 结果', () => {
  const { html } = renderPanel(fakeState({
    debug: {
      ...fakeState().debug,
      apiLog: [{ at: 1700000000000, ms: 1800, tokens: 1200, label: 'JUDGE_COMBINED', ok: true },
        { at: 1700000001000, ms: 2100, tokens: 0, label: 'GEN_OUTLINE', ok: false, error: '被截断' }],
    },
  }), { worldSources });
  assert.ok(html.includes('导演 API 日志'), html.includes('导演 API 日志'));
  assert.ok(html.includes('JUDGE_COMBINED') && html.includes('GEN_OUTLINE'));
  assert.ok(html.includes('1.8s'), '要显示耗时');
  assert.ok(html.includes('1,200 tok'), '要显示 tokens');
  assert.ok(html.includes('✗ 被截断'), '失败要写原因');
});

check('注入顺序：只读展示 + 明确写"槽位功能没做"', () => {
  const { html } = renderPanel(fakeState(), { worldSources });
  assert.ok(html.includes('注入顺序（只读）'));
  assert.ok(html.includes('槽位排序 / 单槽开关的功能还没做'));
  assert.equal(/data-act="slot\./.test(html), false, '不许画假槽位控件');
});

console.log('T-428 写入路径：档位 / 词库 / 参数 / 调用日志真的落盘');

check('api.setAutomation：改档位写进 settings（单一来源）', () => {
  const api = bootApi();
  api.setAutomation('outline', 'L0');
  assert.equal(api.automation.get().outline, 'L0');
  assert.equal(api.ui.read().automation.levels.outline, 'L0', '界面读到的就是刚改的值');
});

check('api.saveRules：词 = 立场 写进词库；清空 = 这一类不判', () => {
  const api = bootApi();
  const saved = api.saveRules('strong', '好 = accept\n不要 = reject');
  assert.equal(saved.count, 2);
  assert.deepEqual(saved.dropped, []);
  assert.deepEqual(api.rules.get().strong, [{ word: '好', stance: 'accept' }, { word: '不要', stance: 'reject' }]);

  const cleared = api.saveRules('weak', '');
  assert.equal(cleared.count, 0);
  assert.deepEqual(api.rules.get().weak, [], '清空后这一本为空（规则引擎不判这一类，转 LLM）');
});

check('api.saveRules：认不出的立场要回报，不硬猜', () => {
  const api = bootApi();
  const saved = api.saveRules('strong', '好 = 接受的\n不要 = accept');
  assert.deepEqual(saved.dropped, ['好'], '立场认不出的那条要丢掉并回报');
  assert.deepEqual(api.rules.get().strong, [{ word: '不要', stance: 'accept' }]);
});

check('api.saveSettings：六个参数与一致性开关都写进去', () => {
  const api = bootApi();
  api.saveSettings({ pacing: { min: 4, max: 10 }, maxRounds: 20, confidenceThreshold: 0.6, stuckThreshold: 5, worldLimit: 30, consistencyCheck: false });
  const params = api.ui.read().params;
  assert.deepEqual(params.pacing, { min: 4, max: 10 });
  assert.equal(params.maxRounds, 20);
  assert.equal(params.confidenceThreshold, 0.6);
  assert.equal(params.stuckThreshold, 5);
  assert.equal(params.worldLimit, 30);
  assert.equal(params.consistencyCheck, false);
});

check('调用日志：client 每次请求记一条（成功记 tokens、失败记原因）', async () => {
  const { createDirectorClient } = await import('../src/llm/client.js');
  const log = [];
  const ok = createDirectorClient({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"stance":"accept","confidence":0.9}' } }], usage: { total_tokens: 1234 } }),
    }),
    onResult: (entry) => log.push(entry),
  });
  await ok.request({ endpoint: 'https://x/v1', model: 'm', messages: [{ role: 'user', content: 'hi' }], label: 'JUDGE_STANCE' });
  assert.equal(log.length, 1);
  assert.equal(log[0].label, 'JUDGE_STANCE');
  assert.equal(log[0].ok, true);
  assert.equal(log[0].tokens, 1234);
  assert.ok(Number.isFinite(log[0].ms) && log[0].ms >= 0);

  const bad = createDirectorClient({
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'nope' }),
    onResult: (entry) => log.push(entry),
  });
  await bad.request({ endpoint: 'https://x/v1', model: 'm', messages: [], label: 'GEN_OUTLINE' }).catch(() => {});
  assert.equal(log.length, 2);
  assert.equal(log[1].ok, false);
  assert.ok(log[1].error, '失败要记原因');
});

console.log('T-429 调用约定：每个动作都必须能被真的调起来（这次瘫痪的根因）');

/**
 * 约定（**不要再改**）：`handler(元素, { ctx, api, state }, 事件)`。
 * 2026-09-12 瘫痪原因：panel.js 里写成 `handler(target, ctx(), event)` —— 第二个参数是打包对象，
 * 直接把 ctx 传进去 → 每个 handler 里 `(el, { ctx })` 解构出 undefined → 全界面点击都炸。
 * 下面这条测试**真的把每个动作调一遍**，谁破坏了约定立刻红。
 */
function fakeApi() {
  const fn = () => undefined;
  return new Proxy({}, {
    get: (_, key) => {
      if (key === 'then') return undefined; // 别被当成 thenable
      return new Proxy(fn, { get: () => fn, apply: () => undefined });
    },
  });
}

function fakeCtx() {
  return {
    getState: () => ({}),
    setState: () => {},
    setModels: () => {},
    refresh: () => {},
    flash: () => {},
    flashGlobal: () => {},
    busy: () => {},
    busyGlobal: () => {},
    openLayer: () => {},
    closeLayers: () => {},
    backLayer: () => {},
    togglePalette: () => {},
    root: () => null,
    api: fakeApi(),
  };
}

/** 最小元素桩：handler 只读得到这些 */
function fakeElement(act) {
  return {
    dataset: { act, id: 'x1', key: 'strong', field: 'maxRounds', feature: 'outline', index: '0', openLayer: 'world' },
    className: '',
    value: '好 = accept',
    checked: true,
    files: [],
    type: 'checkbox',
    tagName: 'BUTTON',
    textContent: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    focus: () => {},
    setSelectionRange: () => {},
    click: () => {},
    getAttribute: () => '',
  };
}

await acheck('每个动作用约定签名调一遍都不抛（含异步拒绝）', async () => {
  const { html, actions } = renderPanel(fakeState(), { worldSources });
  assert.ok(Object.keys(actions).length >= 30, `动作太少（${Object.keys(actions).length}）`);

  const failures = [];
  for (const [name, handler] of Object.entries(actions)) {
    try {
      const result = handler(fakeElement(name), { ctx: fakeCtx(), api: fakeApi(), state: fakeState() }, { type: 'click' });
      if (result && typeof result.then === 'function') await result;
    } catch (error) {
      failures.push(`${name}: ${error?.message ?? error}`);
    }
  }
  assert.deepEqual(failures, [], `这些动作按约定调用会炸：\n${failures.join('\n')}`);
  assert.ok(html.length > 0);
});

check('panel.js 里必须用约定签名（不许再写回 handler(target, ctx(), event)）', () => {
  const code = fs.readFileSync(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
  assert.equal(code.includes('handler(target, ctx(), event)'), false, '这就是 2026-09-12 全界面瘫痪的直接原因 —— 不许再写回来');
  assert.ok(code.includes('handler(target, { ctx: context, api:'), '约定：handler(元素, { ctx, api, state }, 事件)');
});

console.log(`\n通过 ${passed} 项`);
