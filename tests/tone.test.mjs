// T-415 测试：剧情占比（三线联动配平，和恒为 100）

import assert from 'node:assert/strict';
import { TONE_KEYS, normalizeTone, rebalanceTone, toneText, DEFAULT_TONE,
  DEFAULT_TONE_HINTS, TONE_HINT_MAX, normalizeToneHints, toneHintsOf } from '../src/core/tone.js';
import { createDefaultTone, createDefaultState } from '../src/core/default-state.js';

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

const sum = (tone) => TONE_KEYS.reduce((acc, key) => acc + tone[key], 0);

console.log('T-415 剧情占比 · 归一化');

await check('默认 70/30/0；空输入回落到默认', () => {
  assert.deepEqual(createDefaultTone(), DEFAULT_TONE);
  assert.deepEqual(normalizeTone(null), DEFAULT_TONE);
  assert.deepEqual(normalizeTone({}), DEFAULT_TONE);
  assert.deepEqual(normalizeTone('不是对象'), DEFAULT_TONE);
  assert.deepEqual(createDefaultState().tone, DEFAULT_TONE);
});

await check('和不是 100 的老数据 → 按比例缩放成 100', () => {
  const fixed = normalizeTone({ daily: 50, crisis: 50, intimate: 50 });
  assert.equal(sum(fixed), 100);
  assert.ok(Math.abs(fixed.daily - fixed.crisis) <= 1, '原来是等比的，缩放后还要等比');
  assert.equal(sum(normalizeTone({ daily: 200, crisis: 0, intimate: 0 })), 100);
});

await check('越界值夹到 0~100', () => {
  const fixed = normalizeTone({ daily: 150, crisis: -20, intimate: 10 });
  assert.equal(sum(fixed), 100);
  assert.ok(fixed.daily <= 100 && fixed.crisis >= 0);
});

console.log('T-415 剧情占比 · 联动配平（验收判据）');

await check('拖一条，另两条自动配平，总和仍是 100', () => {
  const next = rebalanceTone({ daily: 70, crisis: 20, intimate: 10 }, 'daily', 90);
  assert.equal(next.daily, 90);
  assert.equal(sum(next), 100);
  assert.equal(next.crisis + next.intimate, 10, '剩下的份额归另两条');
  assert.ok(next.crisis > next.intimate, '按原比例（20:10）分，危机应该更多');
});

await check('拖到 100 → 另两条归 0；拖到 0 → 另两条平分剩下的 100', () => {
  const full = rebalanceTone({ daily: 70, crisis: 30, intimate: 0 }, 'daily', 100);
  assert.deepEqual(full, { daily: 100, crisis: 0, intimate: 0 });

  const zero = rebalanceTone({ daily: 100, crisis: 0, intimate: 0 }, 'daily', 0);
  assert.equal(zero.daily, 0);
  assert.equal(sum(zero), 100);
  assert.equal(zero.crisis + zero.intimate, 100, '另两条要能起来，不能永远归零');
});

await check('另两条原本都是 0 时，按平分处理', () => {
  const next = rebalanceTone({ daily: 100, crisis: 0, intimate: 0 }, 'daily', 40);
  assert.equal(sum(next), 100);
  assert.ok(Math.abs(next.crisis - next.intimate) <= 1, '没有比例可依 → 平分');
});

await check('越界拖动会被夹住，绝不溢出', () => {
  assert.equal(rebalanceTone({ daily: 70, crisis: 30, intimate: 0 }, 'daily', 999).daily, 100);
  assert.equal(rebalanceTone({ daily: 70, crisis: 30, intimate: 0 }, 'daily', -50).daily, 0);
  assert.equal(rebalanceTone({ daily: 70, crisis: 30, intimate: 0 }, 'daily', Number.NaN).daily, 70);
});

await check('不认识的那条 → 原样返回（不破坏数据）', () => {
  const tone = { daily: 70, crisis: 30, intimate: 0 };
  assert.deepEqual(rebalanceTone(tone, '乱写', 50), tone);
});

await check('不变式：随便怎么拖，和恒为 100、每项都在 0~100', () => {
  const starts = [
    { daily: 70, crisis: 30, intimate: 0 },
    { daily: 34, crisis: 33, intimate: 33 },
    { daily: 0, crisis: 0, intimate: 100 },
    { daily: 100, crisis: 0, intimate: 0 },
  ];
  for (const start of starts) {
    for (const key of TONE_KEYS) {
      for (let value = 0; value <= 100; value += 7) {
        const next = rebalanceTone(start, key, value);
        assert.equal(sum(next), 100, `${JSON.stringify(start)} 拖 ${key}=${value} 后和应为 100`);
        for (const item of TONE_KEYS) {
          assert.ok(next[item] >= 0 && next[item] <= 100, `${item}=${next[item]} 越界了`);
        }
        assert.equal(next[key], value, '被拖的那条要精确等于给的值');
      }
    }
  }
});

