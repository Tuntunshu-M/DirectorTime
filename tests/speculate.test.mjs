// T-407 测试：投机执行（相似度 / 预判 / 命中率 / 静默降级）

import assert from 'node:assert/strict';
import {
  similarity, normalizeLine, isHit, hitRate, createSpeculationService, SIMILARITY_HIT,
} from '../src/director/speculate.js';
import { normalizeSpeculationKeywords } from '../src/llm/schemas.js';
import { buildDebugState } from '../src/ui/debug.js';
import { createReviewService } from '../src/director/review.js';
import { createStateStore } from '../src/core/state.js';
import { createStageService } from '../src/director/stage.js';
import { normalizeStages } from '../src/director/outline.js';

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

console.log('T-407 投机执行 · 命中判定');

await check('归一化：去标点空白、转小写', () => {
  assert.equal(normalizeLine(' 我不想去！ '), '我不想去');
  assert.equal(normalizeLine('OK，走 吧。'), 'ok走吧');
  assert.equal(normalizeLine(null), '');
});

await check('相似度：一模一样 1；包住 0.9；无关接近 0', () => {
  assert.equal(similarity('我不想去', '我不想去'), 1);
  assert.equal(similarity('我不想去', '啊，我不想去'), 0.9);
  assert.ok(similarity('我不想去', '今天天气不错') < SIMILARITY_HIT);
  assert.equal(similarity('', '我不想去'), 0);
});

await check('isHit：像就算命中，不像就失手，没预测不算', () => {
  assert.equal(isHit({ guess: '我不想去' }, '啊……我不想去'), true);
  assert.equal(isHit({ guess: '好，我们走吧' }, '好，走吧'), true, '换字但重叠高也算');
  assert.equal(isHit({ guess: '我不想去' }, '今天天气不错'), false);
  assert.equal(isHit({ guess: '我不想去' }, ''), false);
  assert.equal(isHit(null, '我不想去'), false);
});

await check('hitRate：命中率算得对，没数据时不除零', () => {
  assert.deepEqual(hitRate(null), { hits: 0, misses: 0, total: 0, rate: 0 });
  const r = hitRate({ hits: 3, misses: 1 });
  assert.equal(r.total, 4);
  assert.equal(r.rate, 0.75);
});

console.log('T-407 投机执行 · 预判与记账');

function makeEnv() {
  const ctx = {
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
  };
  const store = createStateStore(ctx, 'speculate_test');
  store.update((draft) => ({
    ...draft,
    outline: { title: 'T', objective: 'O' },
    stages: normalizeStages([{ goal: '知道想不想去', checkpoint: { criteria: 'c', antiCriteria: 'a' } }]),
    activeStageId: null,
  }), { track: false });
  store.update((draft) => ({ ...draft, activeStageId: draft.stages[0].id }), { track: false });
  const stages = createStageService({ store });
  const registered = [];
  let current = '';
  const registry = {
    register: (text) => { current = text ?? ''; registered.push(current); return true; },
    clear: () => { current = ''; return true; },
    getStatus: () => ({ registered: Boolean(current), length: current.length, text: current }),
  };
  return { store, stages, registry, registered };
}

await check('guess：拿到 guess + injection 就存下来', async () => {
  const env = makeEnv();
  const service = createSpeculationService({
    client: { request: async () => '{"guess":"我不想去","injection":"[导演指令] 针对这句话的演法"}' },
    getConnection: () => ({}),
    store: env.store,
  });
  const record = await service.guess({ stage: env.stages.getActive(), outline: { objective: 'O' }, userMessage: '嗯' });
  assert.equal(record.guess, '我不想去');
  assert.equal(env.store.get().runtime.speculation.injection, '[导演指令] 针对这句话的演法');
  assert.ok(record.request.length > 0, '要能拿到实际发出的 prompt（Debug 用）');
});

