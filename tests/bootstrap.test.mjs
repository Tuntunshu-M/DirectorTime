// 装配层测试：轮次消息抽取 + 总开关（判据 14）

import assert from 'node:assert/strict';
import { lastTurnMessages, normalizeMaxRounds, shouldResetScript, bootstrap } from '../src/bootstrap.js';
import { createStateStore } from '../src/core/state.js';
import { normalizeStages } from '../src/director/outline.js';

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

console.log('装配层 · 轮次消息抽取');

check('空 chat 返回空字符串', () => {
  assert.deepEqual(lastTurnMessages([]), { userMessage: '', charMessage: '' });
});

check('标准一轮：末尾 char，倒数第二 user', () => {
  const messages = [
    { is_user: true, mes: '今天好无聊' },
    { is_user: false, mes: '那我们去旅行吧' },
  ];
  const r = lastTurnMessages(messages);
  assert.equal(r.userMessage, '今天好无聊');
  assert.equal(r.charMessage, '那我们去旅行吧');
});

check('末尾是 user 时 char 为空（用户连发）', () => {
  const messages = [
    { is_user: false, mes: '旧的回复' },
    { is_user: true, mes: '我又说了一句' },
  ];
  const r = lastTurnMessages(messages);
  assert.equal(r.userMessage, '我又说了一句');
  assert.equal(r.charMessage, '');
});

check('只有一条 user 消息', () => {
  const r = lastTurnMessages([{ is_user: true, mes: '开场白' }]);
  assert.equal(r.userMessage, '开场白');
  assert.equal(r.charMessage, '');
});

check('mes 缺失时不崩', () => {
  const r = lastTurnMessages([{ is_user: true }, { is_user: false }]);
  assert.equal(r.userMessage, '');
  assert.equal(r.charMessage, '');
});

console.log('剧本轮数上限');

check('maxRounds 非法值回落到 15', () => {
  assert.equal(normalizeMaxRounds(undefined), 15);
  assert.equal(normalizeMaxRounds(0), 15);
  assert.equal(normalizeMaxRounds(-3), 15);
  assert.equal(normalizeMaxRounds('abc'), 15);
  assert.equal(normalizeMaxRounds(3.7), 3);
  assert.equal(normalizeMaxRounds(5), 5);
});

check('超过上限才重置：15 轮不重置，16 轮重置', () => {
  assert.equal(shouldResetScript(15, 15), false);
  assert.equal(shouldResetScript(16, 15), true);
  assert.equal(shouldResetScript(1, 1), false);
  assert.equal(shouldResetScript(2, 1), true);
  assert.equal(shouldResetScript(5, undefined), false);
});

console.log('总开关（T-405 判据 14）');

/** 最小 ctx 桩：不碰 DOM，只在 Node 里跑通装配 */
function makeBootEnv() {
  const listeners = {};
  let injected = '';
  const ext = {};
  const ctx = {
    capabilities: {},
    getExtensionSettings: () => ext,
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
    getMessages: () => [{ is_user: true, mes: '我不要' }, { is_user: false, mes: '好吧' }],
    on: (name, fn) => { listeners[name] = fn; return () => {}; },
    showSystemMessage: () => {},
    setExtensionPrompt: (_key, value) => { injected = value ?? ''; return true; },
    clearExtensionPrompt: () => { injected = ''; return true; },
    characters: [{ name: 'C', data: { extensions: {} } }],
    getCharacterId: () => 0,
  };
  const store = createStateStore(ctx, 'director_time_test');
  return { ctx, store, listeners, getInjected: () => injected };
}

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

globalThis.window = globalThis.window ?? {}; // 面板/菜单模块在无 document 环境下的兜底

await acheck('关掉总开关 → 立刻清空注入', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });
  env.store.saveSettings({ enabled: true, injectEnabled: true, connection: { endpoint: 'https://x/v1' } });
  api.stages.load(normalizeStages([{ goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'a' } }]));
  api.review.syncInjection();
  assert.ok(env.getInjected().length > 0, '开着的时候应该有注入');

  api.setEnabled(false);
  assert.equal(env.getInjected(), '', '关总开关必须立刻清空注入（T-204 四个清空时机之一）');
});

