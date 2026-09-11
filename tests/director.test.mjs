// T-203 / T-204 测试：大纲生成、阶段状态机、注入注册表

import assert from 'node:assert/strict';
import { createOutlineService, normalizeStages } from '../src/director/outline.js';
import { createStageService } from '../src/director/stage.js';
import { createPromptRegistry } from '../src/inject/prompt-registry.js';
import { createStateStore } from '../src/core/state.js';
import { createSillyTavernContext } from '../src/core/context.js';

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error) => {
      console.error(`  ✗ ${name}\n    ${error.message}`);
      process.exitCode = 1;
    });
}

function makeStore() {
  const meta = {};
  const settingsStore = {};
  const ctx = {
    getChatState: () => meta,
    saveChatState: () => true,
    getExtensionSettings: () => settingsStore,
    saveSettings: () => true,
  };
  return createStateStore(ctx, 'dt');
}

const VALID_OUTLINE_JSON = JSON.stringify({
  objective: '和 user 一起去 D 市旅行',
  title: 'D 市旅行',
  premise: '租民宿住一周',
  stages: [
    {
      title: '询问',
      goal: '知道 user 想不想去',
      activity: '饭桌上问',
      checkpoint: { criteria: 'user 同意出行', antiCriteria: 'user 明确不想出门' },
      beats: ['做饭', '开口'],
    },
    {
      title: '订票',
      goal: '订好机票',
      activity: '买机票',
      checkpoint: { criteria: 'user 确认日期', antiCriteria: 'user 反悔' },
      beats: ['查航班'],
    },
  ],
});

console.log('T-203 大纲与阶段');

await check('normalizeStages 第一个阶段 active，其余 pending', () => {
  const stages = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }, { goal: 'b', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  assert.equal(stages[0].status, 'active');
  assert.equal(stages[1].status, 'pending');
  assert.equal(stages[0].index, 1);
  assert.equal(stages[0].stuckCount, 0);
  assert.equal(stages[0].locked, false);
});

await check('confidence 缺省为 0.6', () => {
  const stages = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  assert.equal(stages[0].checkpoint.confidence, 0.6);
});

await check('generate 成功时返回 outline 与 stages', async () => {
  const client = { request: async () => VALID_OUTLINE_JSON };
  const service = createOutlineService({ client, getConnection: () => ({ endpoint: 'e', model: 'm' }) });
  const result = await service.generate({ premise: '想去旅行' });
  assert.equal(result.ok, true);
  assert.equal(result.outline.title, 'D 市旅行');
  assert.equal(result.outline.objective, '和 user 一起去 D 市旅行');
  assert.equal(result.outline.objectiveSource, 'ai', '没给定目标时来源为 ai');
  assert.equal(result.stages.length, 2);
});

await check('用户指定主目标时 objectiveSource=user（T-416）', async () => {
  const client = { request: async () => VALID_OUTLINE_JSON };
  const service = createOutlineService({ client, getConnection: () => ({}) });
  const result = await service.generate({ objective: '用户定的目标' });
  assert.equal(result.outline.objectiveSource, 'user');
});

await check('模型给的 initiative 必须原样保留（T-417）', () => {
  const stages = normalizeStages([{
    goal: 'a', initiative: '主动翻出旧相册', checkpoint: { criteria: 'x', antiCriteria: 'y' },
  }]);
  assert.equal(stages[0].initiative, '主动翻出旧相册', '不能被占位覆盖');
});

await check('新阶段带 pacing / turnCount / initiative 占位（T-416）', () => {
  const stages = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  assert.equal(stages[0].pacing, null, 'null 表示用全局 pacing');
  assert.equal(stages[0].turnCount, 0);
  assert.equal(stages[0].initiative, '', '没给就留空（T-417）');
  assert.equal(stages[0].will, null, 'null 表示用全局 will（T-405）');
});

await check('模型返回解析不了时 ok:false 且带 raw', async () => {
  const client = { request: async () => '抱歉我做不到' };
  const service = createOutlineService({ client, getConnection: () => ({}) });
  const result = await service.generate({});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PARSE_FAILED');
  assert.equal(typeof result.raw, 'string');
});

