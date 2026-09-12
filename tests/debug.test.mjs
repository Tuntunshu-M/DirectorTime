// T-207 测试：Debug 窗口的状态计算（纯函数部分）
// DOM 渲染不自动测（无 jsdom），由人工在酒馆里核对。

import assert from 'node:assert/strict';
import { buildDebugState, breakFilterLine } from '../src/ui/debug.js';
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

console.log('T-422 Debug 破限行：一眼看出到底注入了没有');

/** 选中的酒馆预设（默认这份是能读到内容的） */
const presetOf = (patch = {}) => ({
  name: '小克预设', available: 3, entries: 0, length: 1200, active: true, ...patch,
});

check('off + 选了预设 → 「未启用，未注入」，且整行不许出现"已注入"三个字', () => {
  const line = breakFilterLine({ mode: 'off', preset: presetOf(), customLength: 0, injected: 0 });
  assert.ok(line.includes('预设：小克预设（未启用，未注入）'), line);
  assert.equal(line.includes('已注入'), false, 'off 时说"已注入"就是骗人 —— 这就是这次必修的那个坑');
});

check('preset 模式 + 真的注入了 → 「已注入 N 字」', () => {
  const line = breakFilterLine({ mode: 'preset', preset: presetOf(), customLength: 0, injected: 1200 });
  assert.ok(line.includes('预设：小克预设（已注入 1200 字）'), line);
  assert.ok(line.includes('本轮实际注入 1200 字'), line);
});

check('选了预设但读不到内容 → 写清未注入（不是"生效"）', () => {
  const line = breakFilterLine({ mode: 'preset', preset: presetOf({ active: false, length: 0 }), injected: 0 });
  assert.ok(line.includes('读不到内容，未注入'), line);
  assert.equal(line.includes('已注入'), false, line);
});

check('preset 模式但没选预设 → 未注入', () => {
  const line = breakFilterLine({ mode: 'preset', preset: presetOf({ name: '', length: 0, active: false }), injected: 0 });
  assert.ok(line.includes('未选预设（未注入）'), line);
});

check('custom 模式：自定义已注入、预设明确未启用', () => {
  const line = breakFilterLine({ mode: 'custom', preset: presetOf(), customLength: 50, injected: 50 });
  assert.ok(line.includes('预设：小克预设（未启用，未注入）'), line);
  assert.ok(line.includes('自定义：已注入 50 字'), line);
});

check('custom 模式但自定义为空 → 未注入', () => {
  const line = breakFilterLine({ mode: 'custom', customLength: 0, injected: 0 });
  assert.ok(line.includes('自定义：空（未注入）'), line);
});

check('append 模式：预设与自定义都注入', () => {
  const line = breakFilterLine({ mode: 'append', preset: presetOf(), customLength: 30, injected: 1230 });
  assert.ok(line.includes('预设：小克预设（已注入 1200 字）'), line);
  assert.ok(line.includes('自定义：已注入 30 字'), line);
  assert.ok(line.includes('本轮实际注入 1230 字'), line);
});

check('没有状态 → 破折号，不崩', () => {
  assert.equal(breakFilterLine(null), '—');
  assert.equal(breakFilterLine(undefined), '—');
});

check('档位一行（T-414）：排查时能直接确认是不是档位设错了', () => {
  const env = makeEnv();
  const fresh = buildDebugState({ store: env.store }).automation;
  assert.ok(fresh.includes('大纲 L1'), fresh);
  assert.ok(fresh.includes('一致性自检 L2'), fresh);

  env.store.update((d) => ({ ...d, automation: { ...d.automation, outline: 'L0' } }));
  assert.ok(buildDebugState({ store: env.store }).automation.includes('大纲 L0'), '改档位要立刻反映');
});

console.log(`\n通过 ${passed} 项`);
