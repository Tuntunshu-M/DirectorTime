// UI 重做测试（定稿 §2.1 的两条硬性验收）
//
//   □ 每个控件都有对应动作 —— 点了必须有反应（data-act 必须能在动作表里找到 handler）
//   □ 每个功能都有可达入口 —— 从 UI 真能走到（动作表里的每一项都要真的出现在界面上）
//
// 再加两条不变的 guard：
//   □ 样式全部收在 #dt-panel 作用域里（插件样式不许漏进酒馆）
//   □ 界面里不出现 emoji（定稿 §7：图标代替 emoji）

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  renderPanel, createMainPanel, normalizePalette, UI_VERSION,
  captureDetailsOpen, applyDetailsOpen, captureScroll, applyScroll, describeControl, applyFlash,
} from '../src/ui/panel.js';
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
    // T-438⑤：candidates（酒馆角色卡列表）已随「酒馆里的角色」那一节一起删除
  cast: {
    list: [{ id: '1', name: '罗德里戈' }, { id: '', name: '酒馆老板', manual: true }],
    current: '罗德里戈',
    // T-437：当前已勾选世界书条目里识别出来的角色（本地零调用，等用户勾选）
    // 2026-09-14：按来源分档 —— current = 当前角色卡的书，other = 全局书等
    world: {
      current: {
        stale: false,
      scannedAt: 1,
      scannedCount: 12,
      selectedCount: 18,
      unreadable: 3,
      total: 4,
      truncated: false,
      detected: [
        {
          name: '罗德里戈', count: 9, known: true,
          sources: [{ bookName: '洛佩兹家', entryName: '罗德里戈的性格', entryKey: '洛佩兹家::1', sourceType: 'character', sourceLabel: '角色卡内嵌' }],
        },
        {
          name: '管家 · 莫兰', count: 4, known: false,
          sources: [
            { bookName: '洛佩兹家', entryName: '宅子里的规矩', entryKey: '洛佩兹家::3', sourceType: 'character', sourceLabel: '角色卡内嵌' },
            { bookName: '老宅', entryName: '管家莫兰', entryKey: '老宅::2', sourceType: 'library', sourceLabel: '全部世界书' },
          ],
        },
        {
          name: '莉泽', count: 2, known: false,
          sources: [{ bookName: '老宅', entryName: '夜里的访客', entryKey: '老宅::5', sourceType: 'library', sourceLabel: '全部世界书' }],
        },
      ],
      },
      other: { stale: false, scannedOnce: false, scannedCount: 0, selectedCount: 18, detected: [] },
      // T-438 §2：忽略名单（有它才会渲染「已忽略的名字」那个折叠）
      blocklist: ['路人甲'],
    },
    // T-438 §3：侧写那次调用顺带返回的候选（零额外调用）
    ai: {
      at: 1,
      list: [
        { name: '罗德里戈', aliases: ['Lobo'], confidence: 0.9, evidence: '代号：Lobo，小裴董' },
        { name: '洛佩兹', aliases: [], confidence: 0.4, evidence: '只提了一句' },
      ],
    },
  },
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
  },
  // T-434：没读过的书（懒加载）—— 界面上只显示书名，点一下才读
  {
  type: 'library', label: '其它世界书（未全局启用）',
  books: [{ name: '还没读的大部头', entries: [], lazy: true }],
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

check('UI 文案不许出现"把用户当傻子"的强硬措辞（AGENTS G9）', () => {
  const files = ['panel.js', 'render/journal.js', 'render/script.js', 'render/cast.js',
    'render/worldbook.js', 'render/prompts.js', 'render/settings.js', 'render/debug.js'];
  const banned = ['不懂别动', '别乱改', '别乱动', '别碰', '自己看着办', '傻子', '小白', '慎用', '后果自负'];
  const hits = [];
  for (const file of files) {
    const code = fs.readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
    for (const word of banned) if (code.includes(word)) hits.push(`${file} → "${word}"`);
  }
  assert.deepEqual(hits, [], `这些措辞不许再出现：\n${hits.join('\n')}`);
});

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

console.log('分类页签：点了要真的换页（2026-09-12 实机："点剧本和人物没跳转"）');

/** 某分类页在渲染结果里是不是可见的 */
function pageVisible(html, name) {
  const match = html.match(new RegExp(`<div data-page="${name}"([^>]*)>`));
  assert.ok(match, `渲染结果里没有 ${name} 页`);
  return !/hidden/.test(match[1]);
}

check('三个分类页里，只有当前那个可见', () => {
  const status = renderPanel(fakeState(), { view: 'status' }).html;
  assert.equal(pageVisible(status, 'status'), true, '场记页要可见');
  assert.equal(pageVisible(status, 'editor'), false, '剧本页要藏起来');
  assert.equal(pageVisible(status, 'cast'), false, '人物页要藏起来');

  const editor = renderPanel(fakeState(), { view: 'editor' }).html;
  assert.equal(pageVisible(editor, 'editor'), true, '切到剧本页后要可见');
  assert.equal(pageVisible(editor, 'status'), false, '场记页要让位');
  assert.equal(pageVisible(editor, 'cast'), false);

  const cast = renderPanel(fakeState(), { view: 'cast' }).html;
  assert.equal(pageVisible(cast, 'cast'), true);
  assert.equal(pageVisible(cast, 'editor'), false);
  assert.equal(pageVisible(cast, 'status'), false);
});

check('没传 view 时默认场记页（打开面板的第一屏）', () => {
  const html = renderPanel(fakeState(), {}).html;
  assert.equal(pageVisible(html, 'status'), true);
  assert.equal(pageVisible(html, 'editor'), false);
  assert.equal(pageVisible(html, 'cast'), false);
});

check('页签高亮与显示的那一页一致（不会出现"高亮了却没换页"）', () => {
  for (const view of ['status', 'editor', 'cast']) {
    const html = renderPanel(fakeState(), { view }).html;
    const on = (html.match(/class="dt-tab dt-tab-on"[^>]*data-view="([a-z]+)"/) ?? [])[1];
    assert.equal(on, view, `${view}：高亮的是 ${on}`);
    assert.equal(pageVisible(html, view), true, `${view}：高亮的页必须可见`);
  }
});

check('点页签 = 记住新分类 + 重绘（动作真的这么做）', () => {
  const { actions } = renderPanel(fakeState(), { view: 'status' });
  const calls = [];
  const ctx = { setState: (patch) => calls.push(patch), refresh: () => calls.push('refresh') };
  actions['shell.tab']({ dataset: { view: 'editor' } }, { ctx, api: fakeApi(), state: fakeState() });
  assert.deepEqual(calls[0], { view: 'editor', layer: null }, '要把 view 记下来并关掉弹层');
  assert.equal(calls[1], 'refresh', '要重绘才看得到切换');
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

console.log('T-430 · 检查更新的三态（不许再说"已是最新"骗人）');

await acheck('update.check：远程有新版本 → 提示点「更新插件」，并刷新状态行', async () => {
  const { actions } = renderPanel(fakeState(), { worldSources });
  const flashes = [];
  let refreshed = 0;
  const ctx = { ...fakeCtx(), flash: (key, text) => flashes.push(text), refresh: () => { refreshed += 1; } };
  await actions['update.check'](fakeElement('update.check'), {
    ctx,
    api: { checkUpdate: async () => ({ ok: true, local: '0.10.0', remote: '0.11.0', hasUpdate: true }) },
    state: fakeState(),
  });
  assert.ok(flashes.at(-1).includes('新版本 v0.11.0'), flashes.join(' | '));
  assert.ok(flashes.at(-1).includes('更新插件'), flashes.at(-1));
  assert.equal(refreshed, 1, '状态行要跟着刷');
});

await acheck('update.check：确实最新 → 说已是最新', async () => {
  const { actions } = renderPanel(fakeState(), { worldSources });
  const flashes = [];
  const ctx = { ...fakeCtx(), flash: (key, text) => flashes.push(text) };
  await actions['update.check'](fakeElement('update.check'), {
    ctx,
    api: { checkUpdate: async () => ({ ok: true, local: '0.10.0', remote: '0.10.0', hasUpdate: false }) },
    state: fakeState(),
  });
  assert.ok(flashes.at(-1).includes('已是最新'), flashes.at(-1));
});

await acheck('update.check：查不到远程 → 如实说原因，**不能**显示已是最新', async () => {
  const { actions } = renderPanel(fakeState(), { worldSources });
  const flashes = [];
  const ctx = { ...fakeCtx(), flash: (key, text) => flashes.push(text) };
  await actions['update.check'](fakeElement('update.check'), {
    ctx,
    api: { checkUpdate: async () => ({ ok: false, reason: 'network', message: '连不上 GitHub，查不到有没有新版本 · 当前 v0.10.0' }) },
    state: fakeState(),
  });
  assert.equal(flashes.at(-1).includes('已是最新'), false, `查不到却说最新：${flashes.at(-1)}`);
  assert.ok(flashes.at(-1).includes('GitHub'), flashes.at(-1));
});

check('设置层底部：有远程检查结果时显示状态行（有新版本明写出来）', () => {
  const update = renderPanel(fakeState({ update: { checked: { ok: true, local: '0.10.0', remote: '0.11.0', hasUpdate: true } } }), { layer: 'settings' }).html;
  assert.ok(update.includes('有新版本 v0.11.0'), '有新版本要在面板上明写');

  const latest = renderPanel(fakeState({ update: { checked: { ok: true, local: '0.10.0', remote: '0.10.0', hasUpdate: false } } }), { layer: 'settings' }).html;
  assert.equal(latest.includes('有新版本'), false, '最新就别写着有新版本');

  const failed = renderPanel(fakeState({ update: { checked: { ok: false, reason: 'network' } } }), { layer: 'settings' }).html;
  assert.ok(failed.includes('上次没查到'), '查不到要如实说，不能装作没事');
});

console.log('2026-09-14 · 重绘不该让界面"回归原始状态"（反馈 #4/#5）');

check('折叠状态：收起/展开都记住，重绘后照原样放回', () => {
  const map = captureDetailsOpen([
    { dataset: { key: 'settings.tone' }, open: false },
    { dataset: { key: 'prompt.presets' }, open: true },
  ]);
  assert.deepEqual(map, { 'settings.tone': false, 'prompt.presets': true });

  // 重绘后是全新的节点，默认值可能相反 —— 必须被放回去
  const fresh = [
    { dataset: { key: 'settings.tone' }, open: true },
    { dataset: { key: 'prompt.presets' }, open: false },
  ];
  applyDetailsOpen(fresh, map);
  assert.equal(fresh[0].open, false, '刚收起的要还它收起');
  assert.equal(fresh[1].open, true, '刚展开的要还它展开');
});

check('没有 data-key 的折叠块不记（免得张冠李戴）', () => {
  assert.deepEqual(captureDetailsOpen([{ dataset: {}, open: true }]), {});
  applyDetailsOpen([{ dataset: {}, open: false }], { '': true }); // 不该炸
});

check('滚动位置：按 data-scroll 记住并放回（列表不跳回顶部）', () => {
  const map = captureScroll([{ dataset: { scroll: 'layer:world' }, scrollTop: 420 }]);
  assert.deepEqual(map, { 'layer:world': 420 });
  const node = { dataset: { scroll: 'layer:world' }, scrollTop: 0 };
  applyScroll([node], map);
  assert.equal(node.scrollTop, 420);
});

check('提示文案：重绘后要还在（以前 flash 完紧跟 refresh = 闪一下就没）', () => {
  const node = { dataset: { flash: 'journal' }, hidden: true, textContent: '' };
  applyFlash([node], { journal: '已保存：pacing.min = 4' });
  assert.equal(node.hidden, false, '要显示出来');
  assert.equal(node.textContent, '已保存：pacing.min = 4');

  const untouched = { dataset: { flash: 'params' }, hidden: true, textContent: '' };
  applyFlash([untouched], { journal: 'x' });
  assert.equal(untouched.hidden, true, '没记录的提示位不许乱写');
});

check('焦点键：同一个动作的多个控件靠 data-key 区分（不然焦点还错地方）', () => {
  const a = describeControl({ dataset: { act: 'rules.save', key: 'strong' } });
  const b = describeControl({ dataset: { act: 'rules.save', key: 'weak' } });
  assert.notEqual(a, b);
  assert.equal(describeControl({ dataset: {} }), '');
});

check('界面里每个折叠块都有 data-key（不然用户折的它记不住）', () => {
  const { html } = renderPanel(fakeState(), { layer: 'settings', worldSources });
  const details = html.match(/<details[^>]*>/g) ?? [];
  assert.ok(details.length >= 8, `折叠块太少（${details.length}）`);
  for (const tag of details) assert.ok(tag.includes('data-key='), `折叠块缺 data-key：${tag}`);

  // 面板的两个滚动容器也要带 data-scroll
  assert.ok(html.includes('data-scroll="body"'), '分类页容器要有 data-scroll');
  assert.ok(html.includes('data-scroll="layer:settings"'), '弹层内容区要有 data-scroll');
});

check('#6 破限预设默认折叠；设置的「导演 API」仍默认展开', () => {
  const { html } = renderPanel(fakeState(), { layer: 'prompt', worldSources });
  assert.ok(html.includes('<details data-key="prompt.presets">'), '破限预设要默认折叠');
  assert.ok(html.includes('<details open data-key="settings.api">'), '导演 API 仍是主入口，默认展开');
});

check('#3 世界书：每本书默认折叠（几百本也不铺屏），且带 data-key', () => {
  const { html } = renderPanel(fakeState(), { worldSources });
  const books = html.match(/<details class="dt-book"[^>]*>/g) ?? [];
  assert.ok(books.length > 0, '测试数据里应该有书');
  for (const tag of books) {
    assert.equal(/\sopen(\s|>)/.test(tag), false, `书必须默认折叠：${tag}`);
    assert.ok(tag.includes('data-key="book:'), `书要带 data-key：${tag}`);
  }
});

check('#2 场记：有「剧情走向」输入框，值来自 settings.premise', () => {
  const { html } = renderPanel(fakeState({ premise: '让他先挑明，别太快和解' }), { worldSources });
  assert.ok(html.includes('data-act="journal.premise"'), '要有输入框');
  assert.ok(html.includes('让他先挑明，别太快和解'), '要回显已存的值');
});

await acheck('#2 改「剧情走向」→ 存进 settings，且**不重绘**（打字不被打断）', async () => {
  const { actions } = renderPanel(fakeState(), { worldSources });
  const saved = [];
  let refreshed = 0;
  await actions['journal.premise']({ value: '让他先挑明' }, {
    ctx: { ...fakeCtx(), refresh: () => { refreshed += 1; } },
    api: { saveSettings: (patch) => saved.push(patch) },
    state: fakeState(),
  });
  assert.deepEqual(saved, [{ premise: '让他先挑明' }]);
  assert.equal(refreshed, 0, '打字时不要重绘');
});

await acheck('#1 破限预设：全选 / 全不选都调 selectEntries（全不选带 none 标记）', async () => {
  const state = fakeState({
    presets: {
      list: ['P'],
      status: { name: 'P', length: 10, active: true },
      entries: [{ index: 0, name: '一', selected: true }, { index: 1, name: '二', selected: false }],
    },
  });
  const { actions } = renderPanel(state, { worldSources });
  const calls = [];
  const api = { presets: { selectEntries: (...args) => calls.push(args) } };

  await actions['presets.all'](fakeElement('presets.all'), { ctx: fakeCtx(), api, state });
  await actions['presets.none'](fakeElement('presets.none'), { ctx: fakeCtx(), api, state });

  assert.deepEqual(calls[0], [[0, 1]], '全选传全部下标');
  assert.deepEqual(calls[1], [[], { none: true }], '全不选要显式说明"一个都不要"');
});

check('#1 勾到最后一条取消 → 传的是「全不选」而不是空数组（以前会回弹成全部）', () => {
  const state = fakeState({
    presets: {
      list: ['P'],
      status: { name: 'P' },
      entries: [{ index: 0, name: '一', selected: true }, { index: 1, name: '二', selected: false }],
    },
  });
  const { actions } = renderPanel(state, { worldSources });
  const calls = [];
  const api = { presets: { selectEntries: (...args) => calls.push(args) } };
  const el = { ...fakeElement('presets.entry'), dataset: { act: 'presets.entry', index: '0' }, checked: false };

  actions['presets.entry'](el, { ctx: fakeCtx(), api, state });
  assert.deepEqual(calls[0], [[], { none: true }], '取消到一条不剩 = 全不选');
});

check('#4 偏好：锁住的线按钮写「已锁」', () => {
  const locked = renderPanel(fakeState({ toneLocked: ['daily'] }), { worldSources }).html;
  assert.ok(/data-act="tone\.lock" data-key="daily"[^>]*>已锁</.test(locked), '锁住的要显示已锁');

  const plain = renderPanel(fakeState({ toneLocked: [] }), { worldSources }).html;
  assert.ok(/data-act="tone\.lock" data-key="daily"[^>]*>锁</.test(plain), '没锁的显示"锁"');
});

await acheck('#4 点锁 → tone.set 带上新的 locked 数组', async () => {
  const state = fakeState({ toneLocked: [], tone: { daily: 70, crisis: 30, intimate: 0 } });
  const { actions } = renderPanel(state, { worldSources });
  const calls = [];
  const api = { tone: { set: (...args) => calls.push(args) } };
  const el = { ...fakeElement('tone.lock'), dataset: { act: 'tone.lock', key: 'daily' } };

  await actions['tone.lock'](el, { ctx: fakeCtx(), api, state });
  assert.equal(calls[0][0], 'daily');
  assert.deepEqual(calls[0][2], ['daily'], '要把 daily 加进锁列表');

  // 再点一次 = 解锁
  const state2 = fakeState({ toneLocked: ['daily'] });
  const { actions: actions2 } = renderPanel(state2, { worldSources });
  const calls2 = [];
  await actions2['tone.lock'](el, { ctx: fakeCtx(), api: { tone: { set: (...args) => calls2.push(args) } }, state: state2 });
  assert.deepEqual(calls2[0][2], [], '再点一次要解锁');
});

console.log('T-434 · 世界书懒加载（展开哪本才读哪本）');

check('没读过的书：只显示书名 + 「点开即读取」，不铺条目', () => {
  const { html } = renderPanel(fakeState(), { layer: 'world', worldSources });
  assert.ok(html.includes('data-act="world.readBook"'), '书名的 summary 要能触发读取');
  assert.ok(html.includes('data-book="还没读的大部头"'), '要带上书名');
  assert.ok(html.includes('点开即读取'), '要让用户知道点一下才读');
  assert.ok(html.includes('还没读 · 1 本'), '要有「还没读」分组');
  // 读过的书照旧平铺条目
  assert.ok(html.includes('罗德里戈的性格'));
});

check('工具栏：有没读过的书时才有「读取全部 N 本」', () => {
  const withLazy = renderPanel(fakeState(), { layer: 'world', worldSources }).html;
  assert.ok(withLazy.includes('data-act="world.readAll"'));
  assert.ok(withLazy.includes('读取全部 1 本'));

  const allLoaded = renderPanel(fakeState(), {
    layer: 'world',
    worldSources: [worldSources[0]],
  }).html;
  assert.equal(allLoaded.includes('data-act="world.readAll"'), false, '都读过了就别显示按钮');
});

await acheck('点书名 → 只读这一本 + 把这块摊开 + 刷新', async () => {
  const { actions } = renderPanel(fakeState(), { layer: 'world', worldSources });
  const loaded = [];
  const state = fakeState();
  const sources = await actions['world.readBook'](
    { ...fakeElement('world.readBook'), dataset: { act: 'world.readBook', book: '还没读的大部头', key: 'book:library:还没读的大部头' } },
    {
      ctx: { ...fakeCtx(), openKey: (...args) => loaded.push(['openKey', ...args]) },
      api: {
        loadWorldBook: async (name) => { loaded.push(['read', name]); return { name, entries: [{ key: `${name}::0`, name: '条目', text: 'x' }] }; },
        loadWorldSources: async () => worldSources,
      },
      state,
    },
  );
  void sources;
  assert.ok(loaded.some(([kind, name]) => kind === 'read' && name === '还没读的大部头'), '要真去读那一本');
  assert.ok(loaded.some(([kind]) => kind === 'openKey'), '读完要把这块标成展开');
});

await acheck('「读取全部」→ 每本没读过的都读一遍', async () => {
  const state = fakeState({ world: { sources: worldSources, selection: {}, stats: { count: 0, tokens: 0, unknown: 0 } } });
  const { actions } = renderPanel(state, { layer: 'world', worldSources });
  const read = [];
  await actions['world.readAll'](fakeElement('world.readAll'), {
    ctx: fakeCtx(),
    api: {
      loadWorldBook: async (name) => { read.push(name); return { name, entries: [] }; },
      loadWorldSources: async () => worldSources,
    },
    state,
  });
  assert.deepEqual(read, ['还没读的大部头']);
});

check('底部：条数/token 走核心统计（含"还没读过"的说明）', () => {
  const { html } = renderPanel(fakeState({
    world: {
      sources: [],
      selection: { 'a::0': true, '没读过的书::3': true },
      stats: { count: 2, tokens: 640, unknown: 1, approx: true },
    },
  }), { layer: 'world', worldSources });
  assert.ok(html.includes('已选 2 条'), '缺条数');
  assert.ok(html.includes('约 640 tokens'));
  assert.ok(html.includes('1 条还没读过'), '要如实说明有一本没读过、按已知估算');

  const exact = renderPanel(fakeState({
    world: { sources: [], selection: {}, stats: { count: 3, tokens: 100, unknown: 0, approx: false } },
  }), { layer: 'world', worldSources }).html;
  assert.equal(exact.includes('还没读过'), false, '都读过了就别提');
});

console.log('T-436 · 人物页：多人卡自选');

check('T-438⑤：「酒馆里的角色（自动识别）」那一节彻底移除，手填入口保留', () => {
  const { html } = renderPanel(fakeState(), { view: 'cast' });
  assert.equal(html.includes('酒馆里的角色'), false, '那一节必须消失（HTML 里搜不到这句文案）');
  assert.equal(html.includes('data-act="cast.toggle"'), false, '角色卡勾选控件也该没了');
  assert.equal(html.includes('data-key="cast.cards"'), false, '那一节是删掉，不是折叠起来');

  assert.ok(html.includes('data-act="cast.add"'), '手填入口要保留（用户明确要）');
  assert.ok(html.includes('placeholder="NPC 名字'), '输入框提示保留');
  assert.ok(html.includes('data-act="cast.remove"'), '手填的要能移除');
  assert.ok(html.includes('酒馆老板'), '手填进来的 NPC 要列出来');
  // 2026-09-15 实机反馈：手填区原来渲染了**两遍**一模一样的输入框 —— 现在只许一份（输入框 + 按钮各一次）
  assert.equal((html.match(/data-act="cast\.add"/g) ?? []).length, 2, '手填区不许重复渲染');
});

check('当前生成者没勾 → 明确提醒"注入会被清空"', () => {
  const unchecked = renderPanel(fakeState({
    cast: { list: [{ id: '', name: '酒馆老板', manual: true }], current: '罗德里戈' },
  }), { view: 'cast' }).html;
  assert.ok(unchecked.includes('当前生成者不在名单里'), '要提醒');

  const checked = renderPanel(fakeState(), { view: 'cast' }).html;
  assert.equal(checked.includes('当前生成者不在名单里'), false, '勾上了就别吓唬人');
});

await acheck('手填 NPC：点「添加」读输入框；输入框回车用自己的值；空值不提交', async () => {
  const { actions } = renderPanel(fakeState(), { view: 'cast' });
  const added = [];
  const api = { cast: { get: () => [], add: (name) => { added.push(name); return [{ id: '', name, manual: true }]; } } };

  const input = { ...fakeElement('cast.add'), tagName: 'INPUT', value: '酒馆老板' };
  await actions['cast.add'](input, { ctx: fakeCtx(), api, state: fakeState() });
  assert.deepEqual(added, ['酒馆老板'], '输入框回车用自己的值');

  let rootValue = '老板娘';
  const ctx = { ...fakeCtx(), root: () => ({ querySelector: () => ({ value: rootValue }) }) };
  await actions['cast.add']({ ...fakeElement('cast.add'), tagName: 'BUTTON' }, { ctx, api, state: fakeState() });
  assert.deepEqual(added, ['酒馆老板', '老板娘'], '点按钮时去读输入框');

  rootValue = '   ';
  await actions['cast.add']({ ...fakeElement('cast.add'), tagName: 'BUTTON' }, { ctx, api, state: fakeState() });
  assert.equal(added.length, 2, '空值不该提交');
});

console.log('T-437 · 人物页：世界书里的角色（候选，等用户勾选）');

check('候选区：计数行 + 已添加/候选分组 + 勾选框 + 来源标签 + 出处', () => {
  const { html } = renderPanel(fakeState(), { view: 'cast' });
  assert.ok(html.includes('候选角色（本地识别 + 侧写搭车，都不额外花钱）'), '要有这一节');
  assert.ok(html.includes('扫了 12 条 / 共勾选 18 条'), '要显示"扫了 X 条 / 共勾选 Y 条"');
  assert.ok(html.includes('3 条读不到内容'), '拿不到内容的条目要如实说');
  assert.ok(html.includes('data-act="cast.rescan"'), '要有「重新识别」');
  assert.ok(html.includes('data-act="cast.worldToggle"'), '候选要能勾选');
  assert.ok(/data-act="cast\.worldToggle" data-name="罗德里戈"[^>]*checked/.test(html), '已在名单里的默认勾上');
  assert.ok(!/data-act="cast\.worldToggle" data-name="莉泽"[^>]*checked/.test(html), '没加入的绝不自动勾');
  assert.ok(html.includes('出现 9 次 · 出自 1 条') && html.includes('出现 4 次 · 出自 2 条'), '次数与出处要写出来');
  assert.ok(html.includes('data-act="cast.worldEntry"'), '条目名要能点（跳到世界书那一本）');
  assert.ok(html.includes('已添加（1）') && html.includes('候选（2）'), '已添加与候选分开列');
  // T-438 §3-④：来源标签要标出来（本地·当前卡 / 本地·其它书）
  assert.ok(html.includes('<span class="dt-chip">本地·当前卡</span>'), '本地来源要标注');
  assert.ok(html.includes('不额外花钱'), '要告诉用户"生成侧写能让识别更准，且不额外花钱"');
});

check('T-438③：侧写搭车回来的候选进候选区（标 AI + 别名 + 证据 + 低置信度折叠）', () => {
  const { html } = renderPanel(fakeState(), { view: 'cast' });
  assert.ok(html.includes('<span class="dt-chip">AI</span>'), '要标 AI 来源');
  assert.ok(html.includes('别名：Lobo'), '别名要显示出来（花名问题靠它）');
  assert.ok(html.includes('证据：代号：Lobo，小裴董'), '证据（原文摘录）要显示出来');
  assert.ok(html.includes('低置信度（AI 拿不准的 1）'), 'confidence < 0.65 的行要进折叠、不占主候选');
  assert.equal((html.match(/data-act="cast\.worldToggle" data-name="洛佩兹"/g) ?? []).length, 1,
    '低置信度的候选行只出现一次（不占主候选位）');
  // 名字 + 别名去重：AI 的「罗德里戈（别名 Lobo）」与本地那行合成一行
  assert.equal((html.match(/data-name="罗德里戈"/g) ?? []).length, 1, '别名归并后只留一行');
});

check('世界书识别出来的角色不再出现在「自选（手填）」那一列（同名只出现一次）', () => {
  const html = renderPanel(fakeState({
    cast: {
      list: [{ id: '', name: '莉泽' }],
      current: '',
      world: {
        current: {
          stale: false, scannedOnce: true, scannedCount: 1, selectedCount: 1, unreadable: 0, total: 1, truncated: false,
          detected: [{ name: '莉泽', count: 3, known: false, sources: [{ bookName: '老宅', entryName: '夜里的访客', entryKey: '老宅::5', sourceType: 'library' }] }],
        },
        other: { stale: false, scannedOnce: false, scannedCount: 0, selectedCount: 1, detected: [] },
      },
    },
  }), { view: 'cast' }).html;
  assert.equal((html.match(/data-name="莉泽"/g) ?? []).length, 1, '同一名字只能出现一次');
  assert.ok(html.includes('已添加（1）'), '它应该只在世界书那节的「已添加」里');
  assert.equal(html.includes('data-act="cast.remove"'), false, '识别出来的不该再占一个手填位');
});

check('没勾选任何世界书条目 / 还没扫过时如实说明，不报错', () => {
  const nothing = renderPanel(fakeState({
    cast: { list: [], current: '', world: { current: { stale: false, selectedCount: 0, scannedCount: 0, detected: [] }, other: { stale: false, selectedCount: 0, detected: [] } } },
  }), { view: 'cast' }).html;
  assert.ok(nothing.includes('还没有勾选世界书条目'), '要告诉用户去勾世界书');

  const stale = renderPanel(fakeState({
    cast: { list: [], current: '', world: { current: { stale: true, scannedOnce: false, selectedCount: 4, scannedCount: 0, detected: [] }, other: { stale: false, selectedCount: 4, detected: [] } } },
  }), { view: 'cast' }).html;
  assert.ok(stale.includes('正在识别'), '过期时别显示假的旧数字');
});

await acheck('勾选候选 → api.cast.toggleWorld（只传名字）；「重新识别」→ api.scanWorldCast', async () => {
  const { actions } = renderPanel(fakeState(), { view: 'cast' });
  const toggled = [];
  let scanned = 0;
  const api = {
    cast: { toggleWorld: (name) => { toggled.push(name); return [{ id: '', name }]; } },
    scanWorldCast: async () => { scanned += 1; return { scannedCount: 3, selectedCount: 4, detected: [{ name: '莉泽' }] }; },
  };

  await actions['cast.worldToggle'](
    { ...fakeElement('cast.worldToggle'), dataset: { act: 'cast.worldToggle', name: '莉泽' } },
    { ctx: fakeCtx(), api, state: fakeState() },
  );
  assert.deepEqual(toggled, ['莉泽'], '勾选候选要真的写进主角名单');

  await actions['cast.rescan'](fakeElement('cast.rescan'), { ctx: fakeCtx(), api, state: fakeState() });
  assert.equal(scanned, 1, '「重新识别」要真去重扫一遍');
});

console.log('T-438② · 候选「忽略」');

check('T-438④：手填的名字带「手填」标签，且低置信度也留在主候选（用户点名的优先）', () => {
  const { html } = renderPanel(fakeState({
    cast: {
      list: [{ id: '', name: '酒馆老板', manual: true }],
      current: '',
      world: {
        current: { stale: false, scannedOnce: true, scannedCount: 1, selectedCount: 1, unreadable: 0, detected: [] },
        other: { stale: false, scannedCount: 0, detected: [] },
      },
      ai: { at: 1, list: [{ name: '酒馆老板', aliases: [], confidence: 0.2, evidence: '资料里没写，用户点的名' }] },
    },
  }), { view: 'cast' });

  assert.ok(/data-act="cast\.worldToggle" data-name="酒馆老板"/.test(html),
    '手填的名字要留在候选里（模型说拿不准不算数）');
  assert.equal(html.includes('低置信度'), false, '手填的豁免低置信度折叠');
  assert.equal((html.match(/<span class="dt-chip">手填<\/span>/g) ?? []).length, 2,
    '候选行 + 自选行各标一次「手填」');
});

check('候选行有「忽略」，已加入主角的行没有（主角永不被忽略）', () => {
  const { html } = renderPanel(fakeState(), { view: 'cast' });
  assert.ok(html.includes('data-act="cast.worldIgnore"'), '候选项要有「忽略」按钮');
  assert.ok(/data-act="cast\.worldIgnore" data-name="莉泽"/.test(html), '未勾选的候选才给忽略按钮');
  assert.equal(/data-act="cast\.worldIgnore" data-name="罗德里戈"/.test(html), false,
    '已在名单里的（主角）不给忽略按钮');
  assert.ok(html.includes('已忽略的名字（1）'), '要有「已忽略的名字」折叠');
  assert.ok(html.includes('data-act="cast.worldUnignore"'), '已忽略的要能恢复');
});

await acheck('点忽略 → api.cast.ignoreWorldCast；点恢复 → api.cast.unignoreWorldCast', async () => {
  const { actions } = renderPanel(fakeState(), { view: 'cast' });
  const calls = [];
  const api = {
    cast: {
      ignoreWorldCast: (name) => { calls.push(['ignore', name]); return [name]; },
      unignoreWorldCast: (name) => { calls.push(['unignore', name]); return []; },
    },
  };
  await actions['cast.worldIgnore'](
    { ...fakeElement('cast.worldIgnore'), dataset: { act: 'cast.worldIgnore', name: '莉泽' } },
    { ctx: fakeCtx(), api, state: fakeState() },
  );
  await actions['cast.worldUnignore'](
    { ...fakeElement('cast.worldUnignore'), dataset: { act: 'cast.worldUnignore', name: '路人甲' } },
    { ctx: fakeCtx(), api, state: fakeState() },
  );
  assert.deepEqual(calls, [['ignore', '莉泽'], ['unignore', '路人甲']]);
});

console.log('版本号一致性（防再次漂移）');

check('UI_VERSION === manifest.version === package.json version', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  assert.match(UI_VERSION, /^\d+\.\d+\.\d+$/, `UI_VERSION 得像版本号：${UI_VERSION}`);
  assert.equal(UI_VERSION, manifest.version, '界面版本号必须与 manifest.json 一致（不然更新后会互相打脸）');
  assert.equal(pkg.version, manifest.version, 'package.json 必须与 manifest.json 一致');
});

console.log(`\n通过 ${passed} 项`);
