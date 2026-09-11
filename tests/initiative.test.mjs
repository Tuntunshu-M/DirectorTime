// T-417 测试：char 主动性（由侧写推导 + 侧写换代后失效重生成 + 每轮都带主动性指令）

import assert from 'node:assert/strict';
import {
  hasProfile, profileStamp, normalizeInitiative, needsInitiative,
  usableInitiative, stampInitiative, createInitiativeService, INITIATIVE_MAX_LENGTH,
} from '../src/director/initiative.js';
import { buildInstruction, proactiveLine } from '../src/inject/instruction.js';

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

const profileOf = (desire, updatedAt = 1) => ({ fields: { coreDesire: desire }, updatedAt });
const stageOf = (extra = {}) => ({
  id: 'st_1', title: '阶段 1', goal: '知道 user 想不想去',
  activity: '问 user 要不要去', beats: ['做完饭', '在饭桌上问'], ...extra,
});

console.log('T-417 主动性 · 纯函数');

await check('没有侧写就不生成 initiative（禁止凭空造人设）', () => {
  assert.equal(hasProfile(null), false);
  assert.equal(hasProfile({ fields: { coreDesire: '   ' } }), false);
  assert.equal(profileStamp(null), '');
  assert.equal(needsInitiative(stageOf(), null), false, '没侧写 → 不生成');
  assert.equal(needsInitiative(stageOf(), { fields: {} }), false);
  assert.equal(usableInitiative(stageOf({ initiative: '主动做饭' }), null), '', '没侧写就不注入');
});

await check('initiative 为空 → 需要生成', () => {
  assert.equal(needsInitiative(stageOf(), profileOf('看海', 7)), true);
});

await check('侧写换代（updatedAt 变）→ 旧 initiative 失效、需重新生成', () => {
  const stage = stageOf({ initiative: '主动约 user 去看海', initiativeFrom: '7' });
  assert.equal(needsInitiative(stage, profileOf('看海', 7)), false, '同一版侧写 → 不用重生成');
  assert.equal(needsInitiative(stage, profileOf('复仇', 8)), true, '侧写更新了 → 失效');
  assert.equal(usableInitiative(stage, profileOf('复仇', 8)), '', '失效的不能注入');
  assert.equal(usableInitiative(stage, profileOf('看海', 7)), '主动约 user 去看海');
});

await check('清洗：压成单行、去首尾、限长', () => {
  assert.equal(normalizeInitiative('  主动\n  做饭  '), '主动 做饭');
  assert.equal(normalizeInitiative(123), '');
  assert.equal(normalizeInitiative('啊'.repeat(200)).length, INITIATIVE_MAX_LENGTH);
});

await check('盖章：写下 initiativeFrom = 侧写版本戳', () => {
  const stamped = stampInitiative(
    [stageOf({ initiative: '主动约 user 去看海' }), stageOf({ initiative: '' })],
    profileOf('看海', 42)
  );
  assert.equal(stamped[0].initiativeFrom, '42');
  assert.equal(stamped[0].initiative, '主动约 user 去看海');
  assert.equal(stamped[1].initiativeFrom, '42', '空 initiative 也要盖章，便于事后判断');
  assert.equal(stampInitiative([stageOf()], null)[0].initiativeFrom, '', '没侧写 → 空戳');
});

console.log('T-417 主动性 · 注入');

await check('有 initiative 时，指令里是"如果冷场，你就<角色自己的做法>"', () => {
  const stage = stageOf({ initiative: '主动翻出旧相册', initiativeFrom: '1' });
  const p = profileOf('看海', 1);
  const text = buildInstruction({ stage, outline: { title: 'T' }, profile: p });
  assert.ok(text.includes('不要等 user 提问或回应'), '主动性要求必须在');
  assert.ok(text.includes('如果冷场，你就主动翻出旧相册'), '要用侧写推导出来的那句');
  assert.ok(proactiveLine(stage, p).includes('主动翻出旧相册'));
});

await check('没有 / 过期 initiative → 退回通用句，不注入过期内容', () => {
  const generic = '如果冷场，你就自己找一件事继续';
  const noInitiative = buildInstruction({ stage: stageOf(), outline: {}, profile: null });
  assert.ok(noInitiative.includes(generic), '没侧写也要带主动性指令');

  const stale = stageOf({ initiative: '主动翻出旧相册', initiativeFrom: '1' });
  const text = buildInstruction({ stage: stale, outline: {}, profile: profileOf('复仇', 2) });
  assert.ok(text.includes(generic), '过期 → 退回通用句');
  assert.equal(text.includes('主动翻出旧相册'), false, '过期内容绝不能注入');
});

