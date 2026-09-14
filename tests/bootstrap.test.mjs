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

console.log('T-427 · 重生成带上驳回原因（端到端：自检判否 → 下一次请求真的带上了）');

const T427_OUTLINE_JSON = JSON.stringify({
  objective: '让她走出门',
  title: '出门',
  premise: '连着一周没出门',
  foreshadows: [],
  stages: [{
    title: 's1',
    goal: '把出门这件事挑明',
    activity: '收拾行李',
    checkpoint: { criteria: '他把话说死', antiCriteria: '他改口说不去了' },
    beats: ['提起周末的安排'],
  }],
});

/** 按顺序回应：GEN_OUTLINE → 自检(否) → GEN_OUTLINE(重生成) → 自检(是) */
function stubT427Fetch(verdicts = ['他太热情外放了，不像内敛角色', null]) {
  const original = globalThis.fetch;
  const bodies = [];
  const reply = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ''));
    const n = bodies.length;
    if (n === 1 || n === 3) return reply(T427_OUTLINE_JSON);
    if (n === 2) return reply(JSON.stringify(verdicts[0] ? { ok: false, reason: verdicts[0] } : { ok: true, reason: '通过' }));
    return reply(JSON.stringify(verdicts[1] ? { ok: false, reason: verdicts[1] } : { ok: true, reason: '通过' }));
  };
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

/** 造一个"有侧写 + 可生成"的环境（没侧写的话自检根本不跑） */
function makeT427Env() {
  const env = makeBootEnv();
  const profile = { schemaVersion: 1, fields: { coreDesire: '想被看见', proactivity: '内敛，靠小事试探' }, locked: {} };
  env.ctx.getCharacterField = () => profile;
  env.ctx.writeCharacterField = () => true;
  const api = bootstrap({ ctx: env.ctx, store: env.store });
  env.store.saveSettings({ connection: { endpoint: 'https://x/v1', model: 'm', apiKey: 'k' } });
  return { env, api };
}

await acheck('首轮请求里没有驳回段；判否后重生成的请求里带上了原因原文', async () => {
  const stub = stubT427Fetch();
  try {
    const { api } = makeT427Env();
    await api.generateScript({ premise: '想去旅行' });

    assert.ok(stub.bodies.length >= 3, `应该发生 3 次以上调用，实际 ${stub.bodies.length}`);
    assert.ok(
      !stub.bodies[0].includes('上一版被判定为不符合人设'),
      '首轮（还没被否）不该出现驳回段 —— 零回归',
    );
    assert.ok(!stub.bodies[0].includes('{{'), '首轮不该留占位符');

    assert.ok(stub.bodies[1].includes('剧本审校'), '第二次调用应该是自检（HTTP body 里没有 label，只能按模板文本认）');
    assert.ok(
      stub.bodies[2].includes('上一版被判定为不符合人设，原因是：他太热情外放了，不像内敛角色。'),
      `重生成请求必须带原因原文：${stub.bodies[2].slice(0, 400)}`,
    );
    assert.ok(stub.bodies[2].includes('这一版必须避开这个具体问题'));
  } finally {
    stub.restore();
  }
});

await acheck('两次都被否 → 第二次重生成带上两条原因（最新那条在内）', async () => {
  const stub = stubT427Fetch(['第一条：太平静', '第二条：还是太平静']);
  try {
    const { api } = makeT427Env();
    await api.generateScript({ premise: '想去旅行' });

    assert.ok(stub.bodies.length >= 5, `应该跑满两轮：1 + 2 生成 + 2 自检，实际 ${stub.bodies.length}`);
    const last = stub.bodies[4];
    assert.ok(last.includes('第一条：太平静'), last.slice(0, 400));
    assert.ok(last.includes('第二条：还是太平静'), '第 2 轮要带上第 2 次的原因');
    // HTTP body 是 JSON，换行是转义的（\\n）—— 两条原因要拼成两行
    assert.ok(/第一条：太平静(\\n|\n)第二条：还是太平静/.test(last), '两条原因拼成两行');
  } finally {
    stub.restore();
  }
});

