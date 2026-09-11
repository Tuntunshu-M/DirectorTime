// T-206 测试：复盘编排 + 注入文本拼装

import assert from 'node:assert/strict';
import { createReviewService } from '../src/director/review.js';
import { createStageService } from '../src/director/stage.js';
import { normalizeStages } from '../src/director/outline.js';
import { createStateStore } from '../src/core/state.js';
import { buildInstruction, buildDirectorLayer } from '../src/inject/instruction.js';

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

function makeEnv() {
  const meta = {};
  const settingsStore = {};
  const ctx = {
    getChatState: () => meta,
    saveChatState: () => true,
    getExtensionSettings: () => settingsStore,
    saveSettings: () => true,
  };
  const store = createStateStore(ctx, 'dt');
  const stages = createStageService({ store });
  const registered = [];
  let current = null;
  const registry = {
    register: (text) => { current = text || null; registered.push(text); return true; },
    clear: () => { current = null; registered.push(''); return true; },
    getStatus: () => ({ registered: current !== null, length: current?.length ?? 0, text: current ?? '' }),
  };
  return { store, stages, registry, registered };
}

function seed(env) {
  const list = normalizeStages([
    { title: '询问', goal: '知道想不想去', activity: '饭桌上问', checkpoint: { criteria: 'user 同意出行', antiCriteria: 'user 明确不想出门' }, beats: ['做饭', '开口'] },
    { title: '订票', goal: '订好机票', activity: '买机票', checkpoint: { criteria: 'user 确认日期', antiCriteria: 'user 反悔' }, beats: ['查航班'] },
  ]);
  env.stages.load(list);
  return list;
}

console.log('T-206 复盘编排');

await check('regenerate 不触发复盘', async () => {
  const env = makeEnv();
  seed(env);
  let judged = false;
  const service = createReviewService({
    checkpoint: { judge: async () => { judged = true; return { action: 'advance' }; } },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  const r = await service.run({ type: 'regenerate' });
  assert.equal(r.skipped, true);
  assert.equal(judged, false);
});

await check('swipe 不触发复盘', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  assert.equal((await service.run({ type: 'swipe' })).skipped, true);
});

await check('判定 advance 时推进阶段', async () => {
  const env = makeEnv();
  const list = seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance', reason: '达成' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  const r = await service.run({ userMessage: '好啊', charMessage: '那我们走吧' });
  assert.equal(r.action, 'advance');
  assert.equal(env.store.get().activeStageId, list[1].id);
  assert.equal(env.store.get().stages[0].status, 'done');
});

await check('判定 retry 时累加卡住计数', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'retry', reason: '未达成' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '嗯' });
  assert.equal(env.store.get().stages[0].stuckCount, 1);
});

await check('判定 hold（调用失败）不计入卡住', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold', reason: '超时' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: 'x' });
  assert.equal(env.store.get().stages[0].stuckCount, 0);
});

await check('判定 rewrite 时重置卡住计数', async () => {
  const env = makeEnv();
  seed(env);
  const id = env.store.get().stages[0].id;
  env.stages.bumpStuck(id);
  env.stages.bumpStuck(id);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'rewrite', reason: '部分达成' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '也许吧' });
  assert.equal(env.store.get().stages[0].stuckCount, 0);
});

await check('判定 rewrite 时换一组走位（T-205④）', async () => {
  const env = makeEnv();
  seed(env);
  const before = env.store.get().stages[0].beats.join('|');
  let asked = null;
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'rewrite', reason: '部分达成' }) },
    beats: { rewrite: async (input) => { asked = input; return { ok: true, beats: ['新走位一', '新走位二'] }; } },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '也许吧', charMessage: '再想想' });

  const after = env.store.get().stages[0].beats.join('|');
  assert.notEqual(after, before);
  assert.equal(after, '新走位一|新走位二');
  assert.equal(asked.stage.goal, '知道想不想去');
  assert.equal(asked.reason, '部分达成');
  // 下一轮注入要换成新走位
  assert.ok(env.registered[env.registered.length - 1].includes('新走位一'));
});

await check('走位重写失败时保持原走位，仍注入当前阶段（G5）', async () => {
  const env = makeEnv();
  seed(env);
  const before = env.store.get().stages[0].beats.join('|');
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'rewrite', reason: '部分达成' }) },
    beats: { rewrite: async () => ({ ok: false, error: '解析失败' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '也许吧' });
  assert.equal(env.store.get().stages[0].beats.join('|'), before);
  assert.ok(env.registered[env.registered.length - 1].includes('做饭 → 开口'));
});

await check('推进后调用 topUp 补足待演阶段（T-209）', async () => {
  const env = makeEnv();
  seed(env);
  let topped = 0;
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance', reason: '达成' }) },
    topUp: async () => { topped += 1; },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '好' });
  assert.equal(topped, 1);
});

