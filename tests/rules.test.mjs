// T-406 测试：规则引擎（四词库 / 否定反转 / 置信度 / 转 LLM 条件）

import assert from 'node:assert/strict';
import { judgeByRules, resolveRules, CONFIDENCE_THRESHOLD } from '../src/director/rules.js';
import { createDefaultRules } from '../src/core/default-state.js';
import { createWillService } from '../src/director/will.js';
import { createStateStore } from '../src/core/state.js';

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

const judge = (text, rules) => judgeByRules(text, rules ?? createDefaultRules());
const makeStage = () => ({ id: 'st', goal: '知道 user 想不想去' });

console.log('T-406 规则引擎 · 强词（5 例）');

await check('好，走吧 → accept ≥0.9', () => {
  const r = judge('好，走吧');
  assert.equal(r.stance, 'accept');
  assert.ok(r.confidence >= 0.9, `实为 ${r.confidence}`);
});

await check('我不想去 → reject ≥0.9', () => {
  const r = judge('我不想去');
  assert.equal(r.stance, 'reject');
  assert.ok(r.confidence >= 0.9, `实为 ${r.confidence}`);
});

await check('行，就这么定了 → accept ≥0.9', () => {
  const r = judge('行，就这么定了');
  assert.equal(r.stance, 'accept');
  assert.ok(r.confidence >= 0.9, `实为 ${r.confidence}`);
});

await check('别烦我 → reject ≥0.9', () => {
  const r = judge('别烦我');
  assert.equal(r.stance, 'reject');
  assert.ok(r.confidence >= 0.9, `实为 ${r.confidence}`);
});

await check('好啊，不过我有点怕 → 转 LLM（强词 + 转折，别猜）', () => {
  const r = judge('好啊，不过我有点怕');
  assert.ok(['accept', 'hesitate'].includes(r.stance), `实为 ${r.stance}`);
  assert.ok(r.confidence < CONFIDENCE_THRESHOLD, `实为 ${r.confidence}`);
  assert.equal(r.needsLlm, true);
});

console.log('T-406 规则引擎 · 弱词（5 例，都应转 LLM）');

for (const text of ['嗯……', '再说吧', '随便', '也许可以']) {
  await check(`${text} → confidence 0.5，转 LLM`, () => {
    const r = judge(text);
    assert.equal(r.confidence, 0.5);
    assert.equal(r.needsLlm, true);
  });
}

await check('嗯好 → 强词盖弱词，accept ≥0.9', () => {
  const r = judge('嗯好');
  assert.equal(r.stance, 'accept');
  assert.ok(r.confidence >= 0.9, `实为 ${r.confidence}`);
  assert.equal(r.needsLlm, false);
});

console.log('T-406 规则引擎 · 否定反转（5 例）');

await check('我不是不想去 → accept（双重否定 = 肯定）', () => {
  assert.equal(judge('我不是不想去').stance, 'accept');
});

await check('没有不愿意 → accept', () => {
  assert.equal(judge('没有不愿意').stance, 'accept');
});

await check('我不同意不去 → reject', () => {
  assert.equal(judge('我不同意不去').stance, 'reject');
});

await check('不能说不去 → accept', () => {
  assert.equal(judge('不能说不去').stance, 'accept');
});

await check('不，我不去 → reject（否定词管不到下一句，不能无脑反转）', () => {
  const r = judge('不，我不去');
  assert.equal(r.stance, 'reject');
  assert.equal(r.flipped, 0, '这句不该发生反转');
});

console.log('T-406 规则引擎 · 无关 / 转向（2 例）');

await check('今天天气不错 → irrelevant', () => {
  const r = judge('今天天气不错');
  assert.equal(r.stance, 'irrelevant');
  assert.equal(r.confidence, 0.85);
  assert.equal(r.needsLlm, false);
});

await check('对了，换个话题 → irrelevant / redirect', () => {
  const r = judge('对了，换个话题');
  assert.ok(['irrelevant', 'redirect'].includes(r.stance), `实为 ${r.stance}`);
  assert.equal(r.needsLlm, false);
});

console.log('T-406 验收判据');

