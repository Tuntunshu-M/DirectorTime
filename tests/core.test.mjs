// 临时冒烟测试：验证 T-102 / T-103 / T-104 的核心逻辑。跑完即删。
import assert from 'node:assert/strict';

import { createSillyTavernContext } from '../src/core/context.js';
import { createStateStore, assertInvariants } from '../src/core/state.js';
import { migrate } from '../src/core/migrations.js';
import { createEventBus } from '../src/core/event-bus.js';
import { createDefaultState, createDefaultSettings, SCHEMA_VERSION } from '../src/core/default-state.js';

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

console.log('T-102 适配层');
check('无 SillyTavern 全局时能力探测不报错，且 events 为 false', () => {
  const ctx = createSillyTavernContext(() => ({}));
  const caps = ctx.capabilities;
  assert.equal(typeof caps === 'object', true);
  assert.equal(caps.events, false);
  assert.equal(caps.messages, false);
});

check('注入参数被封死为 1/0/false/0', () => {
  const calls = [];
  const ctx = createSillyTavernContext(() => ({
    setExtensionPrompt: (...args) => calls.push(args),
  }));
  ctx.setExtensionPrompt('dt_test', 'hello');
  assert.deepEqual(calls[0], ['dt_test', 'hello', 1, 0, false, 0]);
});

check('清空注入传空字符串且参数一致', () => {
  const calls = [];
  const ctx = createSillyTavernContext(() => ({
    setExtensionPrompt: (...args) => calls.push(args),
  }));
  ctx.clearExtensionPrompt('dt_test');
  assert.equal(calls[0][1], '');
});

check('世界书条目兼容三套命名', () => {
  const ctx = createSillyTavernContext(() => ({
    characters: [{ data: { character_book: { entries: [{ uid: 7, comment: '老板娘', text: '独眼' }] } } }],
    characterId: 0,
  }));
  const entries = ctx.getCharacterBookEntries();
  assert.equal(entries[0].id, '7');
  assert.equal(entries[0].name, '老板娘');
  assert.equal(entries[0].content, '独眼');
});

console.log('T-103 状态仓库');
check('migrate(undefined) 返回默认状态且带 schemaVersion', () => {
  const state = migrate(undefined);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.stages, []);
});

check('默认运行时有 rounds 计数、默认设置轮数上限 15', () => {
  assert.equal(createDefaultState().runtime.rounds, 0);
  assert.equal(createDefaultSettings().maxRounds, 15);
});

check('默认设置含世界书勾选与条数上限', () => {
  assert.deepEqual(createDefaultSettings().worldSelection, {});
  assert.equal(createDefaultSettings().worldLimit, 20);
});

check('默认设置含主目标与楼层节奏（T-416）', () => {
  const settings = createDefaultSettings();
  assert.equal(settings.objective, '');
  assert.deepEqual(settings.pacing, { min: 3, max: 8 });
});

check('默认意愿权重为 80（T-405 高档：user 优先）', () => {
  assert.equal(createDefaultSettings().will, 80);
});

check('强制爱默认关闭（T-405 §七：不开启就不该有任何变化）', () => {
  assert.equal(createDefaultSettings().forceAffection, false);
});

check('旧数据缺字段时补齐，不崩', () => {
  const state = migrate({ stages: [], schemaVersion: 0 });
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.ok(state.runtime && state.cost);
});

check('档位只在 settings 里：聊天级状态不许再存一份（P1-2 单一来源）', () => {
  // 老数据里如果残留 automation，迁移时必须删掉 —— 否则 Debug 又会读到那份默认值
  const state = migrate({ stages: [], schemaVersion: 1, automation: { outline: 'L0' } });
  assert.equal('automation' in state, false, '聊天级不该有 automation');
  assert.equal(createDefaultSettings().automation.outline, 'L1', '档位的默认值在 settings 里');
  assert.deepEqual(Object.keys(createDefaultSettings().automation).length, 6, '六个功能点都在');
});

check('未来版本不猜，按默认结构兜底', () => {
  const state = migrate({ schemaVersion: 999, stages: [] });
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
});

check('两个 active 阶段触发不变量错误', () => {
  assert.throws(
    () => assertInvariants({ stages: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }] }),
    /不变量/
  );
});

check('activeStageId 与实际不一致时报错', () => {
  assert.throws(
    () => assertInvariants({ activeStageId: 'zzz', stages: [{ id: 'a', status: 'active' }] }),
    /不变量/
  );
});