await acheck('自检通过（没判否）→ 全程只有一次生成调用，请求里始终没有驳回段', async () => {
  const stub = stubT427Fetch([null]);
  try {
    const { api } = makeT427Env();
    await api.generateScript({ premise: '想去旅行' });

    assert.equal(stub.bodies.length, 2, '1 次生成 + 1 次自检');
    assert.ok(!stub.bodies[0].includes('上一版被判定为不符合人设'));
    assert.ok(!stub.bodies[0].includes('{{'));
  } finally {
    stub.restore();
  }
});

await acheck('L1 档位：进待审核队列的提示带上原因（用户能看到为什么被否）', async () => {
  const stub = stubT427Fetch();
  try {
    const { env, api } = makeT427Env();
    env.store.saveSettings({ automation: { consistency: 'L1' } });
    await api.generateScript({ premise: '想去旅行' });

    // 队列里还会有「大纲 L1 待确认」那条（默认档位），按 feature 认
    const item = api.queue.list().find((entry) => entry.feature === 'consistency');
    assert.ok(item, 'L1 应该进队列');
    assert.ok(
      item.summary.includes('他太热情外放了，不像内敛角色'),
      `队列提示要带上原因：${item.summary}`,
    );
  } finally {
    stub.restore();
  }
});

console.log('T-430 · 自动检查更新（GitHub 有新版本要能看到）');

/** 造一个"本地 manifest + GitHub manifest 各自可控"的 fetch 桩 */
function stubUpdateFetch({ local = '0.10.0', remote = '0.11.0' } = {}) {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    const text = String(url);
    urls.push(text);
    // 本地那份：带 homepage（远程地址由它推出来）；远程那份：raw.githubusercontent
    if (text.includes('raw.githubusercontent.com')) {
      if (remote === null) return { ok: false, status: 500 };
      return { ok: true, json: async () => ({ version: remote }) };
    }
    return { ok: true, json: async () => ({ version: local, homepage: 'https://github.com/Tuntunshu-M/DirectorTime' }) };
  };
  return { urls, restore: () => { globalThis.fetch = original; } };
}

