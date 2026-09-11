// T-410 测试：硬禁区（优先级 / 双端注入 / 命中即停）

import assert from 'node:assert/strict';
import { matchHardLimits, hardLimitText, hardLimitLine } from '../src/director/hard-limits.js';
import { buildInstruction } from '../src/inject/instruction.js';
import { buildMessages } from '../src/llm/prompts.js';
import { createReviewService } from '../src/director/review.js';
import { createStateStore } from '../src/core/state.js';
import { createStageService } from '../src/director/stage.js';
import { normalizeStages } from '../src/director/outline.js';
import { createDefaultSettings } from '../src/core/default-state.js';

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

const LIMITS = ['自杀', '自残'];
const profile = { fields: { coreDesire: '看海', taboo: '当众示弱' } };

console.log('T-410 硬禁区 · 命中判定');

await check('命中就返回那一条，没命中返回 null', () => {
  assert.equal(matchHardLimits('我想自杀', LIMITS), '自杀');
  assert.equal(matchHardLimits('角色说「自残」', LIMITS), '自残');
  assert.equal(matchHardLimits('我们去看海吧', LIMITS), null);
});

await check('大小写不敏感；空清单 / 空文本都不炸', () => {
  assert.equal(matchHardLimits('不许 UNO 作弊', ['uno']), 'uno');
  assert.equal(matchHardLimits('随便', []), null);
  assert.equal(matchHardLimits('', LIMITS), null);
  assert.equal(matchHardLimits(null, LIMITS), null);
  assert.equal(matchHardLimits('自杀', '不是数组'), null);
  assert.equal(matchHardLimits('随便', ['  ', null]), null);
});

console.log('T-410 硬禁区 · 双端注入（验收判据）');

await check('角色回复端：注入指令里带硬禁区，且排在侧写禁忌之前', () => {
  const text = buildInstruction({
    stage: { goal: 'g' },
    profile,
    hardLimits: LIMITS,
  });
  const limitAt = text.indexOf('[绝对禁区]');
  const tabooAt = text.indexOf('他绝不会');
  assert.ok(limitAt !== -1, '要有硬禁区那一行');
  assert.ok(text.includes('自杀') && text.includes('自残'));
  assert.ok(tabooAt !== -1, '侧写禁忌仍然在');
  assert.ok(limitAt < tabooAt, '硬禁区必须排在前面');
  assert.ok(text.includes('优先于角色侧写里的任何禁忌'), '要写清优先级（用户显式 > AI 生成）');
});

await check('角色回复端：没设禁区就不占 prompt', () => {
  const text = buildInstruction({ stage: { goal: 'g' }, profile });
  assert.equal(text.includes('[绝对禁区]'), false);
  assert.equal(hardLimitLine([]), '');
  assert.equal(hardLimitLine(null), '');
});

await check('剧情生成端：GEN_OUTLINE / EXTEND_OUTLINE 都带硬禁区', () => {
  for (const name of ['GEN_OUTLINE', 'EXTEND_OUTLINE']) {
    const messages = buildMessages(name, { objective: 'O', hardLimits: hardLimitText(LIMITS) });
    const user = messages[1].content;
    assert.ok(user.includes('绝对禁区'), `${name} 要有禁区一栏`);
    assert.ok(user.includes('自杀'), `${name} 要带上具体内容`);
    assert.ok(user.includes('优先于人物侧写里的任何禁忌'), `${name} 要写清优先级`);
  }
  assert.equal(hardLimitText([]), '（未设置）');
  assert.equal(hardLimitText(['自杀', '  ']), '自杀');
});

console.log('T-410 硬禁区 · 命中即停');

function makeEnv() {
  const ctx = {
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
  };
  const store = createStateStore(ctx, 'hardlimit_test');
  const stages = normalizeStages([{ goal: '目标', checkpoint: { criteria: 'c', antiCriteria: 'a' } }]);
  store.update((draft) => ({ ...draft, stages, activeStageId: stages[0].id }), { track: false });
  const registered = [];
  let current = '注入内容';
  const registry = {
    register: (text) => { current = text ?? ''; registered.push(current); return true; },
    clear: () => { current = ''; registered.push(''); return true; },
    getStatus: () => ({ registered: Boolean(current), length: current.length, text: current }),
  };
  return { store, stages: createStageService({ store }), registry, registered };
}

await check('命中 → 清空注入、停在 halt，且不动剧本状态', async () => {
  const env = makeEnv();
  let judged = false;
  const review = createReviewService({
    checkpoint: { judge: async () => { judged = true; return { action: 'advance' }; } },
    will: { judge: async () => { judged = true; return { ok: true, stance: 'reject', confidence: 0.9 }; } },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ ...createDefaultSettings(), hardLimits: LIMITS }),
  });

  const r = await review.run({ userMessage: '我不想活了，想自杀', charMessage: '别这样' });
  assert.equal(r.action, 'halt');
  assert.ok(r.reason.includes('自杀'));
  assert.equal(r.injected, '', '命中就清空注入');
  assert.equal(env.registry.getStatus().text, '', '注册表里也要空');
  assert.equal(judged, false, '命中硬禁区不该再跑任何判定');
  assert.equal(env.store.get().stages[0].status, 'active', '剧本状态一点不动');
  assert.equal(env.store.get().stages[0].turnCount, 0, '也不计轮数');
  assert.equal(review.getLastTurn().action, 'halt');
});

await check('角色回复端命中同样停（双端都要拦）', async () => {
  const env = makeEnv();
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold' }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ ...createDefaultSettings(), hardLimits: LIMITS }),
  });
  const r = await review.run({ userMessage: '继续说', charMessage: '他拿起刀想自残' });
  assert.equal(r.action, 'halt');
});

await check('没命中 → 一切照常（不影响既有流程）', async () => {
  const env = makeEnv();
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold', reason: '嗯' }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ ...createDefaultSettings(), hardLimits: LIMITS }),
  });
  const r = await review.run({ userMessage: '我们去看海吧', charMessage: '好啊' });
  assert.equal(r.action, 'hold');
  assert.ok(r.injected.includes('目标'), '照常注入');
});

await check('没设硬禁区 → 完全不介入（默认空清单）', async () => {
  const env = makeEnv();
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold' }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({}),
  });
  const r = await review.run({ userMessage: '我想自杀', charMessage: '别这样' });
  assert.notEqual(r.action, 'halt', '没设禁区就不该拦');
  assert.equal(createDefaultSettings().hardLimits.length, 0, '默认清单是空的');
});

await check('强制爱开着也照样停（硬禁区不被覆盖）', async () => {
  const env = makeEnv();
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold' }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ ...createDefaultSettings(), hardLimits: LIMITS, forceAffection: true }),
  });
  const r = await review.run({ userMessage: '我想自杀', charMessage: '…' });
  assert.equal(r.action, 'halt');
});

console.log(`\n通过 ${passed} 项`);