await acheck('总开关关闭时收到消息不复盘（强制爱开着也一样不覆盖）', async () => {
  const originalFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched += 1; return { ok: true, json: async () => ({}) }; };
  try {
    const env = makeBootEnv();
    const api = bootstrap({ ctx: env.ctx, store: env.store });
    env.store.saveSettings({ enabled: false, forceAffection: true, connection: { endpoint: 'https://x/v1' } });
    api.stages.load(normalizeStages([{ goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'a' } }]));

    await env.listeners['message_received']();
    assert.equal(fetched, 0, '总开关关着就不该调导演 API');
    assert.equal(env.getInjected(), '', '也不该有注入');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await acheck('世界书选择 / 剧本 / 进度都按聊天记（切聊天不串）', async () => {
  const chats = { A: {}, B: {} };
  let current = 'A';
  const ctx = {
    capabilities: {},
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
    getChatState: () => chats[current],
    saveChatState: () => {},
    getMessages: () => [],
    on: () => () => {},
    showSystemMessage: () => {},
    setExtensionPrompt: () => true,
    clearExtensionPrompt: () => true,
    characters: [{ name: 'C', data: { extensions: {} } }],
    getCharacterId: () => 0,
  };
  const store = createStateStore(ctx, 'dt_chat_scope_test');
  const api = bootstrap({ ctx, store });

  // A 聊天：勾一个世界书条目 + 装载一份剧本
  api.stages.load(normalizeStages([{ goal: 'A 的戏', checkpoint: { criteria: 'c', antiCriteria: 'a' } }]));
  store.update((draft) => ({ ...draft, worldSelection: { k1: true } }));
  assert.deepEqual(chats.A.dt_chat_scope_test.worldSelection, { k1: true }, '世界书选择要落进这一聊天的记录');
  assert.equal(chats.A.dt_chat_scope_test.stages.length, 1, '剧本也在这一聊天的记录里');

  // 切到 B：看不见 A 的东西
  current = 'B';
  store.load();
  assert.deepEqual(store.get().worldSelection, {}, 'B 不该看到 A 的世界书选择');
  assert.equal(store.get().stages.length, 0, 'B 不该看到 A 的剧本');
  assert.equal(store.get().activeStageId, null, '进度也不串');

  // 切回 A：原样还在
  current = 'A';
  store.load();
  assert.deepEqual(store.get().worldSelection, { k1: true });
  assert.equal(store.get().stages[0].goal, 'A 的戏');
  assert.equal(store.get().activeStageId, store.get().stages[0].id, '进度（当前场）也恢复');
});

console.log('T-424 / T-425 / P2-2 · 新入口的装配');

await acheck('api.intensity：三档、默认标准、切档走 saveSettings', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });

  assert.equal(api.intensity.get(), 'standard', '默认必须是标准档（零回归）');
  assert.deepEqual(api.intensity.levels(), ['restrained', 'standard', 'assertive']);
  assert.equal(api.intensity.set('restrained'), 'restrained');
  assert.equal(env.store.getSettings().directorIntensity, 'restrained', '要走 saveSettings 持久化');
  assert.equal(api.intensity.set('瞎填'), 'standard', '认不出的回落标准档');
});

await acheck('api.sanitize：按 T-425 的键读写（sanitizeEnabled / sanitizeRules）', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });

  assert.deepEqual(api.sanitize.get(), { enabled: true, rules: [] }, '默认开、无自定义');
  api.sanitize.set({ rules: ['<status>.*</status>', '  ', '<status>.*</status>'] });
  assert.deepEqual(env.store.getSettings().sanitizeRules.map((rule) => rule.pattern), ['<status>.*</status>'], '去空去重');
  api.sanitize.set({ enabled: false });
  assert.equal(api.sanitize.get().enabled, false);
  api.sanitize.reset();
  assert.deepEqual(api.sanitize.get(), { enabled: true, rules: [] });
});

await acheck('老数据迁移：v0.6.0 的 settings.textClean → sanitizeEnabled / sanitizeRules', async () => {
  const env = makeBootEnv();
  env.store.saveSettings({ textClean: { enabled: false, rules: ['<x>.*</x>'] } });
  bootstrap({ ctx: env.ctx, store: env.store });

  const settings = env.store.getSettings();
  assert.equal(settings.sanitizeEnabled, false, '开关要迁过来');
  assert.deepEqual(settings.sanitizeRules.map((rule) => rule.pattern), ['<x>.*</x>'], '自定义规则要迁过来');
  assert.equal(settings.textClean, undefined, '旧键要清掉（不然又是两份）');
});

await acheck('api.speculate：开关 + 状态（P2-2 以前只有闸门没有入口）', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });

  assert.equal(api.speculate.status().enabled, true, '默认开');
  const off = api.speculate.setEnabled(false);
  assert.equal(off.enabled, false);
  assert.equal(env.store.getSettings().speculation, false, '要走 saveSettings 持久化');
  api.speculate.setEnabled(true);
  assert.equal(api.speculate.status().enabled, true);
  assert.ok('hits' in api.speculate.status() && 'total' in api.speculate.status(), '要能报命中率');
});

await acheck('配置改了 → Debug 的「下轮将注入」跟着变（导演强度接线）', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });
  env.store.saveSettings({ enabled: true, injectEnabled: true, connection: { endpoint: 'https://x/v1' } });
  api.stages.load(normalizeStages([{ goal: 'g', activity: 'a', checkpoint: { criteria: 'c', antiCriteria: 'a' }, beats: ['b'] }]));

  api.intensity.set('standard');
  const standard = api.review.syncInjection();
  api.intensity.set('restrained');
  const restrained = api.review.syncInjection();

  assert.ok(standard.includes('你要主动做的一件事'), standard);
  assert.ok(restrained.includes('可以试着做的一件事'), restrained);
  assert.notEqual(standard, restrained, '切档要真的改变注入文本');
});

console.log(`\n通过 ${passed} 项`);
