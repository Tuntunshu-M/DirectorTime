// 用户反馈 ② 测试：识别模型自己加的尾巴（思考块 / 选项菜单 / 把决定权交回 user）

import assert from 'node:assert/strict';
import { findReplyTails, describeTails, NO_TAIL_LINE } from '../src/director/tail-guard.js';
import { buildInstruction } from '../src/inject/instruction.js';

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

const kinds = (text) => findReplyTails(text).map((issue) => issue.kind);

console.log('模型尾巴识别');

check('思考块：<thinking> / <reasoning> 都认得', () => {
  assert.deepEqual(kinds('<thinking>他是不是想走？</thinking>他抬头看了你一眼。'), ['thinking']);
  assert.deepEqual(kinds('<reasoning>先安抚</reasoning>“别急。”'), ['thinking']);
  assert.deepEqual(kinds('思考：他该不该说下去\n“算了。”'), ['thinking']);
});

check('选项菜单：连着两行以上才判（单行不算）', () => {
  const menu = '他把杯子放下，等你开口。\n\nA. 直接问他昨晚去哪了\nB. 装作没看见\nC. 转身就走';
  assert.ok(kinds(menu).includes('menu'), JSON.stringify(findReplyTails(menu)));

  const single = '他只说了一句：\nA. 就这样吧';
  assert.equal(kinds(single).includes('menu'), false, '只有一行不该当成菜单');
});

check('把决定权交回 user 的收尾：几种说法都能抓', () => {
  assert.ok(kinds('……请选择接下来的剧情导向。').includes('handoff'));
  assert.ok(kinds('你想怎么走？').includes('handoff'));
  assert.ok(kinds('接下来你想怎么做？').includes('handoff'));
  assert.ok(kinds('你要怎么做？').includes('handoff'));
  assert.ok(kinds('请选择接下来的行动').includes('handoff'));
});

check('正常演出不误报', () => {
  const good = [
    '他沉默了几秒，把伞往你那边挪了挪：“别淋着。”',
    '他没等你回答，直接拉开椅子坐下，把菜单推到你面前。',
    '“昨晚的事，”他顿了顿，“我想解释。”',
    'A 市的风比昨天更冷，他把外套拉链拉到顶。',
  ];
  for (const text of good) {
    assert.deepEqual(findReplyTails(text), [], `不该误报：${text}`);
  }
});

check('一条回复里可以同时有多类尾巴，文案能读', () => {
  const text = '<thinking>该逼问吗</thinking>他放下杯子。\n请选择接下来的剧情导向：\nA. 追问\nB. 沉默';
  const issues = findReplyTails(text);
  assert.ok(issues.length >= 2);
  const description = describeTails(issues);
  assert.ok(description.includes('思考'), description);
  assert.ok(description.includes('菜单') || description.includes('问 user'), description);
});

check('空输入 / 非字符串都安全', () => {
  assert.deepEqual(findReplyTails(''), []);
  assert.deepEqual(findReplyTails(null), []);
  assert.deepEqual(findReplyTails(undefined), []);
  assert.deepEqual(findReplyTails(12345), []);
});

console.log('反制提示（随导演指令下发）');

check('角色端注入里带上了"不要思考块 / 不要选项菜单"那句', () => {
  const text = buildInstruction({
    stage: { goal: '把话挑明', beats: ['先发消息'], checkpoint: { criteria: 'c', antiCriteria: 'a' } },
  });
  assert.ok(text.includes(NO_TAIL_LINE), text);
  assert.ok(NO_TAIL_LINE.includes('thinking'));
});

check('那句不用否定句堆砌？—— 说明白它要什么（演下去）', () => {
  assert.ok(NO_TAIL_LINE.startsWith('直接演下去'));
});

console.log(`\n通过 ${passed} 项`);
