// T-424 测试：导演强度三档（只改注入语气；标准档零回归；判定不受影响）

import assert from 'node:assert/strict';
import {
  INTENSITY_LEVELS, INTENSITY_LABELS, normalizeIntensity, intensityLabel, intensityHint,
  intensityClosingLine, intensityLeadLine, intensityProactive, intensityActivityPrefix, intensityBeatsPrefix,
} from '../src/core/intensity.js';
import { buildInstruction } from '../src/inject/instruction.js';
import { decide } from '../src/director/checkpoint.js';
import { resolve } from '../src/director/will.js';

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
  title: '询问',
  goal: '知道想不想去',
  activity: '饭桌上问一句',
  beats: ['做饭', '开口'],
  checkpoint: { criteria: 'char 已经把话挑明', antiCriteria: 'user 明确不想出门' },
  notes: '',
  status: 'active',
};
const profile = { fields: { coreDesire: '想确认关系', speech: '话少', conflictStyle: '回避' } };

/** 改之前的那几句话（标准档必须逐字一致 —— 规格 §B 的默认回归保护） */
const ORIGINAL = {
  closing: '以上都是**你要主动做的事** —— 不要等 user 开口，也不要等 user 给你理由。',
  activity: '你要主动做的一件事：',
  beats: '按这个顺序主动做：',
  proactive: '不要等 user 提问或回应。如果冷场，你就自己找一件事继续。',
};

console.log('T-424 档位归一化与文案');

check('三档常量与默认值', () => {
  assert.deepEqual(INTENSITY_LEVELS, ['restrained', 'standard', 'assertive']);
  assert.equal(normalizeIntensity(undefined), 'standard', '默认必须是标准档');
  assert.equal(normalizeIntensity('乱填'), 'standard');
  assert.equal(normalizeIntensity('restrained'), 'restrained');
  assert.equal(intensityLabel('assertive'), INTENSITY_LABELS.assertive);
  assert.ok(intensityHint('restrained').includes('试着推进'));
  assert.ok(intensityHint('standard').includes('现状'));
});

console.log('T-424 标准档零回归（逐字）');

check('标准档：每个文案函数都返回改之前那一句', () => {
  assert.equal(intensityClosingLine('standard'), ORIGINAL.closing);
  assert.equal(intensityActivityPrefix('standard'), ORIGINAL.activity);
  assert.equal(intensityBeatsPrefix('standard'), ORIGINAL.beats);
  assert.equal(intensityProactive('standard', ''), ORIGINAL.proactive);
  assert.equal(intensityLeadLine('standard'), '', '标准档不该多出主导句');
});

console.log('T-424 克制档 / 强势档');

check('克制档：强祈使句都换成提议语气', () => {
  assert.ok(intensityClosingLine('restrained').includes('如果气氛合适，你可以试着推进'));
  assert.equal(intensityClosingLine('restrained').includes('不要等 user 开口'), false);
  assert.equal(intensityActivityPrefix('restrained'), '可以试着做的一件事：');
  assert.equal(intensityBeatsPrefix('restrained'), '可以按这个顺序试着做：');
  assert.ok(intensityProactive('restrained', '把杯子推过去').includes('你可以把杯子推过去'));
  assert.ok(intensityProactive('restrained', '把杯子推过去').includes('不必勉强'));
});

check('强势档：多一句主导句，其余与标准档一致', () => {
  assert.equal(intensityLeadLine('assertive'), '由你主导节奏，不必等 user 回应每一步。');
  assert.equal(intensityClosingLine('assertive'), ORIGINAL.closing);
  assert.equal(intensityActivityPrefix('assertive'), ORIGINAL.activity);
});

console.log('T-424 注入接线（instruction.js）');

check('注入文本：标准档 = 改之前的样子；克制档软化；强势档多主导句', () => {
  const standard = buildInstruction({ stage, profile, intensity: 'standard' });
  assert.ok(standard.includes('你要主动做的一件事：饭桌上问一句'), standard);
  assert.ok(standard.includes(ORIGINAL.closing), standard);

  const restrained = buildInstruction({ stage, profile, intensity: 'restrained' });
  assert.ok(restrained.includes('可以试着做的一件事：饭桌上问一句'), restrained);
  assert.equal(restrained.includes('你要主动做的一件事'), false);
  assert.equal(restrained.includes('不要等 user 开口'), false, '克制档不该出现强祈使句');

  const assertive = buildInstruction({ stage, profile, intensity: 'assertive' });
  assert.ok(assertive.includes('由你主导节奏'), assertive);
  assert.ok(assertive.includes(ORIGINAL.closing), '强势档 = 标准档 + 主导句');
});

check('不传 intensity 时按标准档（老调用点零回归）', () => {
  assert.equal(
    buildInstruction({ stage, profile }),
    buildInstruction({ stage, profile, intensity: 'standard' })
  );
});

console.log('T-424 关键边界：档位不影响判定');

check('同一输入三档的判定结果完全一致（decide / resolve）', () => {
  const judgement = { status: 'partial', confidence: 0.8 };
  const options = { threshold: 0.7, stuckCount: 1, stuckThreshold: 3, turnCount: 4, minTurns: 3, maxTurns: 8 };
  const willInput = { stance: 'accept', confidence: 0.9, will: 80, stuckCount: 0, stuckThreshold: 3 };

  const decisions = INTENSITY_LEVELS.map(() => decide(judgement, options));
  const resolves = INTENSITY_LEVELS.map(() => resolve(willInput));
  for (const item of decisions) assert.deepEqual(item, decisions[0]);
  for (const item of resolves) assert.deepEqual(item, resolves[0]);
});

console.log(`\n通过 ${passed} 项`);
