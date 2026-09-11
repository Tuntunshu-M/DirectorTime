// T-414 测试：三级自动化档位（六点独立 / L0 不跑 / L1 待确认 / L2 直接生效）

import assert from 'node:assert/strict';
import {
  FEATURES, LEVELS, FEATURE_LABELS, normalizeLevel, normalizeAutomation, getLevel, gate, setLevel, automationText,
} from '../src/core/automation.js';
import { createReviewQueue } from '../src/core/review-queue.js';
import { createReviewService } from '../src/director/review.js';
import { createStateStore } from '../src/core/state.js';
import { createStageService } from '../src/director/stage.js';
import { normalizeStages } from '../src/director/outline.js';
import { createDefaultAutomation } from '../src/core/default-state.js';

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('T-414 档位 · 设置');

await check('六个功能点各自可设，互不影响（验收判据 1）', () => {
  assert.equal(FEATURES.length, 6);
  assert.equal(LEVELS.join(','), 'L0,L1,L2');
  for (const feature of FEATURES) assert.ok(FEATURE_LABELS[feature], `${feature} 要有中文标签`);

  let automation = normalizeAutomation(createDefaultAutomation());
  automation = setLevel(automation, 'stanceJudge', 'L0');
  assert.equal(getLevel(automation, 'stanceJudge'), 'L0');
  for (const other of FEATURES.filter((f) => f !== 'stanceJudge')) {
    assert.equal(getLevel(automation, other), getLevel(normalizeAutomation(createDefaultAutomation()), other), `${other} 不该被带动`);
  }
});

await check('认不出的档位回落到默认；缺项补齐', () => {
  assert.equal(normalizeLevel('l2'), 'L2');
  assert.equal(normalizeLevel('乱写'), 'L2');
  assert.equal(normalizeLevel(undefined, 'L1'), 'L1');
  assert.deepEqual(normalizeAutomation({}), normalizeAutomation(createDefaultAutomation()));
  assert.equal(normalizeAutomation({ outline: 'L0' }).outline, 'L0');
  assert.equal(setLevel({}, '不存在的功能', 'L0').outline, normalizeAutomation({}).outline);
});

await check('gate：L0 不跑 / L1 排队 / L2 直接生效', () => {
  assert.deepEqual(gate({ outline: 'L0' }, 'outline'), { feature: 'outline', level: 'L0', auto: false, queue: false, apply: false });
  assert.deepEqual(gate({ outline: 'L1' }, 'outline'), { feature: 'outline', level: 'L1', auto: true, queue: true, apply: false });
  assert.deepEqual(gate({ outline: 'L2' }, 'outline'), { feature: 'outline', level: 'L2', auto: true, queue: false, apply: true });
});

await check('automationText 给人看的一行摘要', () => {
  const text = automationText(createDefaultAutomation());
  assert.ok(text.includes('大纲 L1'));
  assert.ok(text.includes('立场判定 L2'));
});

console.log('T-414 档位 · 待审核队列');

function makeEnv(automation) {
  const ctx = {
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
  };
  const store = createStateStore(ctx, 'automation_test');
  const stages = normalizeStages([
    { goal: '第一场', checkpoint: { criteria: 'c1', antiCriteria: 'a1' } },
    { goal: '第二场', checkpoint: { criteria: 'c2', antiCriteria: 'a2' } },
  ]);
  store.update((draft) => ({ ...draft, stages, activeStageId: stages[0].id }), { track: false });
  const registered = [];
  const registry = {
    register: (text) => { registered.push(text ?? ''); return true; },
    clear: () => true,
    getStatus: () => ({ registered: true, length: 1, text: registered[registered.length - 1] ?? '' }),
  };
  return {
    store,
    stages: createStageService({ store }),
    registry,
    queue: createReviewQueue({ store }),
    getSettings: () => ({ automation, pacing: { min: 3, max: 8 } }),
  };
}

await check('队列：入队 / 列表 / 确认（跑应用动作）/ 驳回 / 清空', async () => {
  const env = makeEnv();
  const entry = env.queue.add({ feature: 'outline', payload: { n: 1 }, summary: 'S' });
  assert.ok(entry.id);
  assert.equal(env.queue.list().length, 1);
  assert.equal(env.store.get().pendingReview.length, 1, '队列要落在 state 里（切页面不丢）');

  let applied = null;
  const ok = await env.queue.approve(entry.id, { outline: (payload) => { applied = payload; return true; } });
  assert.equal(ok.ok, true);
  assert.deepEqual(applied, { n: 1 }, '确认后才跑应用动作');
  assert.equal(env.queue.list().length, 0, '确认后出队');

  const second = env.queue.add({ feature: 'outline', payload: {}, summary: 'x' });
  await env.queue.reject(second.id);
  assert.equal(env.queue.list().length, 0);

  env.queue.add({ feature: 'outline', payload: {}, summary: 'x' });
  env.queue.clear();
  assert.equal(env.store.get().pendingReview.length, 0);
});