await check('多次拖动后仍然稳定（连拖不会累积误差）', () => {
  let tone = { daily: 70, crisis: 30, intimate: 0 };
  tone = rebalanceTone(tone, 'intimate', 33);
  tone = rebalanceTone(tone, 'crisis', 50);
  tone = rebalanceTone(tone, 'daily', 60);
  assert.equal(sum(tone), 100);
  assert.equal(tone.daily, 60);
});

console.log('T-415 剧情占比 · 喂给导演');

await check('toneText 只列开着的线，并带上该线释义（T-415 补充）', () => {
  const text = toneText({ daily: 70, crisis: 30, intimate: 0 });
  assert.ok(text.startsWith('日常 70%（'), text);
  assert.ok(text.includes(' / 危机 30%（'), text);
  assert.equal(text.includes('亲密'), false, '0% 的线不列');

  const onlyIntimate = toneText({ daily: 0, crisis: 0, intimate: 100 });
  assert.ok(onlyIntimate.startsWith('亲密 100%（'), onlyIntimate);

  assert.ok(toneText({ daily: 34, crisis: 33, intimate: 33 }).includes('日常 34%'));
});

await check('释义可改：用户改过的覆盖内置，缺的回落内置（T-415 补充）', () => {
  assert.ok(toneText({ daily: 70, crisis: 30, intimate: 0 }, { hints: { daily: '我自己的日常' } })
    .includes('日常 70%（我自己的日常）'));
  assert.ok(toneText({ daily: 70, crisis: 30, intimate: 0 }, { hints: { daily: '我自己的日常' } })
    .includes('危机 30%（需要两人共同面对的压力或冲突，不为虐而虐）'), '没改的走内置');
});

console.log('锁住某条线（用户反馈 3：锁了只配平其余两条）');

await check('锁住一条：改另一条时，锁住的那条一动不动', () => {
  const before = { daily: 70, crisis: 30, intimate: 0 };
  const next = rebalanceTone(before, 'daily', 50, { locked: ['crisis'] });
  assert.equal(next.crisis, 30, '锁住的危机不能动');
  assert.equal(next.daily, 50);
  assert.equal(next.intimate, 20, '剩下的全给没锁的那条');
  assert.equal(next.daily + next.crisis + next.intimate, 100);
});

await check('锁住两条：改第三条也不会破坏"和恒为 100"', () => {
  const before = { daily: 60, crisis: 40, intimate: 0 };
  const next = rebalanceTone(before, 'intimate', 10, { locked: ['daily', 'crisis'] });
  assert.equal(next.daily + next.crisis + next.intimate, 100, '和必须还是 100');
  assert.equal(next.daily, 60, '锁住的一动不动');
  assert.equal(next.crisis, 40, '锁住的一动不动');
  assert.equal(next.intimate, 0, '锁住的 60+40 已经占满，没空间留给第三条');
});

await check('三条全锁 → 谁都不动（总和本来就是 100）', () => {
  const before = { daily: 50, crisis: 30, intimate: 20 };
  const next = rebalanceTone(before, 'daily', 40, { locked: ['daily', 'crisis', 'intimate'] });
  assert.deepEqual(next, before);
  assert.equal(next.daily + next.crisis + next.intimate, 100);
});

await check('把自己也锁了 → 改它也不动', () => {
  const before = { daily: 50, crisis: 30, intimate: 20 };
  assert.deepEqual(rebalanceTone(before, 'daily', 10, { locked: ['daily'] }), before);
});

await check('锁住的那条占太多时：被改的这条会被夹住，不让总和溢出', () => {
  const next = rebalanceTone({ daily: 80, crisis: 20, intimate: 0 }, 'daily', 100, { locked: ['crisis'] });
  assert.equal(next.crisis, 20);
  assert.equal(next.daily, 80, '100 里只能给 daily 留 80');
  assert.equal(next.daily + next.crisis + next.intimate, 100);
});

await check('不传 locked 时行为与以前完全一致（按原比例分剩下的）', () => {
  assert.deepEqual(
    rebalanceTone({ daily: 70, crisis: 30, intimate: 0 }, 'daily', 50),
    { daily: 50, crisis: 50, intimate: 0 }
  );
});

console.log(`\n通过 ${passed} 项`);