await check('API 报错时返回 ok:false 且不抛异常', async () => {
  const client = {
    request: async () => {
      const error = new Error('连接超时');
      error.name = 'TimeoutError';
      throw error;
    },
  };
  const service = createOutlineService({ client, getConnection: () => ({}) });
  const result = await service.generate({});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TimeoutError');
});

console.log('阶段状态机');

await check('load 装载剧本并激活第一个阶段', () => {
  const store = makeStore();
  const stages = createStageService({ store });
  const list = normalizeStages([
    { goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } },
    { goal: 'b', checkpoint: { criteria: 'x', antiCriteria: 'y' } },
  ]);
  stages.load(list);
  assert.equal(store.get().activeStageId, list[0].id);
  assert.equal(stages.getActive().id, list[0].id);
});

await check('advance 完成后激活下一阶段', () => {
  const store = makeStore();
  const stages = createStageService({ store });
  const list = normalizeStages([
    { goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } },
    { goal: 'b', checkpoint: { criteria: 'x', antiCriteria: 'y' } },
  ]);
  stages.load(list);
  stages.advance();
  assert.equal(store.get().stages[0].status, 'done');
  assert.equal(store.get().activeStageId, list[1].id);
});

await check('最后一个阶段推进后 activeStageId 为 null', () => {
  const store = makeStore();
  const stages = createStageService({ store });
  const list = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  stages.load(list);
  stages.advance();
  assert.equal(store.get().activeStageId, null);
  assert.equal(store.get().stages[0].status, 'done');
});

await check('bumpStuck 累加，resetStuck 归零', () => {
  const store = makeStore();
  const stages = createStageService({ store });
  const list = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  stages.load(list);
  const id = list[0].id;
  stages.bumpStuck(id);
  stages.bumpStuck(id);
  assert.equal(store.get().stages[0].stuckCount, 2);
  stages.resetStuck(id);
  assert.equal(store.get().stages[0].stuckCount, 0);
});

await check('locked 的阶段不被 update 改动（项目书 §1.4）', () => {
  const store = makeStore();
  const stages = createStageService({ store });
  const list = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  stages.load(list);
  const id = list[0].id;
  store.update((d) => ({ ...d, stages: d.stages.map((s) => ({ ...s, locked: true })) }));
  stages.update(id, { goal: '被改了' });
  assert.equal(store.get().stages[0].goal, 'a');
});

await check('未锁定的阶段可更新，并保留 aiOriginal', () => {
  const store = makeStore();
  const stages = createStageService({ store });
  const list = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  stages.load(list);
  stages.update(list[0].id, { goal: 'b' });
  assert.equal(store.get().stages[0].goal, 'b');
  assert.ok(store.get().stages[0].aiOriginal);
});

console.log('滚动续写（T-209）');

await check('normalizeStages 续写模式：序号接续、全部 pending', () => {
  const list = normalizeStages([
    { goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } },
    { goal: 'b', checkpoint: { criteria: 'x', antiCriteria: 'y' } },
  ], { startIndex: 4, activateFirst: false });
  assert.equal(list[0].index, 4);
  assert.equal(list[1].index, 5);
  assert.equal(list[0].status, 'pending');
  assert.equal(list[1].status, 'pending');
});

await check('extend 返回续写阶段：全 pending、序号接续', async () => {
  const client = {
    request: async () => JSON.stringify({ stages: [{ goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'a' } }] }),
  };
  const service = createOutlineService({ client, getConnection: () => ({ endpoint: 'e', model: 'm' }) });
  const result = await service.extend({ count: 1, startIndex: 3, outline: { title: 'T', premise: 'P' } });
  assert.equal(result.ok, true);
  assert.equal(result.stages.length, 1);
  assert.equal(result.stages[0].index, 3);
  assert.equal(result.stages[0].status, 'pending');
});

