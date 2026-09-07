// 临时冒烟测试：验证 T-102 / T-103 / T-104 的核心逻辑。跑完即删。
import assert from 'node:assert/strict';

import { createSillyTavernContext } from './src/core/context.js';
import { createStateStore, assertInvariants } from './src/core/state.js';
import { migrate } from './src/core/migrations.js';
import { createEventBus } from './src/core/event-bus.js';
import { createDefaultState, SCHEMA_VERSION } from './src/core/default-state.js';

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

check('旧数据缺字段时补齐，不崩', () => {
  const state = migrate({ stages: [], schemaVersion: 0 });
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.ok(state.automation && state.runtime && state.cost);
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

console.log(`\n通过 ${passed} 项`);
