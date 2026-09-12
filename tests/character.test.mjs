// T-402 测试：人物侧写生成、按角色存取、手改锁定、一致性自检

import assert from 'node:assert/strict';
import {
  createProfileService, emptyProfile, normalizeProfile, profileText, PROFILE_FIELDS,
} from '../src/world/character.js';
import { parseDirectorResponse } from '../src/llm/schemas.js';
import { buildCharacterLayer } from '../src/inject/instruction.js';

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error) => {
      console.error(`  ✗ ${name}\n    ${error.message}`);
      process.exitCode = 1;
    });
}

const VALID_PROFILE_JSON = JSON.stringify({
  coreDesire: '被需要但不想承认',
  fear: '被丢下',
  speech: '短句，爱反问',
  attitudeToUser: '表面冷淡',
  conflictStyle: '先退一步',
  proactivity: '想要就直说，被拒就换法子再试',
  intimacy: '用行动而非语言',
  taboo: '绝不当众示弱',
});

/** 用内存角色卡模拟 ST：侧写存在 characters[i].data.extensions */
function makeCtx({ charId = 0 } = {}) {
  const characters = [
    { name: '罗德里戈', description: '赏金猎人', personality: '冷淡', data: { extensions: {} } },
    { name: '伊莎', description: '药师', personality: '温和', data: { extensions: {} } },
  ];
  return {
    characters,
    characterId: charId,
    getCharacterId() { return this.characterId; },
    getCharacterData() { return this.characters[this.characterId]; },
    getCharacterField(key, id = null) {
      return this.characters[id ?? this.characterId]?.data?.extensions?.[key] ?? null;
    },
    writeCharacterField(key, value, id = null) {
      const character = this.characters[id ?? this.characterId];
      character.data.extensions = { ...(character.data.extensions ?? {}), [key]: value };
      return value;
    },
  };
}

const okClient = { request: async () => VALID_PROFILE_JSON };

console.log('T-402 人物侧写');

await check('八字段能生成（调 GEN_PROFILE）', async () => {
  const ctx = makeCtx();
  const service = createProfileService({ ctx, client: okClient, getConnection: () => ({}) });
  const result = await service.generate({ world: '世界书设定', context: '近期对话' });

  assert.equal(result.ok, true);
  assert.equal(PROFILE_FIELDS.every((key) => String(result.fields[key]).length > 0), true);
  assert.ok(result.request[0].content.includes('角色分析师'));
  assert.ok(result.request[1].content.includes('世界书设定'));
});

await check('解析失败 → ok:false，且不写任何东西（G5）', async () => {
  const ctx = makeCtx();
  const service = createProfileService({ ctx, client: { request: async () => '我不知道' }, getConnection: () => ({}) });
  const result = await service.generate({});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PARSE_FAILED');
  assert.equal(ctx.getCharacterField('director_time'), null);
});

await check('手改某字段 → 该字段 locked', async () => {
  const ctx = makeCtx();
  const service = createProfileService({ ctx, client: okClient, getConnection: () => ({}) });
  await service.regenerate({});
  service.edit('fear', '手改的恐惧');
  const profile = service.read();
  assert.equal(profile.locked.fear, true);
  assert.equal(profile.fields.fear, '手改的恐惧');
});

await check('再生成时 locked 字段不被覆盖，未锁定字段会刷新', async () => {
  const ctx = makeCtx();
  const service = createProfileService({ ctx, client: okClient, getConnection: () => ({}) });
  await service.regenerate({});
  service.edit('fear', '手改的恐惧');

  const again = await service.regenerate({});
  assert.equal(again.ok, true);
  assert.equal(again.profile.fields.fear, '手改的恐惧', 'locked 字段必须保留');
  assert.equal(again.profile.fields.speech, '短句，爱反问', '未锁定字段应来自 AI');
});

await check('解锁后该字段恢复可被 AI 覆盖', async () => {
  const ctx = makeCtx();
  const service = createProfileService({ ctx, client: okClient, getConnection: () => ({}) });
  service.edit('fear', '手改的恐惧');
  service.unlock('fear');
  const again = await service.regenerate({});
  assert.equal(again.profile.fields.fear, '被丢下');
});

await check('换角色读到不同侧写（按角色绑定，跨聊天复用）', () => {
  const ctx = makeCtx();
  const service = createProfileService({ ctx, client: okClient, getConnection: () => ({}) });

  service.edit('coreDesire', '角色 0 的欲望');
  ctx.characterId = 1;
  assert.equal(service.read().fields.coreDesire, '', '换角色应是空侧写');
  service.edit('coreDesire', '角色 1 的欲望');
  ctx.characterId = 0;
  assert.equal(service.read().fields.coreDesire, '角色 0 的欲望');
});