await check('判据 1：四词库可编辑（增 / 删 / 改都持久化）', () => {
  const ext = {};
  const ctx = {
    getExtensionSettings: () => ext,
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
  };
  const store = createStateStore(ctx, 'rules_test');

  // 增
  const added = resolveRules(store.getSettings().rules);
  added.strong.push({ word: '走你', stance: 'accept' });
  store.saveSettings({ rules: added });
  assert.equal(judge('走你', store.getSettings().rules).stance, 'accept', '新增的词要生效且落盘');

  // 删
  const cleared = resolveRules(store.getSettings().rules);
  cleared.strong = [];
  store.saveSettings({ rules: cleared });
  assert.equal(judge('好', store.getSettings().rules).confidence, 0, '删空后不该再判出东西');

  // 改
  store.saveSettings({ rules: { ...cleared, strong: [{ word: '好', stance: 'reject' }] } });
  assert.equal(judge('好', store.getSettings().rules).stance, 'reject', '改过的词要按新归属走');
});

await check('判据 3：confidence < 0.7 时确实转 LLM', async () => {
  let called = 0;
  const service = createWillService({
    client: { request: async () => { called += 1; return '{"stance":"hesitate","confidence":0.8}'; } },
    getConnection: () => ({}),
  });
  const weak = await service.judge({ stage: makeStage(), userMessage: '嗯……' });
  assert.equal(called, 1, '弱词（0.5 < 0.7）必须转 LLM');
  assert.equal(weak.source, 'llm');
  assert.equal(weak.rule.confidence, 0.5, '规则结果要带回来给 Debug 看');

  const none = await service.judge({ stage: makeStage(), userMessage: '这件事你怎么看' });
  assert.equal(called, 2, '什么都没命中也要转 LLM');
  assert.equal(none.source, 'llm');
});

await check('判据 3 反面：规则够准就不调 API', async () => {
  let called = 0;
  const service = createWillService({
    client: { request: async () => { called += 1; return '{}'; } },
    getConnection: () => ({}),
  });
  const r = await service.judge({ stage: makeStage(), userMessage: '我不想去' });
  assert.equal(called, 0, '强词 0.9 ≥ 0.7，不该花 API');
  assert.equal(r.source, 'rules');
  assert.equal(r.stance, 'reject');
  assert.equal(r.confidence, 0.9);
});

await check('判据 4：词库为空时不崩（confidence 0，转 LLM）', () => {
  const empty = { strong: [], weak: [], negation: [], irrelevant: [] };
  const r = judgeByRules('好，走吧', empty);
  assert.equal(r.confidence, 0);
  assert.equal(r.stance, null);
  assert.equal(r.needsLlm, true);
  // 词库形状乱七八糟也不能崩（非数组 → 退回默认词库）
  assert.doesNotThrow(() => judgeByRules('随便说点什么', { strong: 'x', weak: 3, negation: null }));
  assert.equal(judgeByRules(undefined, undefined).confidence, 0);
  assert.equal(judgeByRules(undefined, createDefaultRules()).confidence, 0, '空消息不该命中任何词');
});

await check('判据 5：纯函数，无副作用（不改入参、可重复调用）', () => {
  const rules = createDefaultRules();
  const snapshot = JSON.stringify(rules);
  const first = judge('我不是不想去', rules);
  const second = judge('我不是不想去', rules);
  assert.equal(JSON.stringify(rules), snapshot, '入参词库不能被改动');
  assert.deepEqual(first, second, '同一输入必须得到同一结果');
});

await check('判据 6：用户自定义词优先于默认词（同名覆盖）', () => {
  const custom = createDefaultRules();
  custom.strong.push({ word: '好', stance: 'reject' }); // 覆盖默认的 accept
  assert.equal(judge('好', custom).stance, 'reject');

  // 只配一个库时，其它库退回默认值
  const partial = { strong: [{ word: '走你', stance: 'accept' }] };
  const resolved = resolveRules(partial);
  assert.deepEqual(resolved.strong, [{ word: '走你', stance: 'accept' }]);
  assert.ok(resolved.negation.length > 0, '没配的库要用默认值');
});

await check('没配词库（新建用户）自动用默认词库', () => {
  assert.equal(judge('我不想去', null).stance, 'reject');
  assert.equal(judge('我不想去', undefined).stance, 'reject');
});

console.log(`\n通过 ${passed} 项`);