await check('extend 解析失败 → ok:false，不改剧本', async () => {
  const client = { request: async () => '我做不到' };
  const service = createOutlineService({ client, getConnection: () => ({}) });
  const result = await service.extend({ count: 2, startIndex: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PARSE_FAILED');
});

await check('append 追加 pending 阶段，不动当前 active', () => {
  const store = makeStore();
  const stages = createStageService({ store });
  const list = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  stages.load(list);
  const appended = normalizeStages([{ goal: 'b', checkpoint: { criteria: 'x', antiCriteria: 'y' } }], { startIndex: 2, activateFirst: false });
  stages.append(appended);
  assert.equal(store.get().stages.length, 2);
  assert.equal(store.get().activeStageId, list[0].id);
  assert.equal(store.get().stages[1].status, 'pending');
});

await check('没有 active 时 activate 补位', () => {
  const store = makeStore();
  const stages = createStageService({ store });
  const list = normalizeStages([{ goal: 'a', checkpoint: { criteria: 'x', antiCriteria: 'y' } }]);
  stages.load(list);
  stages.advance(); // 演完最后一场 → activeStageId 为 null
  const appended = normalizeStages([{ goal: 'b', checkpoint: { criteria: 'x', antiCriteria: 'y' } }], { startIndex: 2, activateFirst: false });
  stages.append(appended);
  stages.activate(appended[0].id);
  assert.equal(store.get().activeStageId, appended[0].id);
  assert.equal(store.get().stages[1].status, 'active');
});

console.log('T-204 注入注册表');

await check('开关开启时 register 真正注入（走真实链路，参数被封死）', () => {
  const calls = [];
  // 用真实适配层，才能验证 position/depth/scan/role 确实被封死
  const ctx = createSillyTavernContext(() => ({
    setExtensionPrompt: (...args) => calls.push(args),
  }));
  const registry = createPromptRegistry({ ctx, store: makeStore(), getSettings: () => ({ enabled: true, injectEnabled: true }) });
  assert.equal(registry.register('导演指令'), true);
  assert.deepEqual(calls[0], ['director_time', '导演指令', 1, 0, false, 0]);
});

await check('总开关关闭时不注入，且执行清空', () => {
  const calls = [];
  const ctx = {
    setExtensionPrompt: (...args) => calls.push(args),
    clearExtensionPrompt: (key) => calls.push([key, '']),
  };
  const registry = createPromptRegistry({ ctx, store: makeStore(), getSettings: () => ({ enabled: false, injectEnabled: true }) });
  assert.equal(registry.register('导演指令'), false);
  assert.ok(calls.some((c) => c[1] === ''));
});

await check('注入开关关闭时不注入', () => {
  const ctx = { setExtensionPrompt: () => {}, clearExtensionPrompt: () => {} };
  const registry = createPromptRegistry({ ctx, store: makeStore(), getSettings: () => ({ enabled: true, injectEnabled: false }) });
  assert.equal(registry.register('x'), false);
});

await check('clear 幂等，可重复调用', () => {
  let cleared = 0;
  const ctx = { clearExtensionPrompt: () => { cleared += 1; }, setExtensionPrompt: () => {} };
  const registry = createPromptRegistry({ ctx, store: makeStore(), getSettings: () => ({ enabled: true, injectEnabled: true }) });
  registry.clear();
  registry.clear();
  registry.clear();
  assert.equal(cleared, 3);
  assert.equal(registry.getStatus().registered, false);
});

await check('getStatus 反映当前注册内容', () => {
  const ctx = { setExtensionPrompt: () => {}, clearExtensionPrompt: () => {} };
  const registry = createPromptRegistry({ ctx, store: makeStore(), getSettings: () => ({ enabled: true, injectEnabled: true }) });
  registry.register('一段指令');
  const status = registry.getStatus();
  assert.equal(status.registered, true);
  assert.equal(status.text, '一段指令');
  assert.equal(status.length, 4);
});

await check('切聊天时清空（挂生命周期）', () => {
  let handler = null;
  const ctx = {
    on: (_event, fn) => { handler = fn; return () => {}; },
    clearExtensionPrompt: () => {},
    setExtensionPrompt: () => {},
  };
  const registry = createPromptRegistry({ ctx, store: makeStore(), getSettings: () => ({ enabled: true, injectEnabled: true }) });
  registry.installLifecycle();
  registry.register('指令');
  assert.equal(registry.getStatus().registered, true);
  handler?.();
  assert.equal(registry.getStatus().registered, false);
});

console.log(`\n通过 ${passed} 项`);
