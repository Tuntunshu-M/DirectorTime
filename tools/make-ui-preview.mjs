// 导演时间 · UI 静态预览生成器
//
// 用途：不装插件也能在浏览器里看/点整套界面（用**真实渲染函数 + 真实 style.css**）。
//   node tools/make-ui-preview.mjs [输出路径]
// 默认输出到仓库外的文档目录（仓库只留代码 + README）。
//
// ⚠️ 这里必须输出 `#dt-panel` 那层壳 —— style.css 的所有选择器都在 `#dt-panel` 作用域里，
// 少了这层壳 → CSS 变量全部未定义 → 卡片透明、文字变黑（2026-09-12 踩过，别再犯）。
// tests/ui.test.mjs 有一条断言专门盯着这件事。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPanel } from '../src/ui/panel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/** 预览用的假状态（覆盖每个渲染分支：有剧本、有侧写、有预设、有调用日志、有伏笔） */
export function demoState() {
  return {
    enabled: true,
    version: '—',
    connection: { mode: 'independent', endpoint: 'https://api.example.com/v1', apiKey: 'sk-demo-key', model: 'gemini-2.0-flash' },
    will: 80,
    forceAffection: false,
    speculation: true,
    hardLimits: ['任何形式的公开羞辱', '提及 char 的前任'],
    params: { pacing: { min: 3, max: 8 }, maxRounds: 15, confidenceThreshold: 0.7, stuckThreshold: 3, worldLimit: 20, consistencyCheck: true },
    automation: {
      levels: { outline: 'L1', stageRegen: 'L1', profile: 'L1', stanceJudge: 'L2', checkpointJudge: 'L2', consistency: 'L2' },
      features: ['outline', 'stageRegen', 'profile', 'stanceJudge', 'checkpointJudge', 'consistency'],
      featureLabels: { outline: '大纲', stageRegen: '阶段重生成', profile: '侧写', stanceJudge: '立场判定', checkpointJudge: '推进点判定', consistency: '一致性自检' },
      levelList: ['L0', 'L1', 'L2'],
      levelLabels: { L0: '全手动', L1: '待确认', L2: '全自动' },
    },
    rules: {
      keys: ['strong', 'weak', 'negation', 'irrelevant'],
      labels: { strong: '强词（直接表态）', weak: '弱词（含糊）', negation: '否定（反转）', irrelevant: '转向（聊别的）' },
      texts: {
        strong: '好 = accept\n走吧 = accept\n不要 = reject\n不想去 = reject',
        weak: '嗯 = hesitate\n也许 = hesitate\n再说吧 = hesitate',
        negation: '不\n没\n别',
        irrelevant: '今天天气\n吃什么\n你叫什么',
      },
    },
    stage: { index: 6, total: 8, active: { id: 's6', title: '幽暗庭院的重逢', goal: 'char 强行拉开与 user 的距离，并建立必要的行为边界', status: 'ready', stuckCount: 0, turnCount: 7 } },
    stages: [
      { id: 's5', index: 5, title: '走廊里的对峙', goal: 'char 把话挑明', beats: ['停步', '转身'], status: 'done', locked: false, turnCount: 5 },
      { id: 's6', index: 6, title: '幽暗庭院的重逢', goal: 'char 强行拉开与 user 的距离，并建立必要的行为边界', beats: ['char 后退半步，把话停在客气而疏远的措辞上', 'char 明确说出"到此为止"，然后转身'], status: 'ready', locked: true, turnCount: 7 },
      { id: 's7', index: 7, title: '露台上的对话', goal: 'char 把没说完的说完', beats: [], status: 'pending', locked: false, turnCount: 0 },
      { id: 's8', index: 8, title: '天亮之前', goal: 'char 做出选择', beats: [], status: 'pending', locked: false, turnCount: 0 },
    ],
    activeStageId: 's6',
    automationText: '大纲 L1 · 阶段重生成 L1 · 侧写 L1 · 立场判定 L2 · 推进点判定 L2 · 一致性自检 L2',
    injection: { registered: true, length: 67, text: '[本场目标] 把距离拉开，这一楼只做收尾' },
    lastTurn: {
      action: 'settle', reason: '已达成，本场还差 1 楼，先收尾',
      charMessageRaw: '<thinking>她追上来了，我该回头吗？</thinking>\n他停住了',
      charCleaned: '他停住了',
      stance: { source: 'combined', sections: { stance: true, judgement: true, speculation: true } },
    },
    queue: [{ id: 'q1', feature: 'stageRegen', summary: '续写 2 个阶段：露台上的对话、天亮之前' }],
    foreshadows: [{ id: 'fs1', text: '她提过的那封没寄出的信', stageTitle: '第 3 场' }],
    speculationStatus: { enabled: true, hits: 0, misses: 8, total: 8, rate: 0, pending: 'user 会因为极度的醉意和失落想宣泄' },
    cost: { callCount: 6, sessionTotal: 6 },
    tone: { daily: 70, crisis: 30, intimate: 0 },
    toneKeys: ['daily', 'crisis', 'intimate'],
    toneLabels: { daily: '日常', crisis: '危机', intimate: '亲密' },
    toneLocked: ['crisis'],
    intensity: 'standard',
    intensityHint: '现状（推荐）：推进语气不变',
    breakFilter: { mode: 'preset', custom: '' },
    modelPreset: { kind: 'gemini', text: '收敛极端的控制倾向，让角色保持分寸感' },
    sanitize: { enabled: true, rules: [{ pattern: '<status>.*</status>' }] },
    presets: {
      list: ['【Ako】1.9-0517 测试版', '另一个预设'],
      status: { name: '【Ako】1.9-0517 测试版', available: 2, entries: 3, length: 2938, active: true },
      entries: [
        { index: 0, label: '开场引导', enabled: true, selected: true },
        { index: 1, label: 'NSFW 允许', enabled: true, selected: true },
        { index: 2, label: '叙述风格', enabled: true, selected: true },
        { index: 3, label: '结局偏好', enabled: true, selected: false },
      ],
    },
    cast: { list: ['罗德里戈', '艾拉', '管家 · 莫兰'], current: '罗德里戈' },
    profile: {
      fields: { coreDesire: '被 user 需要，但不想承认', fear: '被抛弃', speech: '简短，喜欢反问', attitudeToUser: '表面冷淡，实际非常在意', conflictStyle: '先退一步，然后迂回达成目的', proactivity: '中偏高', intimacy: '用行动而非语言', taboo: '绝不当众示弱' },
      locked: { coreDesire: true, conflictStyle: true },
      generatedAtText: '上次生成：3 轮前',
    },
    profileFields: [
      { key: 'coreDesire', label: '核心欲望' }, { key: 'fear', label: '恐惧' }, { key: 'speech', label: '说话方式' },
      { key: 'attitudeToUser', label: '对 user 态度' }, { key: 'conflictStyle', label: '处理冲突' },
      { key: 'proactivity', label: '主动程度' }, { key: 'intimacy', label: '亲密表达' }, { key: 'taboo', label: '禁忌' },
    ],
    world: { sources: [], selection: { 'book-a:0': true, 'book-a:1': true, 'book-b:0': true, 'book-b:1': true } },
    update: { version: '—', path: null },
    debug: {
      stage: { index: 6, total: 8, title: '幽暗庭院的重逢', goal: 'char 强行拉开与 user 的距离，并建立必要的行为边界', status: 'ready', stuckCount: 0 },
      injection: { registered: true, length: 67, text: '[本场目标] 你已经把距离拉开了。这一楼只做收尾：把话说完，转身离开\n[角色动机] 你在意她，但这正是你必须退开的原因\n[如果冷场] 你就补一句不带情绪的告别' },
      speculation: { hits: 0, misses: 8, total: 8, rate: 0, pending: 'user 会因为极度的醉意和失落想宣泄' },
      foreshadows: ['她提过的那封没寄出的信'],
      automation: '大纲 L1 · 阶段重生成 L1 · 侧写 L1 · 立场判定 L2 · 推进点判定 L2 · 一致性自检 L2',
      cost: { callCount: 6 },
      lastAction: 'settle', lastReason: '已达成，本场还差 1 楼，先收尾',
      lastRaw: '{"stance":"accept","confidence":0.9,"judgement":{"status":"achieved","confidence":0.82,"reason":"边界已建立","recalled":[]}}',
      lastRequest: 'system: 你是这个故事的导演…\nuser: [目标] char 强行拉开与 user 的距离…\n[本轮] user：你别走\nchar：…',
      lastJudgement: { status: 'achieved', confidence: 0.82, reason: 'char 已明确说出"到此为止"并完成转身，边界已建立' },
      lastInjection: { text: '[本场目标] user 追上来了。你停下，但没有回头…\n[角色动机] 你在意她，但这正是你必须退开的原因', speculation: { hit: false, guess: '她说想去海边' } },
      breakStatus: { mode: 'preset', preset: { name: '【Ako】1.9-0517 测试版', active: true, length: 2938 }, customLength: 0, injected: 2938 },
      turn: {
        charMessageRaw: '<thinking>她追上来了，我该回头吗？</thinking>\n他停住了',
        charCleaned: '他停住了',
        stance: { source: 'combined', sections: { stance: true, judgement: true, speculation: true } },
      },
      apiLog: [
        { at: Date.now() - 4000, ms: 1800, tokens: 1200, label: 'JUDGE_COMBINED', ok: true },
        { at: Date.now() - 9000, ms: 2100, tokens: 1100, label: 'GEN_OUTLINE', ok: false, error: '被截断' },
        { at: Date.now() - 15000, ms: 900, tokens: 680, label: 'GEN_PROFILE', ok: true },
      ],
    },
  };
}

