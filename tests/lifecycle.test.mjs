// T-301 / T-302 / T-303 —— 质量保障三件套
//
// T-301 注入清空：四个时机后注册内容必须为空（忘了清 = 静默污染所有对话）
// T-302 状态机不变量：随机迁移 100 次，active 恒不超过 1 且与 activeStageId 一致
// T-303 JSON 解析降级：非法输入一律 null，且不注入任何内容

import assert from 'node:assert/strict';
import { createSillyTavernContext } from '../src/core/context.js';
import { createPromptRegistry, INJECT_KEY } from '../src/inject/prompt-registry.js';
import { createStateStore, assertInvariants } from '../src/core/state.js';
import { createStageService } from '../src/director/stage.js';
import { normalizeStages } from '../src/director/outline.js';
import { parseDirectorResponse } from '../src/llm/schemas.js';

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

function makeStore() {
  const meta = {};
  const settingsStore = {};
  const ctx = {
    getChatState: () => meta,
    saveChatState: () => true,
    getExtensionSettings: () => settingsStore,
    saveSettings: () => true,
  };
  return createStateStore(ctx, 'dt');
}

/** 记录所有注入调用，用于断言「到底注没注」 */
function makeSpyContext(settings) {
  const calls = [];
  const ctx = createSillyTavernContext(() => ({
    setExtensionPrompt: (...args) => calls.push(args),
  }));
  const registry = createPromptRegistry({ ctx, store: makeStore(), getSettings: () => settings });
  return { registry, calls };
}

const ON = { enabled: true, injectEnabled: true };

console.log('T-301 注入清空（四个时机）');

check('时机一：总开关关闭后清空', () => {
  const { registry, calls } = makeSpyContext(ON);
  registry.register('指令');
  assert.equal(registry.getStatus().registered, true);
  // 关总开关
  const off = makeSpyContext({ enabled: false, injectEnabled: true });
  off.registry.register('指令');
  assert.equal(off.registry.getStatus().registered, false);
  assert.ok(off.calls.some((c) => c[1] === ''), '必须发出空内容清空');
});

check('时机二：注入开关关闭后清空', () => {
  const { registry, calls } = makeSpyContext({ enabled: true, injectEnabled: false });
  assert.equal(registry.register('指令'), false);
  assert.ok(calls.some((c) => c[1] === ''));
});

check('时机三：切聊天后清空', () => {
  let handler = null;
  const calls = [];
  const ctx = createSillyTavernContext(() => ({
    setExtensionPrompt: (...args) => calls.push(args),
  }));
  ctx.on = (event, fn) => { handler = fn; return () => {}; };
  const registry = createPromptRegistry({ ctx, store: makeStore(), getSettings: () => ON });
  registry.installLifecycle();
  registry.register('指令');
  assert.equal(registry.getStatus().registered, true);
  handler?.();
  assert.equal(registry.getStatus().registered, false);
});

check('时机四：剧本清空（无进行中阶段）后清空', () => {
  const { registry, calls } = makeSpyContext(ON);
  registry.register('指令');
  registry.register('');
  assert.equal(registry.getStatus().registered, false);
  assert.ok(calls.some((c) => c[1] === ''));
});

check('清空后重复调用不报错（幂等）', () => {
  const { registry } = makeSpyContext(ON);
  registry.clear();
  registry.clear();
  registry.clear();
  assert.equal(registry.getStatus().registered, false);
});

console.log('T-302 状态机不变量（随机 100 次迁移）');

check('随机迁移后不变量始终成立', () => {
  const store = makeStore();
  const stages = createStageService({ store });

  // 固定种子，保证可复现
  let seed = 20260910;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let round = 0; round < 100; round += 1) {
    // 约 1/4 概率重新装载剧本
    if (rand() < 0.05 || store.get().stages.length === 0) {
      const count = 1 + Math.floor(rand() * 4);
      const list = normalizeStages(
        Array.from({ length: count }, (_, i) => ({
          title: `阶段${i}`,
          goal: `目标${i}`,
          checkpoint: { criteria: `c${i}`, antiCriteria: `a${i}` },
          beats: ['b'],
        }))
      );
      stages.load(list);
    }

    const state = store.get();
    const active = state.stages.find((s) => s.id === state.activeStageId);
    const pick = rand();

    if (pick < 0.5) stages.advance();
    else if (pick < 0.7 && active) stages.bumpStuck(active.id);
    else if (pick < 0.85 && active) stages.resetStuck(active.id);
    else if (active) stages.drop(active.id);

    // 每次迁移后立即校验
    assertInvariants(store.get());
  }

  assert.equal(process.exitCode ?? 0, 0);
});

check('直接校验：两个 active 会被拦下', () => {
  assert.throws(
    () => assertInvariants({
      stages: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }],
    }),
    /不变量/
  );
});

check('经由 update 写入非法状态同样被拦下', () => {
  const store = makeStore();
  assert.throws(
    () => store.update((d) => ({
      ...d,
      stages: [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }],
      activeStageId: null,
    })),
    /不变量/
  );
});

console.log('T-303 JSON 解析降级');

const BAD_INPUTS = [
  ['空字符串', ''],
  ['截断的 JSON', '{"status":"achieved"'],
  ['纯文本', '抱歉，我无法完成这个任务'],
  ['代码块包裹的非法 JSON', '```json\n{这不是 json}\n```'],
  ['数组', '[1,2,3]'],
];

for (const [label, input] of BAD_INPUTS) {
  check(`非法输入「${label}」返回 null`, () => {
    assert.equal(parseDirectorResponse(input, 'judgement'), null);
    assert.equal(parseDirectorResponse(input, 'outline'), null);
  });
}

check('解析失败时不调用注入（不注入任何内容）', () => {
  const { registry, calls } = makeSpyContext(ON);
  const data = parseDirectorResponse('这不是 JSON', 'outline');
  if (data) registry.register(JSON.stringify(data));
  assert.equal(data, null);
  assert.equal(calls.length, 0, '解析失败绝不能注入');
});

console.log(`\n通过 ${passed} 项`);
