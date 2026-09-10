// T-207 测试：Debug 窗口的状态计算（纯函数部分）
// DOM 渲染不自动测（无 jsdom），由人工在酒馆里核对。

import assert from 'node:assert/strict';
import { buildDebugState } from '../src/ui/debug.js';
import { createStateStore } from '../src/core/state.js';
import { createStageService } from '../src/director/stage.js';
import { normalizeStages } from '../src/director/outline.js';

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

function makeEnv() {
  const meta = {};
  const settingsStore = {};
  const ctx = {
    getChatState: () => meta,
    saveChatState: () => true,
    getExtensionSettings: () => settingsStore,
    saveSettings: () => true,
  };
  return { store: createStateStore(ctx, 'dt'), meta };
}

console.log('T-207 Debug 状态计算');

check('空状态时各字段安全返回', () => {
  const env = makeEnv();
  const s = buildDebugState({ store: env.store });
  assert.equal(s.stage.index, 0);
  assert.equal(s.stage.total, 0);
  assert.equal(s.stage.status, 'none');
  assert.equal(s.injection.registered, false);
  assert.equal(s.lastJudgement, null);
});

check('正确反映当前阶段与序号', () => {
  const env = makeEnv();
  const stages = createStageService({ store: env.store });
  stages.load(normalizeStages([
    { title: '询问', goal: '知道想不想去', checkpoint: { criteria: 'c', antiCriteria: 'a' } },
    { title: '订票', goal: '订好机票', checkpoint: { criteria: 'c', antiCriteria: 'a' } },
  ]));
  const s = buildDebugState({ store: env.store });
  assert.equal(s.stage.index, 1);
  assert.equal(s.stage.total, 2);
  assert.equal(s.stage.title, '询问');
  assert.equal(s.stage.status, 'active');
});

check('推进后序号跟着变', () => {
  const env = makeEnv();
  const stages = createStageService({ store: env.store });
  stages.load(normalizeStages([
    { title: '询问', goal: '知道想不想去', checkpoint: { criteria: 'c', antiCriteria: 'a' } },
    { title: '订票', goal: '订好机票', checkpoint: { criteria: 'c', antiCriteria: 'a' } },
  ]));
  stages.advance();
  const s = buildDebugState({ store: env.store });
  assert.equal(s.stage.index, 2);
  assert.equal(s.stage.title, '订票');
});

check('反映卡住计数', () => {
  const env = makeEnv();
  const stages = createStageService({ store: env.store });
  stages.load(normalizeStages([{ title: 'a', goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'a' } }]));
  const id = env.store.get().stages[0].id;
  stages.bumpStuck(id);
  stages.bumpStuck(id);
  assert.equal(buildDebugState({ store: env.store }).stage.stuckCount, 2);
});

check('反映注入注册状态', () => {
  const env = makeEnv();
  const registry = { getStatus: () => ({ registered: true, length: 42, text: '指令内容' }) };
  const s = buildDebugState({ store: env.store, registry });
  assert.equal(s.injection.registered, true);
  assert.equal(s.injection.length, 42);
  assert.equal(s.injection.text, '指令内容');
});

check('保留上次判定与模型原始返回', () => {
  const env = makeEnv();
  const last = {
    action: 'advance',
    reason: '达成',
    judgement: { status: 'achieved', confidence: 0.9 },
    raw: '{"status":"achieved"}',
  };
  const s = buildDebugState({ store: env.store, last });
  assert.equal(s.lastAction, 'advance');
  assert.equal(s.lastJudgement.status, 'achieved');
  assert.equal(s.lastRaw, '{"status":"achieved"}');
});

check('反映累计调用次数', () => {
  const env = makeEnv();
  env.store.update((d) => ({ ...d, cost: { sessionTotal: 0.02, callCount: 7 } }));
  assert.equal(buildDebugState({ store: env.store }).cost.callCount, 7);
});

console.log(`\n通过 ${passed} 项`);
