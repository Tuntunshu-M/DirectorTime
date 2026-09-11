// T-408 测试：伏笔（记录 / 重生成不丢 / 回收销账）

import assert from 'node:assert/strict';
import {
  normalizeForeshadows, openForeshadows, carryOver, resolveRecalled, foreshadowText,
} from '../src/director/foreshadow.js';
import { createCheckpointService } from '../src/director/checkpoint.js';
import { createReviewService } from '../src/director/review.js';
import { createStateStore } from '../src/core/state.js';
import { createStageService } from '../src/director/stage.js';
import { normalizeStages } from '../src/director/outline.js';
import { buildDebugState } from '../src/ui/debug.js';

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

const outlineOf = (foreshadows) => ({ title: 'T', objective: 'O', foreshadows });

console.log('T-408 伏笔 · 记录与清单');

await check('归一化：模型给的字符串数组 → 带 id / 状态的记录', () => {
  const list = normalizeForeshadows(['抽屉里的旧照片', '', null, '一张没寄出的信'], { now: 1000 });
  assert.equal(list.length, 2, '空条目要丢掉');
  assert.equal(list[0].text, '抽屉里的旧照片');
  assert.equal(list[0].status, 'open');
  assert.equal(list[0].plantedAt, 1000);
  assert.ok(list[0].id && list[1].id && list[0].id !== list[1].id, '每条要有独立 id');
});

await check('已经是记录的（重生成时带过来的）保留原 id 与埋设时间', () => {
  const [item] = normalizeForeshadows([{ id: 'fs_keep', text: '旧钥匙', status: 'resolved', plantedAt: 7, resolvedAt: 9 }]);
  assert.equal(item.id, 'fs_keep');
  assert.equal(item.status, 'resolved');
  assert.equal(item.plantedAt, 7);
  assert.equal(item.resolvedAt, 9);
});

await check('openForeshadows 只留没回收的', () => {
  const outline = outlineOf([
    { id: 'fs_1', text: 'A', status: 'open' },
    { id: 'fs_2', text: 'B', status: 'resolved' },
  ]);
  assert.deepEqual(openForeshadows(outline).map((item) => item.id), ['fs_1']);
  assert.deepEqual(openForeshadows(null), []);
});

await check('foreshadowText 带编号，空的时候给占位', () => {
  const text = foreshadowText(outlineOf([{ id: 'fs_1', text: '旧照片', status: 'open' }]));
  assert.ok(text.includes('[fs_1]'), '要带 id，判定才能报回来销账');
  assert.ok(text.includes('旧照片'));
  assert.equal(foreshadowText(outlineOf([])), '（暂无）');
});

console.log('T-408 伏笔 · 验收判据');

await check('验收 1：重生成剧本后，未回收的伏笔不丢失', () => {
  const previous = outlineOf([
    { id: 'fs_old_open', text: '抽屉里的旧照片', status: 'open', plantedAt: 1 },
    { id: 'fs_old_done', text: '已经用过的雨伞', status: 'resolved', plantedAt: 1, resolvedAt: 2 },
  ]);
  const fresh = { title: 'T2', objective: 'O2', foreshadows: normalizeForeshadows(['新的信'], { now: 5 }) };

  const merged = carryOver(previous, fresh);
  const texts = merged.foreshadows.map((item) => item.text);
  assert.deepEqual(texts, ['新的信', '抽屉里的旧照片'], '新伏笔在前，未回收的旧伏笔必须留着');
  assert.equal(texts.includes('已经用过的雨伞'), false, '已回收的不再带过来');
  assert.equal(merged.foreshadows[1].id, 'fs_old_open', 'id 与埋设时间都要保持原样');
  assert.equal(merged.foreshadows[1].plantedAt, 1);
  assert.equal(merged.title, 'T2', '新剧本的其它字段不受影响');
});

await check('重生成时不重复：新剧本自己又埋了同一条，只留一条', () => {
  const previous = outlineOf([{ id: 'fs_1', text: '旧照片', status: 'open' }]);
  const merged = carryOver(previous, { foreshadows: normalizeForeshadows(['旧照片']) });
  assert.equal(merged.foreshadows.length, 1);
});