await check('profileText 带字段标签，空字段不出现', () => {
  const text = profileText({ fields: { coreDesire: '想要', fear: '', speech: '爱反问' } });
  assert.ok(text.includes('核心欲望：想要'));
  assert.ok(text.includes('说话方式：爱反问'));
  assert.ok(!text.includes('恐惧'));
  assert.equal(profileText(emptyProfile()), '');
});

await check('侧写进入角色动机层（双端注入的角色端）', () => {
  const text = buildCharacterLayer({
    profile: { fields: { coreDesire: '被需要', conflictStyle: '先退一步', speech: '短句', taboo: '绝不当众示弱' } },
  });
  assert.ok(text.includes('[角色此刻的动机]'));
  assert.ok(text.includes('他想要：被需要'));
  assert.ok(text.includes('他处理冲突的方式：先退一步'));
  assert.ok(text.includes('他说话的方式：短句'));
  assert.ok(text.includes('他绝不会：绝不当众示弱'));
});

await check('normalizeProfile 容忍旧数据 / 缺字段', () => {
  const profile = normalizeProfile({ fields: { coreDesire: 'x' } }, { charId: 3, charName: 'C' });
  assert.equal(profile.fields.coreDesire, 'x');
  assert.equal(profile.fields.fear, '');
  assert.equal(profile.charId, 3);
  assert.equal(normalizeProfile(null).schemaVersion, 1);
  assert.deepEqual(normalizeProfile(null).locked, {});
});

await check('checkConsistency：不合格 ok:false；解析失败/调用失败按合格（不阻塞）', async () => {
  const ctx = makeCtx();
  const bad = createProfileService({ ctx, client: { request: async () => '{"ok":false,"reason":"不像人设"}' }, getConnection: () => ({}) });
  assert.equal((await bad.checkConsistency({ profile: emptyProfile(), stages: [] })).ok, false);

  const broken = createProfileService({ ctx, client: { request: async () => '乱码' }, getConnection: () => ({}) });
  assert.equal((await broken.checkConsistency({ profile: emptyProfile(), stages: [] })).ok, true);

  const boom = createProfileService({
    ctx,
    client: { request: async () => { throw new Error('超时'); } },
    getConnection: () => ({}),
  });
  assert.equal((await boom.checkConsistency({ profile: emptyProfile(), stages: [] })).ok, true);
});

await check('isValidProfile：允许个别字段为空（P0 修正 —— 模型常有一两项写不出来）', () => {
  assert.equal(parseDirectorResponse(VALID_PROFILE_JSON, 'profile').coreDesire, '被需要但不想承认');

  // 少写一项 / 某项留空 → 仍然合格（以前是"八项缺一不可"，会把整份侧写判死）
  const missing = JSON.parse(VALID_PROFILE_JSON);
  delete missing.taboo;
  assert.ok(parseDirectorResponse(JSON.stringify(missing), 'profile'), '少一项也该收下');
  const blank = { ...JSON.parse(VALID_PROFILE_JSON), taboo: '   ' };
  assert.ok(parseDirectorResponse(JSON.stringify(blank), 'profile'), '留空也该收下');

  // 但只剩一两项的残次品仍然不合格（G5：不注入来路不明的东西）
  assert.equal(parseDirectorResponse(JSON.stringify({ coreDesire: 'x', fear: 'y' }), 'profile'), null);
});

await check('生成侧写：缺的字段补空串、全部写进角色卡（P0 修正）', async () => {
  const slots = {};
  const ctx = {
    getCharacterId: () => 0,
    getCharacterData: () => ({ name: 'C' }),
    getCharacterField: (key) => slots[key] ?? null,
    writeCharacterField: (key, value) => { slots[key] = JSON.parse(JSON.stringify(value)); },
  };
  const partial = {
    coreDesire: '看海', fear: '被丢下', speech: '话少', attitudeToUser: '嘴硬心软',
    conflictStyle: '先退一步', proactivity: '被动', intimacy: '', taboo: '',
  };
  const profile = createProfileService({
    ctx,
    client: { request: async () => JSON.stringify(partial) },
    getConnection: () => ({}),
  });

  const result = await profile.regenerate({});
  assert.equal(result.ok, true, '不能因为一两项为空就整份失败');
  assert.equal(result.profile.fields.intimacy, '', '缺的补空串，而不是丢掉');
  assert.equal(slots.director_time.fields.coreDesire, '看海', '要真的落到角色卡上');
  assert.equal(profile.read().fields.coreDesire, '看海', '面板读得到（判据：生成后自动填入）');
  assert.equal(profile.read().fields.intimacy, '');
});

console.log(`\n通过 ${passed} 项`);
