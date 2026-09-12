// P0 修正测试：剧本只能指挥 char（prompt 约束 + 注入语气 + 本地兜底检查）

import assert from 'node:assert/strict';
import { buildMessages, PROMPTS } from '../src/llm/prompts.js';
import { buildInstruction, buildDirectorLayer } from '../src/inject/instruction.js';
import { findUserDirectives, findFinishedLines, describeIssues } from '../src/director/actor-guard.js';

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
  assert.ok(outline.includes('char 的意图一'), 'beats 样例要示范 char 的意图（不是成品台词）');
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

console.log('P0 · §九 criteria 必须 char 单方面能完成');

await check('prompt 写明：要 user 配合才能达成的 criteria 一律不合格', () => {
  const outline = buildMessages('GEN_OUTLINE', {}).find((m) => m.role === 'system').content;
  assert.ok(outline.includes('单方面就能完成'), '要写清判定标准');
  assert.ok(outline.includes('需要 user 配合才能达成的一律不合格'), '要点名不合格的情况');
  assert.ok(outline.includes('user 不配合'), '要说明理由（否则剧情卡死）');

  const extend = buildMessages('EXTEND_OUTLINE', {}).find((m) => m.role === 'system').content;
  assert.ok(extend.includes('单方面就能完成'));
  assert.ok(extend.includes('要 user 配合'));
});

console.log('P0 · §七 写意图不给成品 + 复述防护');

await check('prompt 写明：写意图，不要把台词写死', () => {
  for (const name of ['GEN_OUTLINE', 'EXTEND_OUTLINE']) {
    const system = buildMessages(name, {}).find((m) => m.role === 'system').content;
    assert.ok(system.includes('写**意图**，不要写成**成品**'), `${name} 要讲清写意图`);
    assert.ok(system.includes('随便你怎么想'), `${name} 要给"错"的样例`);
    assert.ok(system.includes('冷冷地回一句'), `${name} 要给"对"的样例`);
  }
});

await check('判据 7：注入开头标注"不是台词"', () => {
  const text = buildInstruction({ stage: STAGE });
  assert.ok(text.startsWith('以下是导演给你的指示，不是台词'), '必须放在最开头');
  assert.ok(text.includes('不要把它写进对话里'));
});

await check('判据 6（本地可查部分）：台词写死的字段能被抓出来', () => {
  const bad = [
    { activity: '他打出了"随便你怎么想"这句话' },
    { beats: ['他冷冷地说：随便你怎么想'] },
    { beats: ['char 说「我们分手吧」'] },
    { goal: 'char 原样说出“我不在乎”' },
  ];
  for (const stage of bad) {
    const issues = findFinishedLines([{ ...stage, checkpoint: {} }]);
    assert.equal(issues.length, 1, `应该抓出来：${JSON.stringify(stage)}`);
  }
  const good = [
    { activity: '他不想多解释，冷冷地回一句' },
    { beats: ['char 发消息', 'char 追问'] },
    { goal: 'char 主动挑明昨晚的事' },
  ];
  for (const stage of good) {
    assert.deepEqual(findFinishedLines([{ ...stage, checkpoint: {} }]), [], `不该误报：${JSON.stringify(stage)}`);
  }
});

await check('§七b：复述那句否定指令换成肯定说法', () => {
  const text = buildInstruction({ stage: STAGE });
  assert.equal(text.includes('不要直接复述'), false, '否定指令要去掉');
  assert.ok(text.includes('用你自己的话和方式，把上面的意图演出来'), '改成肯定说法');
});

console.log('§七 三条 prompt 修正');

await check('a：GEN_OUTLINE 与 EXTEND_OUTLINE 都带【演员界定】', () => {
  for (const key of ['GEN_OUTLINE', 'EXTEND_OUTLINE']) {
    assert.ok(PROMPTS[key].system.includes('【演员界定'), `${key} 缺演员界定`);
    assert.ok(PROMPTS[key].system.includes('严禁出现这些写法'), `${key} 缺"禁止给人写戏"的清单`);
  }
});

await check('b：注入指令开头声明"不是台词"，并用肯定式说法', () => {
  const layer = buildDirectorLayer({
    stage: { goal: '知道想不想去', activity: '主动问一句', beats: ['先发消息'], checkpoint: { criteria: 'c', antiCriteria: 'a' } },
  });
  assert.ok(layer.startsWith('以下是导演给你的指示，不是台词'), layer.slice(0, 40));
  assert.ok(layer.includes('用你自己的话和方式，把上面的意图演出来'), layer);
  assert.equal(layer.includes('不要复述'), false, '§七b：否定式说法已改成肯定式');
});

await check('c：criteria 的例子不许把 user 当主语', () => {
  const system = PROMPTS.GEN_OUTLINE.system;
  assert.equal(system.includes('"user 同意这次出行"'), false, 'criteria 的正例不能是 user 做主语');
  assert.ok(system.includes('char 单方面就能做到'), system.slice(0, 200));
  assert.ok(system.includes('user 不配合这场就永远过不去'));
});

await check('c：判定口径与 criteria 一致（看 char 做到没有）', () => {
  assert.ok(PROMPTS.JUDGE_CHECKPOINT.system.includes('char 做到了就算达成'));
  assert.ok(PROMPTS.JUDGE_CHECKPOINT.system.includes('不是 user 有没有配合'));
});

console.log('§七c · 本地兜底：criteria 要 user 配合 = 剧情会卡死');

await check('"user 与 char 面对面" 被抓出来，并归到 criteria 依赖 user', () => {
  const issues = findUserDirectives([
    { goal: 'g', checkpoint: { criteria: 'user 与 char 面对面', antiCriteria: 'a' } },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, 'checkpoint.criteria');
  assert.equal(issues[0].kind, 'criteria-depends-on-user');
  assert.ok(describeIssues(issues).includes('要 user 配合'));
  assert.ok(describeIssues(issues).includes('剧情会卡死'));
});

await check('"让 user 与 char 见面" 也算依赖 user', () => {
  const issues = findUserDirectives([{ checkpoint: { criteria: '让 user 与 char 见面' } }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'criteria-depends-on-user');
});

await check('同一条 criteria 只报一次（依赖 user 优先报）', () => {
  const issues = findUserDirectives([{ checkpoint: { criteria: 'user 会答应 char 的请求' } }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'criteria-depends-on-user');
});

await check('合格写法不误报（user 只在从句里，主语是 char）', () => {
  const good = [
    'char 已把出行的事挑明，让这件事再也搁置不下去',
    'char 已把话挑明，user 无法回避',
    'char 已经把选择摆到台面上',
  ];
  for (const criteria of good) {
    const issues = findUserDirectives([{ goal: 'g', checkpoint: { criteria, antiCriteria: 'a' } }]);
    assert.equal(issues.length, 0, `不该误报：${criteria}`);
  }
});

console.log(`\n通过 ${passed} 项`);
