// T-403 测试：模型特化预设（Gemini 角色塑造红线）—— 默认关、双端注入

import assert from 'node:assert/strict';
import {
  GEMINI_REDLINE, normalizeModelPreset, modelPresetText,
} from '../src/core/model-preset.js';
import { buildInstruction, redlineLine } from '../src/inject/instruction.js';

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

const stage = {
  title: '第一场',
  goal: '把话挑明',
  activity: '主动发消息',
  beats: ['先发消息'],
  checkpoint: { criteria: 'c', antiCriteria: 'a' },
};

console.log('T-403 模型特化预设 · 开关语义');

check('默认关闭：一个字都不注入', () => {
  assert.equal(normalizeModelPreset(undefined).enabled, false);
  assert.equal(modelPresetText(undefined), '');
  assert.equal(modelPresetText({ enabled: false, custom: '随便写的' }), '', '关着就是关着');
  assert.equal(redlineLine(''), '');
});

check('开启且没改过 → 用内置 Gemini 红线', () => {
  const text = modelPresetText({ enabled: true, custom: '  ' });
  assert.equal(text, GEMINI_REDLINE);
  assert.ok(text.includes('控制欲'), '要点名禁极端模板');
  assert.ok(text.includes('心理与合理动机'), '占有欲要有动机');
  for (const n of ['1.', '2.', '3.', '4.', '5.', '6.']) assert.ok(text.includes(n), `缺第 ${n} 条自检`);
});

check('开启且改过 → 用用户那份（用户显式优先）', () => {
  assert.equal(modelPresetText({ enabled: true, custom: '我自己的红线' }), '我自己的红线');
});

check('归一化容错：脏数据不炸', () => {
  assert.deepEqual(normalizeModelPreset({ enabled: 1, custom: 123 }), { enabled: true, custom: '123' });
  assert.deepEqual(normalizeModelPreset(null), { enabled: false, custom: '' });
});

console.log('T-403 双端注入 · 角色回复端');

check('角色端：红线进注入，且排在硬禁区之后、导演指令之前', () => {
  const text = buildInstruction({ stage, redline: GEMINI_REDLINE, hardLimits: ['自杀'] });
  const atLimit = text.indexOf('自杀');
  const atRedline = text.indexOf('[扮演红线');
  const atDirector = text.indexOf('[导演指令]');
  assert.ok(atLimit >= 0 && atRedline > atLimit, '硬禁区在红线之前（用户显式第一）');
  assert.ok(atDirector > atRedline, '红线在导演指令之前');
  assert.ok(text.includes(GEMINI_REDLINE));
});

check('只有红线时也要注入（别被"没有阶段就跳过"的逻辑吃掉）', () => {
  const text = buildInstruction({ redline: GEMINI_REDLINE });
  assert.ok(text.includes('[扮演红线'));
  assert.equal(buildInstruction({}), '', '什么都没有才是空');
});

console.log(`\n通过 ${passed} 项`);
