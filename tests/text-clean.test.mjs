// bugfix 0912 第二波 P1-3 测试：文本清洗（thinking 块 + 自定义正则）

import assert from 'node:assert/strict';
import {
  BUILTIN_CLEAN_RULES, cleanText, normalizeCleanRules, resolveCleanRules, isValidCleanPattern, wasCleaned,
} from '../src/llm/text-clean.js';

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

console.log('文本清洗 · 内置规则');

check('内置两条：<thinking> 与 <think>', () => {
  assert.equal(BUILTIN_CLEAN_RULES.length, 2);
  assert.equal(cleanText('<thinking>他在想什么</thinking>他抬头看你。'), '他抬头看你。');
  assert.equal(cleanText('<think>a</think>正文'), '正文');
  assert.equal(cleanText('<THINKING>大写也认</THINKING>正文'), '正文');
});

check('未闭合（被截断到结尾）也要清掉整段', () => {
  assert.equal(cleanText('正文在前。\n<thinking>模型开始思考然后就被截断', undefined), '正文在前。');
  assert.equal(cleanText('正文\n<think>截断', undefined), '正文');
});

check('原文没有 thinking 时一字不改（幂等、不误伤）', () => {
  const text = '他把伞往你那边挪了挪：“别淋着。”';
  assert.equal(cleanText(text), text);
  assert.equal(wasCleaned(text), false);
});

check('多段 thinking 一次清完，并压掉多余空行', () => {
  const text = 'A\n\n<thinking>1</thinking>\n\n<thinking>2</thinking>\n\nB';
  const out = cleanText(text);
  assert.equal(out.includes('thinking'), false);
  assert.ok(out.includes('A') && out.includes('B'));
  assert.equal(/\n{3,}/.test(out), false);
});

console.log('文本清洗 · 自定义规则');

check('自定义正则：加了就能用', () => {
  const config = { enabled: true, rules: ['<status>[\\s\\S]*?</status>'] };
  assert.equal(cleanText('正文<status>hp:1</status>尾部', config), '正文尾部');
  assert.equal(cleanText('<thinking>x</thinking>正文<status>y</status>', config), '正文');
});

check('自定义规则归一化：去空、去重、最多 20 条', () => {
  const rules = normalizeCleanRules(['  a  ', 'a', '', null, 'b']);
  assert.deepEqual(rules.map((rule) => rule.pattern), ['a', 'b']);
  assert.equal(normalizeCleanRules(new Array(30).fill('x')).length, 1, '重复的会合并');
  assert.equal(normalizeCleanRules('不是数组').length, 0);
});

check('开关关掉 → 一条规则都不用（判定会看到原文）', () => {
  assert.equal(cleanText('<thinking>x</thinking>正文', { enabled: false, rules: ['<status>x</status>'] }), '<thinking>x</thinking>正文');
  assert.deepEqual(resolveCleanRules({ enabled: false }), []);
});

check('正则写错：跳过这条，不影响其它规则、也不炸', () => {
  const config = { enabled: true, rules: ['点这( 没有右括号', '<status>[\\s\\S]*?</status>'] };
  const out = cleanText('<thinking>x</thinking>正文<status>y</status>', config);
  assert.equal(out, '正文', '错的那条被跳过，内置与正确的那条照常生效');
  assert.equal(isValidCleanPattern('点这( 没有右括号'), false);
  assert.equal(isValidCleanPattern('<status>.*</status>'), true);
});

check('空输入安全', () => {
  assert.equal(cleanText(''), '');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(undefined), '');
});

console.log(`\n通过 ${passed} 项`);