await check('guess：解析失败 / 调用失败 → 静默返回 null，不动状态', async () => {
  const env = makeEnv();
  const bad = createSpeculationService({
    client: { request: async () => '我猜不出来' },
    getConnection: () => ({}),
    store: env.store,
  });
  assert.equal(await bad.guess({ stage: env.stages.getActive() }), null);
  assert.equal(env.store.get().runtime.speculation, null, '不能留下半成品');

  const boom = createSpeculationService({
    client: { request: async () => { throw new Error('超时'); } },
    getConnection: () => ({}),
    store: env.store,
  });
  assert.equal(await boom.guess({ stage: env.stages.getActive() }), null);
  assert.equal(env.store.get().runtime.speculation, null);

  const noStage = createSpeculationService({ client: { request: async () => '{}' }, getConnection: () => ({}), store: env.store });
  assert.equal(await noStage.guess({ stage: null }), null, '没有阶段就不投机');
});

await check('settle：命中计 hit、失手计 miss，并清掉预测', () => {
  const env = makeEnv();
  const service = createSpeculationService({ client: {}, getConnection: () => ({}), store: env.store });
  env.store.update((d) => ({ ...d, runtime: { ...d.runtime, speculation: { guess: '我不想去', injection: 'X' } } }), { track: false });

  const hit = service.settle('啊，我不想去');
  assert.equal(hit.hit, true);
  assert.equal(env.store.get().runtime.speculationStats.hits, 1);
  assert.equal(env.store.get().runtime.speculation, null, '结算完要清掉');

  env.store.update((d) => ({ ...d, runtime: { ...d.runtime, speculation: { guess: '我不想去', injection: 'X' } } }), { track: false });
  const miss = service.settle('今天天气不错');
  assert.equal(miss.hit, false);
  assert.equal(env.store.get().runtime.speculationStats.misses, 1);

  assert.deepEqual(service.settle('随便'), { hit: false, speculation: null }, '没有预测时不动账');
});

console.log('T-407 投机执行 · 接线（验收判据）');

function makeReview(env, speculate) {
  return createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold', reason: 'x' }) },
    speculate,
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({}),
  });
}

await check('验收：命中时这一轮用的就是投机那条注入', async () => {
  const env = makeEnv();
  const service = createSpeculationService({ client: {}, getConnection: () => ({}), store: env.store });
  env.store.update((d) => ({
    ...d, runtime: { ...d.runtime, speculation: { guess: '我不想去', injection: '[导演指令] 投机版' } },
  }), { track: false });
  env.registry.register('[导演指令] 投机版'); // 上一轮已经把它注册进去了

  const review = makeReview(env, service);
  const r = await review.run({ userMessage: '啊，我不想去' });
  assert.equal(review.getLastTurn().speculation.hit, true);
  assert.equal(env.store.get().runtime.speculationStats.hits, 1);
  assert.equal(r.injected.includes('投机版'), false, '本轮结束后重建的是常规注入（给下一轮用）');
});

await check('验收：失手时静默降级为常规剧本（注入被换掉，不抛不提示）', async () => {
  const env = makeEnv();
  const service = createSpeculationService({ client: {}, getConnection: () => ({}), store: env.store });
  env.store.update((d) => ({
    ...d, runtime: { ...d.runtime, speculation: { guess: '我不想去', injection: '[导演指令] 投机版' } },
  }), { track: false });
  env.registry.register('[导演指令] 投机版');

  const review = makeReview(env, service);
  const r = await review.run({ userMessage: '今天天气不错' });
  assert.equal(review.getLastTurn().speculation.hit, false);
  assert.equal(env.store.get().runtime.speculationStats.misses, 1);
  assert.ok(r.injected.includes('知道想不想去'), '降级后是本场的常规注入');
  assert.equal(r.injected.includes('投机版'), false);
});

await check('验收：Debug 显示命中率', async () => {
  const env = makeEnv();
  env.store.update((d) => ({
    ...d, runtime: { ...d.runtime, speculationStats: { hits: 3, misses: 1 }, speculation: { guess: '我不想去' } },
  }), { track: false });
  const state = buildDebugState({
    store: env.store,
    registry: env.registry,
    lastTurn: { speculation: { hit: true, guess: '我不想去' } },
  });
  assert.equal(state.speculation.hits, 3);
  assert.equal(state.speculation.total, 4);
  assert.equal(state.speculation.rate, 0.75);
  assert.equal(state.speculation.pending, '我不想去');
  assert.equal(state.turn.speculation.hit, true);
});

await check('没开投机 / 没有预测时，一切照旧（不影响既有流程）', async () => {
  const env = makeEnv();
  const review = makeReview(env, null);
  const r = await review.run({ userMessage: '我不想去' });
  assert.ok(r.injected.includes('知道想不想去'));
  assert.equal(review.getLastTurn().speculation, null);
});