await acheck('checkRemoteUpdate：远程更新 → hasUpdate + 缓存进 runtime + 提示一次（同版本不重复提示）', async () => {
  const stub = stubUpdateFetch({ local: '0.10.0', remote: '0.11.0' });
  try {
    const env = makeBootEnv();
    const messages = [];
    env.ctx.showSystemMessage = (text) => messages.push(text);
    const api = bootstrap({ ctx: env.ctx, store: env.store });

    const result = await api.checkRemoteUpdate({ notify: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.local, '0.10.0');
    assert.equal(result.remote, '0.11.0');
    assert.equal(result.hasUpdate, true, '0.11.0 > 0.10.0 必须判为有新版本');
    assert.ok(stub.urls.some((url) => url.includes('raw.githubusercontent.com')), '必须真去查 GitHub');

    // 缓存进 runtime（面板一打开就能看到，不用先点检查）
    const cached = env.store.get().runtime.update;
    assert.equal(cached.remote, '0.11.0');
    assert.ok(cached.checkedAt > 0);

    // 提示一次
    assert.equal(messages.length, 1, messages.join(' | '));
    assert.ok(messages[0].includes('0.11.0'), messages[0]);
    assert.equal(env.store.getSettings().updateNotifiedVersion, '0.11.0');

    // 同一个版本再查一次 → 不再提示（不然每 15 秒轮询就弹一次）
    await api.checkRemoteUpdate({ notify: true });
    assert.equal(messages.length, 1, '同一版本只提示一次');
  } finally {
    stub.restore();
  }
});

await acheck('checkRemoteUpdate：本地与远程一致 → hasUpdate=false，且不提示', async () => {
  const stub = stubUpdateFetch({ local: '0.10.0', remote: '0.10.0' });
  try {
    const env = makeBootEnv();
    const messages = [];
    env.ctx.showSystemMessage = (text) => messages.push(text);
    const api = bootstrap({ ctx: env.ctx, store: env.store });

    const result = await api.checkRemoteUpdate({ notify: true });
    assert.equal(result.hasUpdate, false);
    assert.equal(messages.length, 0, '没新版本不该提示');
  } finally {
    stub.restore();
  }
});

await acheck('checkRemoteUpdate：查不到远程 → ok:false（不假装"已是最新"）', async () => {
  const stub = stubUpdateFetch({ remote: null });
  try {
    const env = makeBootEnv();
    const api = bootstrap({ ctx: env.ctx, store: env.store });
    const result = await api.checkRemoteUpdate();
    assert.equal(result.ok, false, '不能报成功');
    assert.ok(env.store.get().runtime.update.reason, '要存下失败原因');
  } finally {
    stub.restore();
  }
});

await acheck('api.ui.read() 里带着最近一次远程检查结果（面板状态行用它）', async () => {
  const stub = stubUpdateFetch({ local: '0.10.0', remote: '0.11.0' });
  try {
    const env = makeBootEnv();
    const api = bootstrap({ ctx: env.ctx, store: env.store });
    assert.equal(api.ui.read().update.checked, null, '还没查过就是 null');
    await api.checkRemoteUpdate();
    assert.equal(api.ui.read().update.checked.remote, '0.11.0');
  } finally {
    stub.restore();
  }
});

console.log('2026-09-14 · 反馈 #2（剧情走向）+ #4（占比锁）');

await acheck('#4：占比线「锁」真的锁住了（拖别的线 / 重绘都不会丢）', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });

  api.tone.set('daily', 60, ['daily']); // 点「锁」
  assert.deepEqual(env.store.get().tone.locked, ['daily'], '锁必须存进 tone（以前被 rebalanceTone 洗掉）');
  assert.equal(api.ui.read().toneLocked.includes('daily'), true, '界面要读得到锁状态');

  const daily = api.tone.get().daily;
  api.tone.set('crisis', 20); // 拖另一条（老代码这里会把 locked 洗成空）
  assert.deepEqual(env.store.get().tone.locked, ['daily'], '拖别的线不能把锁弄丢');
  assert.equal(api.tone.get().daily, daily, '锁住的线不许被配平改动');

  api.tone.set('daily', daily, []); // 解锁
  assert.deepEqual(env.store.get().tone.locked, [], '能解锁');
  const tone = api.tone.get();
  assert.equal(tone.daily + tone.crisis + tone.intimate, 100, '解完锁仍是 100');
});

await acheck('#4：认不出的键不进 locked（免得存一坨垃圾）', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });
  api.tone.set('daily', 50, ['daily', '瞎写的']);
  assert.deepEqual(env.store.get().tone.locked, ['daily']);
});

await acheck('#2：场记的「剧情走向」会跟着「重新生成剧本」进请求', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ''));
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              objective: '让她走出门', title: '出门', premise: '一周没出门', foreshadows: [],
              stages: [{ title: 's1', goal: '把出门挑明', activity: '收拾行李', checkpoint: { criteria: '他把话说死', antiCriteria: '他改口' }, beats: ['提起周末'] }],
            }),
          },
        }],
      }),
    };
  };
  try {
    const env = makeBootEnv();
    // 侧写为空 + 关掉一致性自检 → 只发一次 GEN_OUTLINE，好数
    env.ctx.getCharacterField = () => undefined;
    const api = bootstrap({ ctx: env.ctx, store: env.store });
    env.store.saveSettings({
      connection: { endpoint: 'https://x/v1', model: 'm', apiKey: 'k' },
      consistencyCheck: false,
      premise: '让他这一场挑明，但别太快和解',
    });

    await api.regenerateScript();

    assert.equal(bodies.length, 1, `只该发一次生成调用，实际 ${bodies.length}`);
    assert.ok(bodies[0].includes('让他这一场挑明，但别太快和解'), '剧情走向要进请求');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log('2026-09-14 · 反馈 #1（全不选真的生效）+ #2（user 人设进请求）');

await acheck('#1：api.presets.selectEntries 必须把 { none: true } 转发下去（以前被吃掉 → 点了没反应）', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });

  api.presets.selectEntries([], { none: true });
  assert.equal(env.store.getSettings().preset?.none, true, '全不选标记要存下来');
  assert.equal(api.presets.status().none, true);
  assert.equal(api.ui.read().presets.status.none, true, '界面读到的也必须是"全不选"');
  assert.equal(api.presets.text(), '', '一条都不注入');

  api.presets.selectEntries([1]);
  assert.equal(api.presets.status().none, false, '勾回一条就取消全不选');
});

