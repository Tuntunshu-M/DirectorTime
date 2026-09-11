// T-405 测试：用户意愿矩阵（决策表 15 组全覆盖 + 态度判定降级）

import assert from 'node:assert/strict';
import {
  resolve, shouldRunCheckpoint, willTier, createWillService,
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
  // reject：低档先换个说法再试，中档让步，高档让步并重生成
  ['reject', 10, 'rewrite'], ['reject', 50, 'drop'], ['reject', 90, 'regenAfter'],
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
  // 表（§三 核心）与拍板 (a) 都写「高 = regenAfter（让步 + 重生成后续）」，regenAfter 本身包含作废本场
  assert.ok(['drop', 'regenAfter'].includes(r.action), `应作废当前阶段，实为 ${r.action}`);
  assert.notEqual(r.action, 'advance');
  assert.equal(r.tier, 'high');
});

await check('判据 2：Will=10 且 user 反对 → 换个说法再试一次，已拒过一次才转 drop', () => {
  const first = resolve({ stance: 'reject', confidence: 0.9, will: 10, stuckCount: 0 });
  assert.equal(first.action, 'rewrite', '第一次坚持一次');

  const second = resolve({ stance: 'reject', confidence: 0.9, will: 10, stuckCount: 1 });
  assert.equal(second.action, 'drop', '第二次让步');
  assert.ok(second.reason.includes('再次拒绝'));
});

await check('判据 3：Will=50 且 user 反对 → drop（不是 rewrite）', () => {
  assert.equal(resolve({ stance: 'reject', confidence: 0.9, will: 50 }).action, 'drop');
  assert.equal(resolve({ stance: 'reject', confidence: 0.9, will: 50 }).reason.includes('作废'), true);
});

await check('判据 4：Will=80 且 user 说无关的 → 不硬拉（暂停）；低/中档跟一两楼再拉回', () => {
  assert.equal(resolve({ stance: 'irrelevant', confidence: 0.9, will: 80 }).action, 'follow');
  assert.equal(resolve({ stance: 'irrelevant', confidence: 0.9, will: 20 }).action, 'hold');
  assert.equal(resolve({ stance: 'irrelevant', confidence: 0.9, will: 50 }).action, 'hold');
});

await check('判据 5：confidence < 0.7 → 按 accept 处理（推进，不卡住）', () => {
  for (const stance of ['reject', 'irrelevant', 'redirect', 'hesitate']) {
    const r = resolve({ stance, confidence: CONFIDENCE_FLOOR - 0.1, will: 90 });
    assert.equal(r.action, 'advance', `${stance} 置信不足应放行`);
    assert.equal(r.floored, true);
  }
  assert.equal(resolve({ stance: 'reject', confidence: undefined, will: 90 }).action, 'advance');
  assert.equal(resolve({ stance: '瞎写', confidence: 0.9, will: 90 }).action, 'advance', '不认识的 stance 也放行');
});

await check('判据 6：卡住达阈值 → 强制推进，不看 Will（防死锁）', () => {
  for (const will of [10, 50, 90]) {
    const r = resolve({ stance: 'reject', confidence: 0.9, will, stuckCount: 2, stuckThreshold: 3 });
    assert.equal(r.action, 'advance');
    assert.ok(r.reason.includes('熔断'));
  }
  // 阈值可调
  assert.equal(resolve({ stance: 'reject', confidence: 0.9, will: 90, stuckCount: 0, stuckThreshold: 1 }).action, 'advance');
});

await check('判据 9：只有 accept 才去跑推进点判定（按 stance 判断，拍板 b）', () => {
  assert.equal(shouldRunCheckpoint(resolve({ stance: 'accept', confidence: 0.9, will: 50 })), true);
  for (const stance of ['hesitate', 'reject', 'irrelevant', 'redirect']) {
    for (const will of [10, 50, 90]) {
      const decision = resolve({ stance, confidence: 0.9, will });
      assert.equal(shouldRunCheckpoint(decision), false, `${stance} @ will=${will} 应跳过推进点判定`);
    }
  }
  // 置信不足 → 已按 accept 处理 → 要跑推进点判定
  assert.equal(shouldRunCheckpoint(resolve({ stance: 'reject', confidence: 0.3, will: 90 })), true);
  // 没判到态度（没有 will 服务）→ 也要跑
  assert.equal(shouldRunCheckpoint(null), true);
});

await check('判据 10：动作名里没有 retry，reject 低档就是 rewrite', () => {
  const actions = new Set();
  for (const stance of ['accept', 'hesitate', 'reject', 'irrelevant', 'redirect']) {
    for (const will of [10, 50, 90]) {
      actions.add(resolve({ stance, confidence: 0.9, will }).action);
    }
  }
  assert.equal(actions.has('retry'), false, '代码里不该再出现 retry 这个动作名');
  assert.ok(actions.has('rewrite'));
});

console.log('强制爱（T-405 §七，原 T-419）');

await check('判据 11：强制爱关闭时行为与之前完全一致', () => {
  for (const [stance, will, expected] of TABLE_CASES) {
    const r = resolve({ stance, confidence: 0.9, will, forceAffection: false });
    assert.equal(r.action, expected, `${stance} @ will=${will} 关着就该和以前一样`);
    assert.equal(r.forced, false);
  }
});

await check('判据 12：强制爱开启时 reject 不让步、继续推进本场', () => {
  for (const will of [10, 50, 90]) {
    const r = resolve({ stance: 'reject', confidence: 0.9, will, forceAffection: true });
    assert.equal(r.action, 'hold', `will=${will} 也不让步`);
    assert.equal(r.forced, true);
    assert.ok(!['drop', 'regenAfter', 'rewrite', 'advance'].includes(r.action), '不能让步也不能跳场');
  }
});

await check('判据 13：强制爱开启且触及硬禁区 → 不被覆盖，仍按 Will 处理', () => {
  const t = (will) => resolve({ stance: 'reject', confidence: 0.9, will, forceAffection: true, violated: true });
  assert.equal(t(90).action, 'regenAfter');
  assert.equal(t(50).action, 'drop');
  assert.equal(t(10).action, 'rewrite');
  assert.equal(t(90).forced, false, '硬禁区命中时不算被强制爱覆盖');
});

await check('强制爱不越界：其它 stance 一律不受影响', () => {
  for (const [stance, will, expected] of TABLE_CASES) {
    if (stance === 'reject') continue;
    assert.equal(
      resolve({ stance, confidence: 0.9, will, forceAffection: true }).action,
      expected,
      `${stance} @ will=${will} 不该被强制爱改动`
    );
  }
});

await check('强制爱不破坏熔断：卡住达阈值仍然强制推进（防死锁）', () => {
  const r = resolve({ stance: 'reject', confidence: 0.9, will: 90, forceAffection: true, stuckCount: 2, stuckThreshold: 3 });
  assert.equal(r.action, 'advance');
  assert.ok(r.reason.includes('熔断'));
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