await check('回收：报回来的编号销账，并从待回收列表移除', () => {
  const outline = outlineOf([
    { id: 'fs_1', text: 'A', status: 'open' },
    { id: 'fs_2', text: 'B', status: 'open' },
  ]);
  const { outline: next, resolved } = resolveRecalled(outline, ['fs_1', '瞎编的编号'], { now: 42 });
  assert.equal(resolved.length, 1, '认不出来的编号要忽略');
  assert.equal(resolved[0].id, 'fs_1');
  assert.equal(next.foreshadows.find((item) => item.id === 'fs_1').resolvedAt, 42);
  assert.deepEqual(openForeshadows(next).map((item) => item.id), ['fs_2'], '回收的要从待回收里消失');
});

await check('回收：没报编号时什么都不动', () => {
  const outline = outlineOf([{ id: 'fs_1', text: 'A', status: 'open' }]);
  const { outline: next, resolved } = resolveRecalled(outline, []);
  assert.equal(resolved.length, 0);
  assert.equal(next, outline, '不该产生新对象');
});

console.log('T-408 伏笔 · 接线');

function makeEnv() {
  const ctx = {
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
  };
  const store = createStateStore(ctx, 'foreshadow_test');
  const stages = normalizeStages([{ goal: '目标', checkpoint: { criteria: 'c', antiCriteria: 'a' } }]);
  store.update((draft) => ({
    ...draft,
    outline: outlineOf([{ id: 'fs_1', text: '抽屉里的旧照片', status: 'open' }]),
    stages,
    activeStageId: stages[0].id,
  }), { track: false });
  const registered = [];
  const registry = {
    register: (text) => { registered.push(text ?? ''); return true; },
    clear: () => true,
    getStatus: () => ({ registered: true, length: 1, text: registered[registered.length - 1] ?? '' }),
  };
  return { store, stages: createStageService({ store }), registry, registered };
}

await check('判定时把待回收伏笔一起发过去（不额外花调用）', async () => {
  const env = makeEnv();
  let sent = '';
  const checkpoint = createCheckpointService({
    client: {
      request: async ({ messages }) => {
        sent = messages[1].content;
        return '{"status":"pending","confidence":0.9,"reason":"r"}';
      },
    },
    getConnection: () => ({}),
    getSettings: () => ({}),
    getOutline: () => env.store.get().outline,
    stages: env.stages,
  });
  await checkpoint.judge({ userMessage: '嗯', charMessage: '好' });
  assert.ok(sent.includes('待回收伏笔'), '判定要带上伏笔清单');
  assert.ok(sent.includes('[fs_1]'), '要带编号，模型才能报回来');
  assert.ok(sent.includes('抽屉里的旧照片'));
});

await check('判定报回编号 → 自动销账（review 接线）', async () => {
  const env = makeEnv();
  const review = createReviewService({
    checkpoint: {
      judge: async () => ({
        action: 'hold', reason: 'r', judgement: { status: 'pending', confidence: 0.9, recalled: ['fs_1'] },
      }),
    },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({}),
  });

  await review.run({ userMessage: '我把抽屉里的照片拿出来了', charMessage: '……' });
  const foreshadows = env.store.get().outline.foreshadows;
  assert.equal(foreshadows[0].status, 'resolved', '要标成已回收');
  assert.ok(foreshadows[0].resolvedAt > 0);
  assert.equal(openForeshadows(env.store.get().outline).length, 0, '待回收列表要清空');
  assert.equal(review.getLastTurn().recalled.length, 1, '回放里要能看到');
});

await check('判定没报编号 → 伏笔原样留着', async () => {
  const env = makeEnv();
  const review = createReviewService({
    checkpoint: { judge: async () => ({ action: 'hold', reason: 'r', judgement: { status: 'pending', confidence: 0.9 } }) },
    stages: env.stages, registry: env.registry, store: env.store,
    getSettings: () => ({}),
  });
  await review.run({ userMessage: '嗯', charMessage: '好' });
  assert.equal(openForeshadows(env.store.get().outline).length, 1);
  assert.deepEqual(review.getLastTurn().recalled, []);
});

await check('Debug 显示待回收伏笔', () => {
  const env = makeEnv();
  const state = buildDebugState({ store: env.store, registry: env.registry });
  assert.deepEqual(state.foreshadows, ['抽屉里的旧照片']);
});

console.log(`\n通过 ${passed} 项`);