/** 世界书假数据（预览用） */
export function demoWorldSources() {
  return [
    { type: 'character', label: '角色卡内嵌', books: [{ name: '洛佩兹家', entries: [
      { key: 'book-a:0', name: '罗德里戈的性格', enabled: true, text: 'x'.repeat(320) },
      { key: 'book-a:1', name: '两人的过往', enabled: true, text: 'y'.repeat(810) },
      { key: 'book-a:2', name: '老宅布局', enabled: false, text: 'z'.repeat(240) },
    ] }] },
    { type: 'global', label: '全局书', books: [{ name: '世界观 · 城市', entries: [
      { key: 'book-b:0', name: 'D 市', enabled: true, text: 'w'.repeat(560) },
      { key: 'book-b:1', name: '雨季', enabled: true, text: 'v'.repeat(180) },
    ] }] },
  ];
}

/**
 * 生成完整预览页。
 * **壳必须在**：`<div id="dt-panel" data-palette="a">` —— style.css 全靠它作用域。
 */
export function buildPreviewHtml({ cssPath = path.join(repoRoot, 'style.css') } = {}) {
  const css = fs.readFileSync(cssPath, 'utf8');
  const { html } = renderPanel(demoState(), {
    view: 'status', layer: null, palette: 'a', keyword: '',
    showKey: false, debugShowRaw: false, worldSources: demoWorldSources(),
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>导演时间 · 实装面板预览（真实 markup + 真实 CSS）</title>
<style>
${css}
/* 预览页专用：模拟酒馆里那层遮罩（插件里由 panel.js 的 ensure() 负责） */
body{margin:0;background:#111;font-family:sans-serif}
#dt-panel{display:block}
</style></head>
<body>
<div id="dt-panel" data-palette="a">
${html}
</div>
<script>
// 预览用：真实插件里这些由 panel.js 接线；这里只做"能点着看"的最小模拟
document.querySelectorAll('.dt-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('.dt-tab').forEach(function(t){ t.classList.toggle('dt-tab-on', t === tab); });
    document.querySelectorAll('[data-page]').forEach(function(p){ p.hidden = p.dataset.page !== tab.dataset.view; });
  });
});
function openLayer(name){
  document.querySelectorAll('.dt-layer').forEach(function(l){ l.classList.toggle('dt-layer-on', l.dataset.layer === name); });
}
[['dt-tool-world','world'],['dt-tool-prompt','prompt'],['dt-tool-settings','settings']].forEach(function(pair){
  document.querySelectorAll('.' + pair[0]).forEach(function(b){ b.addEventListener('click', function(){ openLayer(pair[1]); }); });
});
document.querySelectorAll('[data-act="shell.debug"]').forEach(function(b){ b.addEventListener('click', function(){ openLayer('debug'); }); });
document.querySelectorAll('.dt-back').forEach(function(b){ b.addEventListener('click', function(){ openLayer(null); }); });
document.querySelectorAll('[data-act="layer.close"]').forEach(function(b){ b.addEventListener('click', function(){ openLayer(null); }); });
var dark = true;
var themeBtn = document.querySelector('[data-act="shell.theme"]');
if (themeBtn) themeBtn.addEventListener('click', function(){
  dark = !dark;
  document.getElementById('dt-panel').dataset.palette = dark ? 'a' : 'b';
});
</script>
</body></html>
`;
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const target = process.argv[2] ?? path.join(repoRoot, '..', 'UI预览-实装面板.html');
  const page = buildPreviewHtml();
  fs.writeFileSync(target, page, 'utf8');
  console.log(`已生成 ${target}（${Math.round(page.length / 1024)}KB）`);
}
