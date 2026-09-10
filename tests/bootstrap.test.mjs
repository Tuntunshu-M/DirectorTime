// 装配层测试：只测可纯函数验证的部分（轮次消息抽取）

import assert from 'node:assert/strict';
import { lastTurnMessages } from '../src/bootstrap.js';

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

console.log('装配层 · 轮次消息抽取');

check('空 chat 返回空字符串', () => {
  assert.deepEqual(lastTurnMessages([]), { userMessage: '', charMessage: '' });
});

check('标准一轮：末尾 char，倒数第二 user', () => {
  const messages = [
    { is_user: true, mes: '今天好无聊' },
    { is_user: false, mes: '那我们去旅行吧' },
  ];
  const r = lastTurnMessages(messages);
  assert.equal(r.userMessage, '今天好无聊');
  assert.equal(r.charMessage, '那我们去旅行吧');
});

check('末尾是 user 时 char 为空（用户连发）', () => {
  const messages = [
    { is_user: false, mes: '旧的回复' },
    { is_user: true, mes: '我又说了一句' },
  ];
  const r = lastTurnMessages(messages);
  assert.equal(r.userMessage, '我又说了一句');
  assert.equal(r.charMessage, '');
});

check('只有一条 user 消息', () => {
  const r = lastTurnMessages([{ is_user: true, mes: '开场白' }]);
  assert.equal(r.userMessage, '开场白');
  assert.equal(r.charMessage, '');
});

check('mes 缺失时不崩', () => {
  const r = lastTurnMessages([{ is_user: true }, { is_user: false }]);
  assert.equal(r.userMessage, '');
  assert.equal(r.charMessage, '');
});

console.log(`\n通过 ${passed} 项`);
