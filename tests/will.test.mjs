// T-405 测试：用户意愿矩阵（决策表 15 组全覆盖 + 态度判定降级）

import assert from 'node:assert/strict';
import {
  resolve, isConcession, willTier, createWillService,
  DEFAULT_WILL, WILL_LOW_MAX, WILL_MID_MAX, CONFIDENCE_FLOOR,
} from '../src/director/will.js';

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

console.log('T-405 意愿矩阵 · 决策表');

/** 规格 §三 的 15 格，逐格写死期望值，缺一格就算漏 */
const TABLE_CASES = [
  // accept：三档都推进
  ['accept', 10, 'advance'], ['accept', 50, 'advance'], ['accept', 90, 'advance'],
  // hesitate：低档轻推，中/高档停留
  ['hesitate', 10, 'advance'], ['hesitate', 50, 'hold'], ['hesitate', 90, 'hold'],
  // reject：低档先试一次，中档让步，高档让步并重生成
  ['reject', 10, 'retry'], ['reject', 50, 'drop'], ['reject', 90, 'regenAfter'],
  // irrelevant：低/中跟一楼再拉回，高档跟着走
  ['irrelevant', 10, 'hold'], ['irrelevant', 50, 'hold'], ['irrelevant', 90, 'follow'],
  // redirect：低/中本场演完，高档立即转向
  ['redirect', 10, 'hold'], ['redirect', 50, 'hold'], ['redirect', 90, 'regenAfter'],
];

await check('15 个组合（5 stance × 3 档 will）逐格覆盖', () => {
  assert.equal(TABLE_CASES.length, 15);
  const seen = new Set();
  for (const [stance, will, expected] of TABLE_CASES) {
    const r = resolve({ stance, confidence: 0.9, will });
    assert.equal(r.action, expected, `${stance} @ will=${will} 应为 ${expected}，实为 ${r.action}`);
    assert.ok(r.reason.length > 0, '每格都要有理由');
    seen.add(`${stance}|${r.tier}`);
  }
  assert.equal(seen.size, 15, '15 格必须互不重复');
});

await check('willTier 三档边界', () => {
  assert.equal(willTier(0), 'low');
  assert.equal(willTier(WILL_LOW_MAX), 'low');
  assert.equal(willTier(WILL_LOW_MAX + 1), 'mid');
  assert.equal(willTier(WILL_MID_MAX), 'mid');
  assert.equal(willTier(WILL_MID_MAX + 1), 'high');
  assert.equal(willTier(100), 'high');
  assert.equal(willTier(undefined), 'high', `缺省按默认 ${DEFAULT_WILL} 处理`);
  assert.equal(willTier('abc'), 'high');
});

console.log('T-405 验收判据');

await check('判据 1：Will=90 且 user 反对 → 让步并作废当前阶段（不是继续推进）', () => {
  const r = resolve({ stance: 'reject', confidence: 0.9, will: 90 });
  assert.equal(r.action, 'regenAfter');
  assert.notEqual(r.action, 'advance');
  assert.equal(r.tier, 'high');
});

await check('判据 2：Will=10 且 user 反对 → 换走位再试一次，第二次仍拒才让步', () => {
  const first = resolve({ stance: 'reject', confidence: 0.9, will: 10, stuckCount: 0 });
  assert.equal(first.action, 'retry', '第一次坚持一次');

  const second = resolve({ stance: 'reject', confidence: 0.9, will: 10, stuckCount: 1 });
  assert.equal(second.action, 'drop', '第二次让步');
  assert.ok(second.reason.includes('再次拒绝'));
});

await check('判据 3：Will=80 且 user 说无关的 → 不硬拉（暂停）；低/中档跟一两楼再拉回', () => {
  assert.equal(resolve({ stance: 'irrelevant', confidence: 0.9, will: 80 }).action, 'follow');
  assert.equal(resolve({ stance: 'irrelevant', confidence: 0.9, will: 20 }).action, 'hold');
  assert.equal(resolve({ stance: 'irrelevant', confidence: 0.9, will: 50 }).action, 'hold');
});

await check('判据 4：confidence < 0.7 → 按 accept 处理（推进，不卡住）', () => {
  for (const stance of ['reject', 'irrelevant', 'redirect', 'hesitate']) {
    const r = resolve({ stance, confidence: CONFIDENCE_FLOOR - 0.1, will: 90 });
    assert.equal(r.action, 'advance', `${stance} 置信不足应放行`);
    assert.equal(r.floored, true);
  }
  assert.equal(resolve({ stance: 'reject', confidence: undefined, will: 90 }).action, 'advance');
  assert.equal(resolve({ stance: '瞎写', confidence: 0.9, will: 90 }).action, 'advance', '不认识的 stance 也放行');
});

await check('判据 5：卡住达阈值 → 强制推进，不看 Will（防死锁）', () => {
  for (const will of [10, 50, 90]) {
    const r = resolve({ stance: 'reject', confidence: 0.9, will, stuckCount: 2, stuckThreshold: 3 });
    assert.equal(r.action, 'advance');
    assert.ok(r.reason.includes('熔断'));
  }
  // 阈值可调
  assert.equal(resolve({ stance: 'reject', confidence: 0.9, will: 90, stuckCount: 0, stuckThreshold: 1 }).action, 'advance');
});

await check('isConcession：advance 之外的矩阵动作都算让步类', () => {
  assert.equal(isConcession('advance'), false);
  for (const action of ['retry', 'hold', 'drop', 'regenAfter', 'follow']) {
    assert.equal(isConcession(action), true, `${action} 应算让步类`);
  }
});

console.log('T-405 态度判定');

function makeStage(goal = '知道 user 想不想去') {
  return { id: 'a', goal };
}

await check('判出态度时返回 stance 与 confidence', async () => {
  const service = createWillService({
    client: { request: async () => '{"stance":"reject","confidence":0.85}' },
    getConnection: () => ({}),
  });
  const r = await service.judge({ stage: makeStage(), userMessage: '我不去' });
  assert.equal(r.ok, true);
  assert.equal(r.stance, 'reject');
  assert.equal(r.confidence, 0.85);
  assert.equal(resolve({ stance: r.stance, confidence: r.confidence, will: 90 }).action, 'regenAfter');
});

await check('解析失败 → 降级为 accept（本轮照常走推进点判定，不注入半成品）', async () => {
  const service = createWillService({
    client: { request: async () => '我不想回答' },
    getConnection: () => ({}),
  });
  const r = await service.judge({ stage: makeStage(), userMessage: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.stance, 'accept');
  assert.equal(resolve({ stance: r.stance, confidence: r.confidence, will: 90 }).action, 'advance');
});

await check('API 调用失败 → 降级为 accept，不抛异常', async () => {
  const service = createWillService({
    client: { request: async () => { const e = new Error('超时'); e.name = 'TimeoutError'; throw e; } },
    getConnection: () => ({}),
  });
  const r = await service.judge({ stage: makeStage(), userMessage: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.stance, 'accept');
  assert.equal(r.reason, '超时');
});

await check('没有进行中的阶段 → 不调 API', async () => {
  let called = false;
  const service = createWillService({
    client: { request: async () => { called = true; return '{}'; } },
    getConnection: () => ({}),
  });
  const r = await service.judge({ stage: null, userMessage: 'x' });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

console.log(`\n通过 ${passed} 项`);