await check('收尾场（ready）与快到点的场也带主动性', () => {
  const ready = stageOf({ status: 'ready', initiative: '主动提起下次约会', initiativeFrom: '1' });
  const readyText = buildInstruction({ stage: ready, outline: {}, profile: profileOf('看海', 1) });
  assert.ok(readyText.includes('如果冷场，你就主动提起下次约会'));

  const nearMax = stageOf({ turnCount: 8, pacing: { min: 3, max: 8 }, initiative: '主动订票', initiativeFrom: '1' });
  const nearText = buildInstruction({
    stage: nearMax, outline: {}, pacing: { min: 3, max: 8 }, profile: profileOf('看海', 1),
  });
  assert.ok(nearText.includes('这一场够久了'), '快到点的既有话术保留');
  assert.ok(nearText.includes('如果冷场，你就主动订票'));
});

console.log('T-417 主动性 · 重生成');

await check('验收：换一个侧写，同一阶段生成的 initiative 明显不同（且确实来自侧写）', async () => {
  const seen = [];
  const client = {
    request: async ({ messages }) => {
      const user = messages[1].content;
      seen.push(user);
      const desire = user.match(/核心欲望：(.+)/)?.[1]?.trim() ?? '';
      return JSON.stringify({ initiative: `${desire}——主动张罗一件事` });
    },
  };
  const patches = [];
  const stages = { update: (id, patch) => { patches.push({ id, patch }); return true; } };
  const service = createInitiativeService({ client, getConnection: () => ({}), stages });

  const a = await service.refresh({ stage: stageOf(), profile: profileOf('看海', 1) });
  const b = await service.refresh({ stage: stageOf(), profile: profileOf('复仇', 2) });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.initiative, b.initiative, '换侧写 → initiative 必须明显不同');
  assert.ok(a.initiative.includes('看海') && b.initiative.includes('复仇'));
  assert.ok(seen[0].includes('看海') && seen[1].includes('复仇'), 'prompt 里必须真的带上了侧写');
  assert.equal(patches[0].patch.initiativeFrom, '1');
  assert.equal(patches[1].patch.initiativeFrom, '2', '重生成后要换上新戳');
});

await check('解析失败 → 不写状态、返回 ok:false（G5）', async () => {
  const patches = [];
  const service = createInitiativeService({
    client: { request: async () => '我不知道该写啥' },
    getConnection: () => ({}),
    stages: { update: (id, patch) => { patches.push(patch); return true; } },
  });
  const r = await service.refresh({ stage: stageOf(), profile: profileOf('看海', 1) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PARSE_FAILED');
  assert.equal(patches.length, 0, '解析失败绝不能写状态');
});

await check('模型返回空字符串（侧写为空时的约定）→ 不写状态', async () => {
  const patches = [];
  const service = createInitiativeService({
    client: { request: async () => '{"initiative":""}' },
    getConnection: () => ({}),
    stages: { update: (id, patch) => { patches.push(patch); return true; } },
  });
  const r = await service.refresh({ stage: stageOf(), profile: profileOf('看海', 1) });
  assert.equal(r.ok, false);
  assert.equal(patches.length, 0);
});

await check('没有侧写 → 不调 API', async () => {
  let called = false;
  const service = createInitiativeService({
    client: { request: async () => { called = true; return '{}'; } },
    getConnection: () => ({}),
    stages: { update: () => true },
  });
  const r = await service.refresh({ stage: stageOf(), profile: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_PROFILE');
  assert.equal(called, false);
});

await check('API 调用失败 → ok:false，不抛异常', async () => {
  const service = createInitiativeService({
    client: { request: async () => { const e = new Error('超时'); e.name = 'TimeoutError'; throw e; } },
    getConnection: () => ({}),
    stages: { update: () => true },
  });
  const r = await service.refresh({ stage: stageOf(), profile: profileOf('看海', 1) });
  assert.equal(r.ok, false);
  assert.equal(r.error, '超时');
});

console.log(`\n通过 ${passed} 项`);
