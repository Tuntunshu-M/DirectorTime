// T-403 测试：模型特化预设（Claude 推主动 / Gemini 收敛极端）—— 默认关、二选一、双端注入

import assert from 'node:assert/strict';
import {
  CLAUDE_ACTIVE, GEMINI_REDLINE, BUILTIN_PRESETS, PRESET_KINDS,
  normalizeModelPreset, modelPresetKind, modelPresetText,
} from '../src/core/model-preset.js';
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

const stage = {
  title: '第一场',
  goal: '把话挑明',
  activity: '主动发消息',
  beats: ['先发消息'],
  checkpoint: { criteria: 'c', antiCriteria: 'a' },
};

console.log('T-403 模型特化预设 · 开关与套别');

check('默认关闭：一个字都不注入', () => {
  assert.equal(modelPresetKind(undefined), 'off');
  assert.equal(modelPresetText(undefined), '');
  assert.equal(modelPresetText({ kind: 'off', custom: { claude: '写了也不算' } }), '');
});

check('三选一：off / claude / gemini，认不出的值一律回落 off', () => {
  assert.deepEqual(PRESET_KINDS, ['off', 'claude', 'gemini']);
  assert.equal(modelPresetKind({ kind: 'claude' }), 'claude');
  assert.equal(modelPresetKind({ kind: 'gpt5' }), 'off');
});

check('两套内置文本方向相反：一个推主动、一个收敛极端', () => {
  assert.equal(modelPresetText({ kind: 'claude' }), CLAUDE_ACTIVE);
  assert.equal(modelPresetText({ kind: 'gemini' }), GEMINI_REDLINE);
  assert.notEqual(CLAUDE_ACTIVE, GEMINI_REDLINE, '方向相反，文本必须不同');
  assert.ok(CLAUDE_ACTIVE.includes('禁止被动句式与被动等待'), 'Claude 那套是推主动');
  assert.ok(GEMINI_REDLINE.includes('控制欲'), 'Gemini 那套是拉回边界');
});

check('两套都自带 8 条生成前自检', () => {
  for (const [name, text] of Object.entries(BUILTIN_PRESETS)) {
    for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.']) {
      assert.ok(text.includes(n), `${name} 缺第 ${n} 条自检`);
    }
    assert.ok(text.includes('自检'), `${name} 要写明是生成前自检`);
  }
});

check('Claude 那套要压住"回避型人格结论"（2026-09-14 反馈 #3）', () => {
  assert.ok(CLAUDE_ACTIVE.includes('禁止回避型人格结论'), '要有总的禁止项');
  assert.ok(CLAUDE_ACTIVE.includes('情感上绝不主动'), '要点名具体是哪类结论');
  assert.ok(CLAUDE_ACTIVE.includes('卡面写明的主动优先'), '卡面主动的角色不能被写成木头');
  assert.ok(CLAUDE_ACTIVE.includes('往前挪一格'), '关系要递进，不许原地打转');
});

check('自定义各存各的：改 Claude 不会串到 Gemini', () => {
  const raw = { kind: 'claude', custom: { claude: '我的主动版', gemini: '' } };
  assert.equal(modelPresetText(raw), '我的主动版');
  assert.equal(modelPresetText({ ...raw, kind: 'gemini' }), GEMINI_REDLINE, '切到 Gemini 用它的内置，不串台');
  assert.equal(modelPresetText({ kind: 'claude', custom: { claude: '  ', gemini: '' } }), CLAUDE_ACTIVE, '空文本算没改');
});

check('兼容 v0.4.0 老格式 { enabled, custom }（老存档不丢）', () => {
  const migrated = normalizeModelPreset({ enabled: true, custom: '老的红线' });
  assert.equal(migrated.kind, 'gemini');
  assert.equal(migrated.custom.gemini, '老的红线');
  assert.equal(modelPresetText({ enabled: true, custom: '老的红线' }), '老的红线');
  assert.equal(normalizeModelPreset({ enabled: false, custom: 'x' }).kind, 'off');
});

check('归一化容错：脏数据不炸', () => {
  assert.deepEqual(normalizeModelPreset(null), { kind: 'off', custom: { claude: '', gemini: '' } });
  assert.deepEqual(normalizeModelPreset({ kind: 'claude', custom: 123 }), { kind: 'claude', custom: { claude: '', gemini: '' } });
});

console.log('T-403 注入位置（澄清：这套守则只给导演 API）');

check('角色回复端**不该**出现红线 —— 它是给剧情生成的', () => {
  const text = buildInstruction({ stage, hardLimits: ['自杀'] });
  assert.equal(text.includes('扮演红线'), false, '角色回复端不许出现红线');
  assert.equal(text.includes(GEMINI_REDLINE), false);
  assert.equal(text.includes(CLAUDE_ACTIVE), false);
});

check('硬禁区仍然双端（T-410 才是双端注入那条）', () => {
  const text = buildInstruction({ stage, hardLimits: ['自杀'] });
  assert.ok(text.includes('自杀'), '硬禁区要进角色回复端');
});

check('没有阶段就没有角色端指令（红线不该单独撑起一条注入）', () => {
  assert.equal(buildInstruction({}), '');
});

console.log(`\n通过 ${passed} 项`);
