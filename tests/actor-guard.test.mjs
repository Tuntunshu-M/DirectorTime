// P0 修正测试：剧本只能指挥 char（prompt 约束 + 注入语气 + 本地兜底检查）

import assert from 'node:assert/strict';
import { buildMessages } from '../src/llm/prompts.js';
import { buildInstruction, buildDirectorLayer } from '../src/inject/instruction.js';
import { findUserDirectives, describeIssues } from '../src/director/actor-guard.js';

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

console.log('P0 · prompt 里的演员界定');

for (const name of ['GEN_OUTLINE', 'EXTEND_OUTLINE']) {
  await check(`${name} 开头写明"只能指挥 char"`, () => {
    const system = buildMessages(name, {}).find((m) => m.role === 'system').content;
    assert.ok(system.includes('【演员界定'), '必须有演员界定块');
    assert.ok(system.includes('只能指挥 char'), '要直说只能写 char 的戏');
    assert.ok(system.includes('user = 真人'), '要说明 user 是真人、无权预设');
    assert.ok(system.includes('严禁出现这些写法'), '要列出禁写样例');
    assert.ok(system.includes('让 char 主动做一件事'), '要给出正确思路');
    assert.ok(system.startsWith('【演员界定'), '放在最前面，别让模型看完别的才看到它');
  });
}

await check('字段说明里带上"主语必须是 char"（含 antiCriteria 那个例外）', () => {
  for (const name of ['GEN_OUTLINE', 'EXTEND_OUTLINE']) {
    const system = buildMessages(name, {}).find((m) => m.role === 'system').content;
    assert.ok(system.includes('主语') && system.includes('char'), '要讲清每个字段的主语');
    assert.ok(system.includes('antiCriteria'), '要交代例外');
    assert.ok(system.includes('判定条件'), '例外是"判定条件"，不是"让 user 这样做"');
  }
});

await check('字段样例全部改成 char 的动作（不再有"角色主要活动"这种歧义写法）', () => {
  const outline = buildMessages('GEN_OUTLINE', {}).find((m) => m.role === 'system').content;
  const extend = buildMessages('EXTEND_OUTLINE', {}).find((m) => m.role === 'system').content;
  assert.equal(outline.includes('角色主要活动'), false, 'GEN_OUTLINE 不该再有"角色"这种两义词');
  assert.equal(extend.includes('角色主要活动'), false);
  assert.ok(outline.includes('char 的主要活动'));
  assert.ok(outline.includes('char 的动作一'), 'beats 样例要示范 char 的动作');
  assert.ok(outline.includes('char 主动挑明昨晚的事'), 'goal 要给出正确样例');
});

console.log('P0 · 本地兜底检查');

await check('实测那几段错写法都能被抓出来（判据 1）', () => {
  const bad = [
    '让用户在极度羞耻中确认对话框的错误',
    '用户在房间内焦虑走动，反复查看聊天记录',
    'user盯着屏幕上那几行露骨的文字，脸色从惨白变到通红',
    'user决定采取行动（如清空记录或发送解释）',
    'user会慢慢接受这件事',
    'user陷入沉默',
    'user开始怀疑自己',
    '让 user 感到被背叛',
  ];
  for (const text of bad) {
    const issues = findUserDirectives([{ goal: text, checkpoint: {} }]);
    assert.equal(issues.length, 1, `「${text}」应该被抓出来`);
    assert.equal(issues[0].field, 'goal');
  }
});

await check('正确写法（主语是 char / 判定条件描述 user 反应）不该误报', () => {
  const good = [
    { goal: 'char 主动挑明昨晚的事，不让 user 回避' },
    { activity: 'char 发来新消息，假装无事地提起' },
    { beats: ['char 发消息', 'char 追问', 'char 逼问到底'] },
    { checkpoint: { criteria: 'char 已把话题挑明，user 无法回避' } },
    { checkpoint: { antiCriteria: 'user 明确表示不想谈' } },
  ];
  for (const stage of good) {
    assert.deepEqual(findUserDirectives([{ ...stage, checkpoint: stage.checkpoint ?? {} }]), [], `不该误报：${JSON.stringify(stage)}`);
  }
});