await check('队列：应用失败就不销账，条目留着可以再试', async () => {
  const env = makeEnv();
  const entry = env.queue.add({ feature: 'stageRegen', payload: {}, summary: 'x' });
  const failed = await env.queue.approve(entry.id, { stageRegen: () => false });
  assert.equal(failed.ok, false);
  assert.equal(env.queue.list().length, 1, '失败要留在队列里');

  const boom = await env.queue.approve(entry.id, { stageRegen: () => { throw new Error('炸'); } });
  assert.equal(boom.ok, false);
  assert.equal(env.queue.list().length, 1);

  assert.equal((await env.queue.approve('不存在', {})).ok, false);
});

console.log('T-414 档位 · 接线（验收判据 2）');

await check('推进点判定 L0 → 不自动判定，剧本不动', async () => {
  const env = makeEnv({ stanceJudge: 'L2', checkpointJudge: 'L0' });
  let judged = false;
  const review = createReviewService({
    checkpoint: { judge: async () => { judged = true; return { action: 'advance' }; } },
    queue: env.queue,
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: env.getSettings,
  });
  const r = await review.run({ userMessage: '嗯' });
  assert.equal(judged, false, 'L0 不该调判定');
  assert.equal(r.action, 'hold');
  assert.equal(env.store.get().activeStageId, env.store.get().stages[0].id, '没切场');
  assert.equal(env.queue.list().length, 0, 'L0 不进队列');
});

await check('立场判定 L0 → 不判态度，直接走推进点判定', async () => {
  const env = makeEnv({ stanceJudge: 'L0', checkpointJudge: 'L2' });
  let stanceCalled = false;
  let checkpointCalled = false;
  const review = createReviewService({
    checkpoint: { judge: async () => { checkpointCalled = true; return { action: 'advance' }; } },
    will: { judge: async () => { stanceCalled = true; return { ok: true, stance: 'reject', confidence: 0.9 }; } },
    initiative: null,
    queue: env.queue,
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: env.getSettings,
  });
  const r = await review.run({ userMessage: '我不要去' });
  assert.equal(stanceCalled, false, 'L0 不该判态度');
  assert.equal(checkpointCalled, true, '照常走推进点判定');
  assert.equal(r.action, 'advance');
});

await check('判定 L1 → 照跑、结果进队列、本轮按保守动作；确认后才生效', async () => {
  const env = makeEnv({ stanceJudge: 'L2', checkpointJudge: 'L1' });
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance', reason: '达成', judgement: { status: 'achieved', confidence: 0.9 } }) },
    queue: env.queue,
    topUp: null,
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: env.getSettings,
  });

  const r = await review.run({ userMessage: '好啊' });
  assert.equal(r.action, 'hold', 'L1 本轮不生效');
  assert.equal(env.store.get().stages[0].status, 'active', '剧本一点没动');
  const pending = env.queue.list();
  assert.equal(pending.length, 1, '判定结果要进队列');
  assert.equal(pending[0].feature, 'checkpointJudge');
  assert.equal(pending[0].payload.action, 'advance');
  assert.equal(review.getLastTurn().queued.id, pending[0].id, '回放里能看到进队了');

  // 确认 → 动作落地
  const ok = await env.queue.approve(pending[0].id, { checkpointJudge: (payload) => review.applyConfirmed(payload) });
  assert.equal(ok.ok, true);
  assert.equal(env.store.get().stages[0].status, 'done', '确认后才真的切场');
  assert.equal(env.queue.list().length, 0);
});

await check('立场判定 L1 → 让步类动作也要等确认（不会偷偷作废剧本）', async () => {
  const env = makeEnv({ stanceJudge: 'L1', checkpointJudge: 'L2' });
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold' }) },
    will: { judge: async () => ({ ok: true, stance: 'reject', confidence: 0.9 }) },
    queue: env.queue,
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ automation: { stanceJudge: 'L1' }, will: 90, pacing: { min: 3, max: 8 } }),
  });

  const r = await review.run({ userMessage: '我不想去' });
  assert.equal(r.action, 'hold');
  assert.equal(env.store.get().stages[0].status, 'active', '剧本没被作废');
  const pending = env.queue.list();
  assert.equal(pending[0].feature, 'stanceJudge');
  assert.equal(pending[0].payload.action, 'regenAfter', '判定结果如实记着');
});

await check('L2 → 与以前完全一样（不排队、直接生效）', async () => {
  const env = makeEnv({ stanceJudge: 'L2', checkpointJudge: 'L2' });
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance', reason: '达成' }) },
    queue: env.queue,
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: env.getSettings,
  });
  const r = await review.run({ userMessage: '好啊' });
  assert.equal(r.action, 'advance');
  assert.equal(env.store.get().stages[0].status, 'done', '直接生效');
  assert.equal(env.store.get().pendingReview.length, 0, 'L2 不排队');
});

await check('没配 automation 时用默认档（不改变既有行为）', async () => {
  const env = makeEnv(undefined);
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance' }) },
    queue: env.queue,
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({}),
  });
  const r = await review.run({ userMessage: '好啊' });
  assert.equal(r.action, 'advance');
});

console.log(`\n通过 ${passed} 项`);