// 用内存 stub 模拟 chatMetadata
function makeCtx() {
  const meta = {};
  const settingsStore = {};
  return {
    ctx: {
      getChatState: () => meta,
      saveChatState: () => true,
      getExtensionSettings: () => settingsStore,
      saveSettings: () => true,
    },
    meta,
    settingsStore,
  };
}

check('store.update 写入并校验不变量', () => {
  const { ctx, meta } = makeCtx();
  const store = createStateStore(ctx, 'dt');
  store.update((d) => ({ ...d, stages: [{ id: 'a', status: 'active' }], activeStageId: 'a' }));
  assert.equal(meta.dt.stages.length, 1);
  assert.equal(meta.dt.activeStageId, 'a');
});

check('写入非法状态会被拦下', () => {
  const { ctx } = makeCtx();
  const store = createStateStore(ctx, 'dt');
  assert.throws(
    () => store.update((d) => ({
      ...d,
      stages: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }],
      activeStageId: null,
    }))
  );
});

check('history 可撤销', () => {
  const { ctx } = makeCtx();
  const store = createStateStore(ctx, 'dt');
  store.update((d) => ({ ...d, stages: [{ id: 'a', status: 'active' }], activeStageId: 'a' }), { label: '第一步' });
  store.update((d) => ({ ...d, stages: [{ id: 'b', status: 'active' }], activeStageId: 'b' }), { label: '第二步' });
  assert.equal(store.get().activeStageId, 'b');
  store.undo();
  assert.equal(store.get().activeStageId, 'a');
});

check('history 快照不嵌套：体积线性而非指数爆炸', () => {
  const { ctx } = makeCtx();
  const store = createStateStore(ctx, 'dt');
  for (let i = 0; i < 12; i += 1) {
    store.update((d) => ({ ...d, outline: { n: i } }), { label: `第${i}步` });
  }
  const history = store.get().history;
  assert.equal(history.length, 12);
  // 每条快照里不该再套着历史
  assert.equal(history[history.length - 1].snapshot.history.length, 0);
  // 12 步总量应在千字符量级；嵌套时会到几十万
  const size = JSON.stringify(history).length;
  assert.ok(size < 20000, `history 体积异常：${size}`);
  // 撤销仍然正确
  store.undo();
  assert.equal(store.get().outline.n, 10);
  assert.equal(store.get().history.length, 11);
});

check('导出 / 导入快照往返无损', () => {
  const { ctx } = makeCtx();
  const store = createStateStore(ctx, 'dt');
  store.update((d) => ({
    ...d,
    stages: [{ id: 'a', status: 'active', goal: '知道 user 想不想去' }],
    activeStageId: 'a',
  }));
  const json = store.exportSnapshot();
  const restored = JSON.parse(json);

  const fresh = makeCtx();
  const store2 = createStateStore(fresh.ctx, 'dt');
  const result = store2.importSnapshot(json);
  assert.equal(result.ok, true);
  assert.deepEqual(store2.get().stages, restored.stages);
});

check('导入非法 JSON 返回失败而不抛异常', () => {
  const { ctx } = makeCtx();
  const store = createStateStore(ctx, 'dt');
  const result = store.importSnapshot('{ 这不是 json');
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
});

console.log('T-104 事件总线');
check('on / emit / off 正常', () => {
  const bus = createEventBus();
  let got = null;
  const off = bus.on('x', (p) => { got = p; });
  bus.emit('x', { a: 1 });
  assert.deepEqual(got, { a: 1 });
  off();
  bus.emit('x', { a: 2 });
  assert.deepEqual(got, { a: 1 });
});

check('订阅者抛错不影响其它订阅者', () => {
  const bus = createEventBus();
  let reached = false;
  bus.on('x', () => { throw new Error('boom'); });
  bus.on('x', () => { reached = true; });
  bus.emit('x');
  assert.equal(reached, true);
});

console.log('聊天级持久化（P0 修复：剧本不能因为加载时机而丢）');

function makeChatEnv() {
  const slots = { 'chat-A': {}, 'chat-B': {} };
  let chatKey = 'chat-A';
  const ctx = {
    getChatState: () => slots[chatKey],
    saveChatState: () => true,
    getCurrentChatKey: () => chatKey,
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
  };
  return {
    slots,
    ctx,
    switchTo: (key) => { chatKey = key; },
    store: createStateStore(ctx, 'dt'),
  };
}