await check('antiCriteria 例外只拦"让 user 这样做"', () => {
  assert.deepEqual(findUserDirectives([{ checkpoint: { antiCriteria: 'user 明确表示不想谈' } }]), []);
  const forced = findUserDirectives([{ checkpoint: { antiCriteria: '让 user 拒绝这个提议' } }]);
  assert.equal(forced.length, 1, 'antiCriteria 里"让 user…"仍然不许');
  assert.equal(forced[0].field, 'checkpoint.antiCriteria');
});

await check('beats 逐条查，能指出是第几条', () => {
  const issues = findUserDirectives([{ beats: ['char 开口', 'user 开始沉默'] }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, 'beats[1]');
  assert.ok(describeIssues(issues).includes('阶段1.beats[1]'));
});

await check('"不让 user 回避"这类禁止预设的写法不算违规（规格自己的正确样例）', () => {
  const good = [
    { goal: 'char 主动挑明昨晚的事，不让 user 回避' },
    { activity: 'char 换话题，不要让 user 尴尬' },
    { checkpoint: { criteria: '不让 user 装作没听见' } },
  ];
  for (const stage of good) {
    assert.deepEqual(findUserDirectives([{ ...stage, checkpoint: stage.checkpoint ?? {} }]), [], `误报：${JSON.stringify(stage)}`);
  }
});

await check('空阶段 / 脏数据不炸', () => {
  assert.deepEqual(findUserDirectives([]), []);
  assert.deepEqual(findUserDirectives(null), []);
  assert.deepEqual(findUserDirectives([null, {}, { goal: '   ' }]), []);
});

console.log('P0 · 注入语气改成祈使句');

const STAGE = {
  goal: '知道想不想去',
  activity: '开口问 user 要不要出行',
  beats: ['做饭', '开口'],
  checkpoint: { criteria: 'user 同意出行', antiCriteria: 'user 明确不想出门' },
};

await check('判据 4：注入是第二人称祈使句，不是资料罗列', () => {
  const text = buildInstruction({ stage: STAGE });
  assert.ok(text.includes('[本场戏 · 你现在要做什么]'), '要有"你现在要做什么"的标题');
  assert.ok(text.includes('你要主动做的一件事：开口问 user'), '用第二人称下达动作');
  assert.ok(text.includes('按这个顺序主动做：做饭 → 开口'));
  assert.ok(text.includes('演到「user 同意出行」，这场就过了。'));
  assert.ok(text.includes('如果出现「user 明确不想出门」，本场就结束。'));
  assert.ok(text.includes('不要等 user 开口'), '要明确禁止"等 user"');
  assert.equal(text.includes('建议走位：'), false, '陈述罗列要消失');
  assert.equal(text.includes('本场完成标志：'), false);
  assert.equal(text.includes('角色主要活动：'), false);
});

await check('收尾场 / 快到点的场保留既有话术（不回归）', () => {
  const ready = buildDirectorLayer({ stage: { status: 'ready', goal: 'g' }, pacing: { min: 3, max: 8 } });
  assert.ok(ready.includes('本场已达成'));
  assert.equal(ready.includes('不要等 user 提问'), false);

  const near = buildDirectorLayer({
    stage: { status: 'active', goal: 'g', turnCount: 9, pacing: { min: 3, max: 8 } },
    pacing: { min: 3, max: 8 },
  });
  assert.ok(near.includes('这一场够久了'));
});

await check('没内容的阶段依旧返回空串（不凭空注入）', () => {
  assert.equal(buildInstruction({}), '');
  assert.equal(buildInstruction({ stage: {} }), '');
});

console.log(`\n通过 ${passed} 项`);