await acheck('#2：user 人设进剧本请求（persona 里写了讨厌薄荷，就不能再送薄荷）', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ''));
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              objective: '让她走出门', title: '出门', premise: '一周没出门', foreshadows: [],
              stages: [{ title: 's1', goal: '把出门挑明', activity: '收拾行李', checkpoint: { criteria: '他把话说死', antiCriteria: '他改口' }, beats: ['提起周末'] }],
            }),
          },
        }],
      }),
    };
  };
  try {
    const env = makeBootEnv();
    env.ctx.getCharacterField = () => undefined;
    env.ctx.getUserPersona = () => ({ name: '小雨', description: '讨厌薄荷，怕吵' });
    const api = bootstrap({ ctx: env.ctx, store: env.store });
    env.store.saveSettings({ connection: { endpoint: 'https://x/v1', model: 'm', apiKey: 'k' }, consistencyCheck: false });

    assert.equal(api.userPersonaText().includes('讨厌薄荷'), true, '控制台能核对读到没有');

    await api.regenerateScript();
    assert.equal(bodies.length, 1);
    assert.ok(bodies[0].includes('讨厌薄荷'), '剧本请求里必须带上 user 人设');
    assert.ok(bodies[0].includes('小雨'), '名字也带上');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await acheck('#2：侧写请求同样带上 user 人设', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => { bodies.push(String(init?.body ?? '')); return { ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) }; };
  try {
    const env = makeBootEnv();
    env.ctx.getUserPersona = () => ({ name: '', description: '讨厌薄荷' });
    const api = bootstrap({ ctx: env.ctx, store: env.store });
    env.store.saveSettings({ connection: { endpoint: 'https://x/v1', model: 'm', apiKey: 'k' } });

    await api.profileApi.regenerate();
    assert.ok(bodies[0].includes('讨厌薄荷'), '侧写请求也要带 user 人设');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await acheck('#2：读不到 persona → 请求里没有那段（零回归）', async () => {
  const env = makeBootEnv();
  const api = bootstrap({ ctx: env.ctx, store: env.store });
  assert.equal(api.userPersonaText(), '', '读不到就是空串');
});

await acheck('T-436：主角自选（勾选角色卡 / 手填 NPC / 移除）都落盘并进快照', async () => {
  const env = makeBootEnv();
  env.ctx.listCharacters = () => [{ id: '0', name: '洛佩兹' }, { id: '1', name: '罗德里戈' }];
  const api = bootstrap({ ctx: env.ctx, store: env.store });

  assert.deepEqual(api.cast.candidates(), [{ id: '0', name: '洛佩兹' }, { id: '1', name: '罗德里戈' }], '自动识别的候选');
  assert.equal(api.ui.read().cast.candidates.length, 2, '界面拿得到候选');

  api.cast.toggle({ id: '1', name: '罗德里戈' });
  assert.deepEqual(env.store.getSettings().protagonists, [{ id: '1', name: '罗德里戈' }], '勾选要落盘');

  api.cast.add('酒馆老板');
  assert.deepEqual(env.store.getSettings().protagonists.at(-1), { id: '', name: '酒馆老板', manual: true }, '手填的 NPC 标 manual');

  api.cast.remove({ name: '酒馆老板' });
  assert.deepEqual(api.ui.read().cast.list.map((item) => item.name), ['罗德里戈'], '移除后快照同步');

  api.cast.toggle({ id: '1', name: '罗德里戈' });
  assert.deepEqual(env.store.getSettings().protagonists, [], '再点一次 = 取消勾选');
});

console.log(`\n通过 ${passed} 项`);
