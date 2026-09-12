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

console.log(`\n通过 ${passed} 项`);