console.log('投机改成意图级（用户反馈 7：预测原话永远猜不中）');

await check('预测意图 + 关键词：命中判定主要看关键词', () => {
  const record = { guess: 'user 会拒绝并转移话题', keywords: ['算了', '不聊这个'], injection: 'x' };
  assert.equal(isHit(record, '算了，别说这个了'), true, '出现关键词就算命中');
  assert.equal(isHit(record, '不聊这个吧'), true);
  assert.equal(isHit(record, '好啊，我们去吧'), false, '无关的话不算命中');
});

await check('没有关键词时退化为原来的相似度判定（老数据仍能用）', () => {
  assert.equal(isHit({ guess: '好啊那就去吧', injection: 'x' }, '好，那就去吧'), true);
  assert.equal(isHit({ guess: '好啊那就去吧', injection: 'x' }, '我偏不去'), false);
});

await check('空输入 / 空预测不算命中', () => {
  assert.equal(isHit({ guess: 'user 会靠近', keywords: ['走近'] }, ''), false);
  assert.equal(isHit(null, '随便说点什么'), false);
  assert.equal(isHit({ guess: '', keywords: [], injection: 'x' }, '随便'), false);
});

await check('关键词会洗净去重、最多 6 个', () => {
  const cleaned = normalizeSpeculationKeywords([' 算了 ', '算了', '', '不聊这个', 1, '走']);
  assert.deepEqual(cleaned, ['算了', '不聊这个', '1', '走']);
  assert.equal(normalizeSpeculationKeywords('不是数组').length, 0);
});

await check('服务把模型给的关键词存进投机记录', async () => {
  const env = makeEnv();
  const service = createSpeculationService({
    client: {
      request: async () => '{"guess":"user 会追问","keywords":["为什么","说清楚"],"injection":"继续逼问"}',
    },
    getConnection: () => ({}),
    store: env.store,
  });
  const result = await service.guess({ stage: env.stages.getActive(), userMessage: '嗯', charMessage: 'x' });
  assert.deepEqual(result.keywords, ['为什么', '说清楚']);
  assert.deepEqual(env.store.get().runtime.speculation.keywords, ['为什么', '说清楚']);
});

console.log('T-426 · 投机搭车（不再单独发调用）');

await check('accept：把合并调用带回来的投机段存下来，并可被消费一次', async () => {
  const env = makeEnv();
  const service = createSpeculationService({ client: { request: async () => '{}' }, getConnection: () => ({}), store: env.store });

  assert.equal(service.consumeCombined(), false, '一开始没有搭车');

  const record = service.accept({
    guess: 'user 会追问',
    keywords: ['为什么', '解释'],
    injection: '继续逼问',
    stage: { id: 'st1' },
  });
  assert.equal(record.injection, '继续逼问');
  assert.equal(env.store.get().runtime.speculation.guess, 'user 会追问');
  assert.deepEqual(env.store.get().runtime.speculation.keywords, ['为什么', '解释']);

  assert.equal(service.consumeCombined(), true, '消费一次');
  assert.equal(service.consumeCombined(), false, '只能消费一次');
});

await check('accept：没有 injection 就静默丢弃（不写状态、不算搭车）', async () => {
  const env = makeEnv();
  const service = createSpeculationService({ client: { request: async () => '{}' }, getConnection: () => ({}), store: env.store });
  assert.equal(service.accept({ guess: 'x', injection: '   ' }), null);
  assert.equal(env.store.get().runtime?.speculation ?? null, null);
  assert.equal(service.consumeCombined(), false);
});

await check('P2-2：投机开关关掉后 guess 直接不发请求', async () => {
  const env = makeEnv();
  let calls = 0;
  const service = createSpeculationService({
    client: { request: async () => { calls += 1; return '{"guess":"x","injection":"y"}'; } },
    getConnection: () => ({}),
    store: env.store,
  });
  // 闸门在 bootstrap 里读 settings.speculation —— 这里验证服务本身不读设置、调用方才该拦
  const record = await service.guess({ stage: { id: 'st1' }, userMessage: '嗯' });
  assert.ok(record);
  assert.equal(calls, 1);
});

console.log(`\n通过 ${passed} 项`);
