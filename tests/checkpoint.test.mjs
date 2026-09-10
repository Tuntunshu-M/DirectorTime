// T-205 测试：推进点判定与放行规则
// 这段逻辑是「剧情卡死」的根治手段，必须逐分支覆盖。

import assert from 'node:assert/strict';
import { decide, createCheckpointService } from '../src/director/checkpoint.js';

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

console.log('T-205 放行规则');

await check('达成 → advance', () => {
  assert.equal(decide({ status: 'achieved', confidence: 0.9 }).action, 'advance');
});

await check('明确违背且高置信 → redirect（不推进）', () => {
  assert.equal(decide({ status: 'violated', confidence: 0.9 }).action, 'redirect');
});

await check('违背但置信不足 → 仍然放行', () => {
  const r = decide({ status: 'violated', confidence: 0.5 });
  assert.equal(r.action, 'advance');
  assert.ok(r.reason.includes('放行'));
});

await check('部分达成且高置信 → rewrite（换走位再试）', () => {
  assert.equal(decide({ status: 'partial', confidence: 0.8 }).action, 'rewrite');
});

await check('未达成且高置信 → retry', () => {
  assert.equal(decide({ status: 'pending', confidence: 0.9, }, { stuckCount: 0 }).action, 'retry');
});

await check('连续卡住达阈值 → force（熔断）', () => {
  const r = decide({ status: 'pending', confidence: 0.9 }, { stuckCount: 2, stuckThreshold: 3 });
  assert.equal(r.action, 'force');
  assert.ok(r.reason.includes('熔断'));
});

await check('未达成但置信不足 → 放行（关键：防止卡死）', () => {
  const r = decide({ status: 'pending', confidence: 0.4 });
  assert.equal(r.action, 'advance');
});

await check('阈值可调', () => {
  // 阈值 0.3 时，confidence 0.5 算够，pending 应 retry 而非放行
  assert.equal(decide({ status: 'pending', confidence: 0.5 }, { threshold: 0.3 }).action, 'retry');
  // 阈值 0.9 时，confidence 0.5 不够，放行
  assert.equal(decide({ status: 'pending', confidence: 0.5 }, { threshold: 0.9 }).action, 'advance');
});

await check('confidence 缺失时按 0 处理（放行）', () => {
  assert.equal(decide({ status: 'pending' }).action, 'advance');
});

await check('阈值边界：等于阈值不算不足', () => {
  // confidence === threshold 时不触发放行分支
  assert.equal(decide({ status: 'pending', confidence: 0.7 }, { threshold: 0.7 }).action, 'retry');
});

console.log('判定服务');

function makeStages(active) {
  return { getActive: () => active };
}

await check('没有进行中的阶段 → hold', async () => {
  const service = createCheckpointService({
    client: { request: async () => '{}' },
    stages: makeStages(null),
    getConnection: () => ({}),
    getSettings: () => ({}),
  });
  const r = await service.judge({ userMessage: 'x' });
  assert.equal(r.action, 'hold');
});

await check('模型返回合法判定时给出对应动作', async () => {
  const service = createCheckpointService({
    client: { request: async () => '{"status":"achieved","confidence":0.95,"reason":"答应了"}' },
    stages: makeStages({ id: 'a', goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'ac' }, stuckCount: 0 }),
    getConnection: () => ({}),
    getSettings: () => ({}),
  });
  const r = await service.judge({ userMessage: '好啊那就去吧' });
  assert.equal(r.action, 'advance');
  assert.equal(r.judgement.status, 'achieved');
});

await check('判定结果解析不了 → hold 并保留原文', async () => {
  const service = createCheckpointService({
    client: { request: async () => '我不知道' },
    stages: makeStages({ id: 'a', goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'ac' }, stuckCount: 0 }),
    getConnection: () => ({}),
    getSettings: () => ({}),
  });
  const r = await service.judge({ userMessage: 'x' });
  assert.equal(r.action, 'hold');
  assert.equal(r.raw, '我不知道');
});

await check('API 调用失败 → hold 且不计入卡住', async () => {
  const service = createCheckpointService({
    client: {
      request: async () => {
        const e = new Error('超时');
        e.name = 'TimeoutError';
        throw e;
      },
    },
    stages: makeStages({ id: 'a', goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'ac' }, stuckCount: 0 }),
    getConnection: () => ({}),
    getSettings: () => ({}),
  });
  const r = await service.judge({ userMessage: 'x' });
  assert.equal(r.action, 'hold');
  assert.equal(r.reason, '超时');
});

console.log(`\n通过 ${passed} 项`);