check('切聊天：自动按新聊天重读，不会把 A 的剧本带到 B', () => {
  const env = makeChatEnv();
  env.store.update((draft) => ({ ...draft, outline: { title: 'A 的剧本' } }), { label: '写 A' });
  assert.equal(env.slots['chat-A'].dt.outline.title, 'A 的剧本', '要落到 A 的存档里');

  env.switchTo('chat-B');
  assert.equal(env.store.get().outline, null, '换聊天要重读成 B 的（空）');

  env.store.update((draft) => ({ ...draft, outline: { title: 'B 的剧本' } }), { label: '写 B' });
  assert.equal(env.slots['chat-B'].dt.outline.title, 'B 的剧本');
  assert.equal(env.slots['chat-A'].dt.outline.title, 'A 的剧本', 'A 的存档不能被 B 覆盖');

  env.switchTo('chat-A');
  assert.equal(env.store.get().outline.title, 'A 的剧本', '切回 A 要读回 A 的剧本');
});

check('聊天还没就绪：拿不到 chatMetadata 时不写（否则就是拿默认状态覆盖存档）', () => {
  const ctx = {
    getChatState: () => null,
    saveChatState: () => true,
    getCurrentChatKey: () => null,
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
  };
  const store = createStateStore(ctx, 'dt');
  assert.equal(store.save(), false, '没有 chatMetadata 就不该写，更不能报成功');
});

check('同一个聊天：正常的读写不受影响（不误判成"换了聊天"）', () => {
  const env = makeChatEnv();
  env.store.update((draft) => ({ ...draft, outline: { title: '第一份' } }), { label: 'x' });
  env.store.update((draft) => ({ ...draft, outline: { title: '第二份' } }), { label: 'y' });
  assert.equal(env.slots['chat-A'].dt.outline.title, '第二份');
  assert.equal(env.store.get().outline.title, '第二份');
});

console.log('2026-09-14 #3 · 全局世界书 = 酒馆里"全局启用"的那些');

check('认 worldInfo.globalSelect（酒馆里打了全局开关的书）', () => {
  const ctx = createSillyTavernContext(() => ({
    world_names: ['全局A', '闲书B', '全局C'],
    worldInfo: { globalSelect: ['全局A', '全局C'] },
  }));
  assert.deepEqual(ctx.getGlobalWorldInfoNames(), { names: ['全局A', '全局C'], readable: true });
});

check('别的酒馆形状也认（world_info.globalSelect / powerUserSettings.world_info）', () => {
  const a = createSillyTavernContext(() => ({ world_info: { globalSelect: '只有一本' } }));
  assert.deepEqual(a.getGlobalWorldInfoNames(), { names: ['只有一本'], readable: true });
  const b = createSillyTavernContext(() => ({ powerUserSettings: { world_info: ['X', 'Y'] } }));
  assert.deepEqual(b.getGlobalWorldInfoNames(), { names: ['X', 'Y'], readable: true });
});

check('读不到 → readable:false（**绝不**拿全部书名冒充全局）', () => {
  const ctx = createSillyTavernContext(() => ({ world_names: ['A', 'B'] }));
  assert.deepEqual(ctx.getGlobalWorldInfoNames(), { names: [], readable: false });
});

check('来源分组：全局那组只放全局启用的书，其余进「其它世界书」', () => {
  const ctx = createSillyTavernContext(() => ({
    world_names: ['全局A', '闲书B', '全局C'],
    worldInfo: { globalSelect: ['全局A', '全局C'] },
  }));
  const sources = ctx.getLorebookSources();
  const global = sources.find((source) => source.type === 'global');
  const library = sources.find((source) => source.type === 'library');

  assert.deepEqual(global.names, ['全局A', '全局C'], '全局组只放全局启用的');
  assert.ok(global.label.includes('全局启用'), global.label);
  assert.equal(global.hint, undefined, '读得到就不该有"读不到"提示');
  assert.deepEqual(library.names, ['闲书B'], '其它书不能丢');
  assert.ok(library.label.includes('其它'), library.label);
});

check('读不到全局列表 → 全局组空 + 如实提示，书全在「全部世界书」组里（不丢功能）', () => {
  const ctx = createSillyTavernContext(() => ({ world_names: ['A', 'B'] }));
  const sources = ctx.getLorebookSources();
  const global = sources.find((source) => source.type === 'global');
  const library = sources.find((source) => source.type === 'library');

  assert.deepEqual(global.names, []);
  assert.ok(global.hint, '要如实说明"没读到"');
  assert.deepEqual(library.names, ['A', 'B'], '书一本都不能少');
  assert.ok(library.label.includes('全部'), library.label);
});

console.log(`\n通过 ${passed} 项`);