await check('retry / hold 不触发续写', async () => {
  const env = makeEnv();
  seed(env);
  let topped = 0;
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'retry', reason: '未达成' }) },
    topUp: async () => { topped += 1; },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '嗯' });
  assert.equal(topped, 0);
});

console.log('楼层节奏（T-416）');

await check('每轮结束本场 turnCount +1', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'retry', reason: '未达成' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '嗯' });
  await service.run({ userMessage: '嗯嗯' });
  assert.equal(env.store.get().stages[0].turnCount, 2);
});

await check('settle → 状态变 ready、不切场、注入换成收尾版', async () => {
  const env = makeEnv();
  const list = seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'settle', reason: '已达成，先收尾' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '好' });

  const stage = env.store.get().stages[0];
  assert.equal(stage.status, 'ready');
  assert.equal(env.store.get().activeStageId, list[0].id, '不切场');
  assert.ok(env.registered[env.registered.length - 1].includes('本场已达成'));
});

await check('force 也走推进，并把 reason 报给 onEvent', async () => {
  const env = makeEnv();
  const list = seed(env);
  let payload = null;
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'force', reason: '到点强制推进' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
    onEvent: (_name, data) => { payload = data; },
  });
  await service.run({ userMessage: '嗯' });
  assert.equal(env.store.get().activeStageId, list[1].id);
  assert.equal(payload.action, 'force');
  assert.equal(payload.reason, '到点强制推进');
});

console.log('用户意愿矩阵（T-405）');

await check('让步类动作跳过推进点判定（判据 1：Will=90 + 反对 → 作废并重生成）', async () => {
  const env = makeEnv();
  const list = seed(env);
  let judged = false;
  let topped = 0;
  const service = createReviewService({
    checkpoint: { judge: async () => { judged = true; return { action: 'advance' }; } },
    will: { judge: async () => ({ ok: true, stance: 'reject', confidence: 0.95 }) },
    topUp: async () => {
      topped += 1;
      const fresh = normalizeStages(
        [{ goal: '换个方向', checkpoint: { criteria: 'c', antiCriteria: 'a' } }],
        { startIndex: list.length + 1, activateFirst: false }
      );
      env.stages.append(fresh);
      return { ok: true, stages: fresh };
    },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ will: 90, stuckThreshold: 3 }),
  });

  const r = await service.run({ userMessage: '我不想去 D 市' });
  assert.equal(judged, false, '让步类动作不该再跑推进点判定');
  assert.equal(r.action, 'regenAfter');
  assert.equal(env.store.get().stages[0].status, 'dropped', '当前场要作废');
  assert.equal(topped, 1, '要重生成后续');
  assert.ok(r.injected.includes('换个方向'), '新场要接上');
});

await check('hold：停留，状态不动，继续注入本阶段指令', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance' }) },
    will: { judge: async () => ({ ok: true, stance: 'hesitate', confidence: 0.9 }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ will: 50, stuckThreshold: 3 }),
  });

  const r = await service.run({ userMessage: '再想想吧' });
  assert.equal(r.action, 'hold');
  assert.equal(env.store.get().stages[0].status, 'active');
  assert.ok(r.injected.includes('知道想不想去'), '继续注入本场指令');
});

await check('follow：剧情暂停，注入被清空（判据 3 高档）', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance' }) },
    will: { judge: async () => ({ ok: true, stance: 'irrelevant', confidence: 0.9 }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ will: 90, stuckThreshold: 3 }),
  });

  const r = await service.run({ userMessage: '今天天气不错' });
  assert.equal(r.action, 'follow');
  assert.equal(r.injected, '');
  assert.equal(env.registered[env.registered.length - 1], '', '注入要被清空');
});

await check('态度判定置信不足 → 仍走推进点判定（判据 4）', async () => {
  const env = makeEnv();
  seed(env);
  let judged = false;
  const service = createReviewService({
    checkpoint: { judge: async () => { judged = true; return { action: 'advance', reason: '达成' }; } },
    will: { judge: async () => ({ ok: true, stance: 'reject', confidence: 0.3 }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ will: 90, stuckThreshold: 3 }),
  });

  const r = await service.run({ userMessage: '嗯' });
  assert.equal(judged, true);
  assert.equal(r.action, 'advance');
});

await check('regenAfter 重生成失败 → 只作废、不注入、不崩（判据 6）', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance' }) },
    will: { judge: async () => ({ ok: true, stance: 'redirect', confidence: 0.95 }) },
    topUp: async () => null,
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ will: 90, stuckThreshold: 3 }),
  });

  const r = await service.run({ userMessage: '我们换个方向' });
  assert.equal(r.action, 'regenAfter');
  assert.equal(env.store.get().stages[0].status, 'dropped');
  assert.equal(env.store.get().activeStageId, null);
  assert.equal(r.injected, '', '重生成失败就不注入任何内容');
});

await check('没有 will 服务时退化为原来的推进点路径（向后兼容）', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance', reason: '达成' }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({ will: 90 }),
  });
  const r = await service.run({ userMessage: '好啊' });
  assert.equal(r.action, 'advance');
  assert.equal(service.getLastTurn().stance, null);
});

await check('复盘后更新注入内容（供下一轮使用）', async () => {
  const env = makeEnv();
  seed(env);
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance', reason: '达成' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  const r = await service.run({ userMessage: '好' });
  assert.ok(r.injected.length > 0);
  assert.ok(env.registered.length > 0);
  // 推进后应注入新阶段的内容
  assert.ok(env.registered[env.registered.length - 1].includes('订好机票'));
});

await check('没有进行中的阶段时注入被清空', () => {
  const env = makeEnv();
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  const text = service.syncInjection();
  assert.equal(text, '');
  assert.equal(env.registered[env.registered.length - 1], '');
});

await check('并发复盘被拦截（防重入）', async () => {
  const env = makeEnv();
  seed(env);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createReviewService({
    checkpoint: { judge: async () => { await gate; return { action: 'hold' }; } },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  const first = service.run({ userMessage: 'a' });
  const second = await service.run({ userMessage: 'b' });
  assert.equal(second.skipped, true);
  release();
  await first;
});

await check('记录本轮回放：本轮生效的指令 vs 下轮将用的指令', async () => {
  const env = makeEnv();
  seed(env);
  // 模拟上一轮复盘留下的注册内容——这才是本轮生成时真正生效的
  env.registry.register('上一轮留下的指令');
  const service = createReviewService({
    checkpoint: { judge: async () => ({ action: 'advance', reason: '达成' }) },
    stages: env.stages, registry: env.registry, store: env.store, getSettings: () => ({}),
  });
  await service.run({ userMessage: '好啊', charMessage: '那我们走吧' });

  const turn = service.getLastTurn();
  assert.equal(turn.userMessage, '好啊');
  assert.equal(turn.charMessage, '那我们走吧');
  assert.equal(turn.usedInjection, '上一轮留下的指令', '本轮生效的应是复盘前的内容');
  assert.ok(turn.nextInjection.includes('订好机票'), '下轮应换成新阶段的指令');
  assert.equal(turn.action, 'advance');
});

console.log('注入文本拼装');

await check('包含本场目标与推进点正反条件', () => {
  const text = buildInstruction({
    stage: { goal: '知道想不想去', beats: ['做饭', '开口'], checkpoint: { criteria: 'user 同意出行', antiCriteria: 'user 明确不想出门' } },
  });
  assert.ok(text.includes('知道想不想去'));
  assert.ok(text.includes('user 同意出行'));
  assert.ok(text.includes('user 明确不想出门'));
  assert.ok(text.includes('做饭 → 开口'));
});

await check('有侧写时追加角色动机层（形态③）', () => {
  const text = buildInstruction({
    stage: { goal: 'g', beats: ['b'], checkpoint: { criteria: 'c', antiCriteria: 'a' } },
    profile: { desire: '被需要', conflictStyle: '先退一步' },
  });
  assert.ok(text.includes('[导演指令]'));
  assert.ok(text.includes('[角色此刻的动机]'));
  assert.ok(text.includes('被需要'));
});

await check('无内容时返回空字符串', () => {
  assert.equal(buildInstruction({}), '');
  assert.equal(buildInstruction({ stage: {} }), '');
});

await check('指令三种状态输出不同文本（T-416c）', () => {
  const normal = buildDirectorLayer({ stage: { status: 'active', goal: 'g', turnCount: 0 }, pacing: { min: 3, max: 8 } });
  assert.ok(normal.includes('不要等 user 提问'), '正常场次给主动性提示');

  const ready = buildDirectorLayer({ stage: { status: 'ready', goal: 'g' }, pacing: { min: 3, max: 8 } });
  assert.ok(ready.includes('本场已达成'), '收尾场次给收尾指令');
  assert.ok(!ready.includes('不要等 user 提问'));

  const nearMax = buildDirectorLayer({ stage: { status: 'active', goal: 'g', turnCount: 7 }, pacing: { min: 3, max: 8 } });
  assert.ok(nearMax.includes('这一场够久了'), '接近上限给推进指令');
  assert.ok(!nearMax.includes('不要等 user 提问'));

  const withObjective = buildDirectorLayer({ stage: { status: 'active', goal: 'g' }, outline: { objective: '成为最强' }, pacing: { min: 3, max: 8 } });
  assert.ok(withObjective.includes('主线目标：成为最强'));
});

console.log(`\n通过 ${passed} 项`);
