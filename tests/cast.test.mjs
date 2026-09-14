// T-412 测试：多人卡适配（主角多选 / actorId / 注入门 / 侧写分存）

import assert from 'node:assert/strict';
import {
  normalizeProtagonists, shouldInject, protagonistText,
  isProtagonist, toggleProtagonist, addProtagonist, removeProtagonist,
} from '../src/world/cast.js';
import { createReviewService } from '../src/director/review.js';
import { createProfileService } from '../src/world/character.js';
import { createStateStore } from '../src/core/state.js';
import { createStageService } from '../src/director/stage.js';
import { normalizeStages } from '../src/director/outline.js';
import { createDefaultSettings } from '../src/core/default-state.js';

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

const ALICE = { id: '1', name: '爱丽丝' };
const BOB = { id: '2', name: '鲍勃' };
const CAST = [ALICE, BOB];

console.log('T-412 多人卡 · 主角设置');

await check('归一化：字符串简写 / 对象都认，空的丢掉', () => {
  assert.deepEqual(normalizeProtagonists([' 爱丽丝 ', { id: '2', name: '鲍勃' }]), [{ id: '', name: '爱丽丝' }, BOB]);
  assert.deepEqual(normalizeProtagonists(['  ', null, {}, '爱丽丝']), [{ id: '', name: '爱丽丝' }]);
  assert.deepEqual(normalizeProtagonists(null), []);
  assert.deepEqual(normalizeProtagonists('爱丽丝'), []);
});

await check('默认不设主角（单卡老行为）', () => {
  assert.deepEqual(createDefaultSettings().protagonists, []);
});

console.log('T-436 多人卡自选（自动识别的卡 + 手填 NPC）');

await check('isProtagonist / toggle：勾选与取消（id 或名字任一匹配）', () => {
  assert.equal(isProtagonist(CAST, { name: '爱丽丝' }), true);
  assert.equal(isProtagonist(CAST, { id: '2' }), true, 'id 对上也算');
  assert.equal(isProtagonist(CAST, { name: '路人甲' }), false);

  assert.deepEqual(toggleProtagonist(CAST, ALICE), [BOB], '再点一次 = 取消勾选');
  assert.deepEqual(toggleProtagonist([BOB], ALICE), [BOB, ALICE], '勾上要加进去');
});

await check('add：手填 NPC（标 manual；空 / 重复 / 与已有角色同名都不加）', () => {
  const added = addProtagonist(CAST, ' 酒馆老板 ');
  assert.deepEqual(added.at(-1), { id: '', name: '酒馆老板', manual: true });
  assert.equal(addProtagonist(added, '酒馆老板').length, 3, '重复不加');
  assert.equal(addProtagonist(added, '   ').length, 3, '空不加');
  assert.equal(addProtagonist(added, '爱丽丝').length, 3, '和已有角色同名也不加');
});

await check('remove：id 或名字对上就删（手填的也能删）', () => {
  const npc = { id: '', name: '酒馆老板', manual: true };
  const list = [ALICE, BOB, npc];
  assert.deepEqual(removeProtagonist(list, { name: '鲍勃' }), [ALICE, npc]);
  assert.deepEqual(removeProtagonist(list, { id: '1' }), [BOB, npc]);
  assert.deepEqual(removeProtagonist(list, npc), [ALICE, BOB]);
});

await check('归一化去重：同名的只留一条（勾选与手填撞车时不重复）', () => {
  assert.equal(normalizeProtagonists([{ id: '1', name: '爱丽丝' }, { id: '', name: ' 爱丽丝 ' }]).length, 1);
});

await check('NPC 也能当主角：注入门认手填名字与 actorId', () => {
  const npc = { id: '', name: '酒馆老板', manual: true };
  const list = [npc];
  assert.equal(shouldInject({ stage: { actorId: '酒馆老板' }, speaker: { name: '酒馆老板' }, protagonists: list }), true);
  assert.equal(shouldInject({ stage: { actorId: '爱丽丝' }, speaker: { name: '酒馆老板' }, protagonists: list }), false, '不是他的戏就别注入');
  assert.equal(shouldInject({ stage: {}, speaker: { name: '爱丽丝' }, protagonists: list }), false, '当前生成者不在名单里 → 不注入');
});

await check('protagonistText 给导演看的主角清单，带 actorId 写法', () => {
  const text = protagonistText(CAST);
  assert.ok(text.includes('爱丽丝') && text.includes('鲍勃'));
  assert.ok(text.includes('actorId'));
  assert.equal(protagonistText([]), '（未设置，按单卡处理）');
});

console.log('T-412 多人卡 · 注入门（验收判据）');

await check('没配主角 → 照常注入（不影响单卡用户）', () => {
  assert.equal(shouldInject({ stage: { actorId: '爱丽丝' }, speaker: ALICE, protagonists: [] }), true);
});

await check('当前生成者不是主角 → 不注入主角的戏', () => {
  assert.equal(shouldInject({ stage: { actorId: '爱丽丝' }, speaker: { id: '9', name: '路人' }, protagonists: CAST }), false);
});

await check('是主角、但这—场不是他的戏 → 不注入', () => {
  assert.equal(shouldInject({ stage: { actorId: '爱丽丝' }, speaker: BOB, protagonists: CAST }), false);
});

await check('是主角且就是这场的主角 → 注入', () => {
  assert.equal(shouldInject({ stage: { actorId: '爱丽丝' }, speaker: ALICE, protagonists: CAST }), true);
  assert.equal(shouldInject({ stage: {}, speaker: BOB, protagonists: CAST }), true, '阶段没写归属 → 主角自己演');
});

await check('匹配：有 id 按 id，没 id 按名字（不区分大小写）', () => {
  assert.equal(shouldInject({ stage: { actorId: '2' }, speaker: { id: '2', name: '改了名' }, protagonists: CAST }), true);
  assert.equal(shouldInject({ stage: { actorId: 'alice' }, speaker: { id: '', name: 'ALICE' }, protagonists: [{ id: '', name: 'alice' }] }), true);
  assert.equal(shouldInject({ stage: { actorId: '爱丽丝' }, speaker: { id: '', name: '爱丽丝' }, protagonists: [{ id: '', name: '爱丽丝' }] }), true);
});

await check('问不到当前角色时别乱拦', () => {
  assert.equal(shouldInject({ stage: { actorId: '爱丽丝' }, speaker: null, protagonists: CAST }), true);
  assert.equal(shouldInject({ stage: { actorId: '爱丽丝' }, speaker: {}, protagonists: CAST }), true);
});

console.log('T-412 多人卡 · 接线');

await check('阶段带 actorId（来自生成结果）', () => {
  const stages = normalizeStages([{ goal: 'g', actorId: '爱丽丝', checkpoint: { criteria: 'c', antiCriteria: 'a' } }]);
  assert.equal(stages[0].actorId, '爱丽丝');
  assert.equal(normalizeStages([{ goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'a' } }])[0].actorId, '');
});

function makeEnv(actorId) {
  const ctx = {
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
  };
  const store = createStateStore(ctx, 'cast_test');
  const stages = normalizeStages([{ goal: '知道想不想去', actorId, checkpoint: { criteria: 'c', antiCriteria: 'a' } }]);
  store.update((draft) => ({ ...draft, stages, activeStageId: stages[0].id }), { track: false });
  const registered = [];
  let current = '';
  const registry = {
    register: (text) => { current = text ?? ''; registered.push(current); return true; },
    clear: () => { current = ''; registered.push(''); return true; },
    getStatus: () => ({ registered: Boolean(current), length: current.length, text: current }),
  };
  return { store, stages: createStageService({ store }), registry, registered };
}

await check('注入门生效：不是自己的戏就不注入，并且把旧注入清掉', () => {
  const env = makeEnv('爱丽丝');
  let speaker = BOB;
  const review = createReviewService({
    stages: env.stages, registry: env.registry, store: env.store,
    getSpeaker: () => speaker,
    getSettings: () => ({ protagonists: CAST, pacing: { min: 3, max: 8 } }),
  });

  assert.equal(review.syncInjection(), '', '鲍勃登场时不该看到爱丽丝的戏');
  assert.equal(env.registry.getStatus().text, '', '旧的注入要被清干净');

  speaker = ALICE;
  assert.ok(review.syncInjection().includes('知道想不想去'), '轮到爱丽丝就正常注入');
});

await check('没配主角时行为不变（回归保护）', () => {
  const env = makeEnv('');
  const review = createReviewService({
    stages: env.stages, registry: env.registry, store: env.store,
    getSpeaker: () => BOB,
    getSettings: () => ({ protagonists: [], pacing: { min: 3, max: 8 } }),
  });
  assert.ok(review.syncInjection().includes('知道想不想去'));
});

await check('验收：主角可多选并持久化', () => {
  const ctx = {
    getExtensionSettings: () => ext,
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
  };
  const ext = {};
  const store = createStateStore(ctx, 'cast_store_test');
  store.saveSettings({ protagonists: normalizeProtagonists(CAST) });
  assert.deepEqual(store.getSettings().protagonists, CAST, '多个主角都要存住');
});

await check('验收：侧写按角色分存（换角色才需要重生成）', () => {
  const cells = {};
  const names = { 1: '爱丽丝', 2: '鲍勃' };
  let currentId = 1;
  const ctx = {
    getCharacterId: () => currentId,
    getCharacterData: () => ({ name: names[currentId] }),
    getCharacterField: (key, id) => cells[`${id ?? currentId}:${key}`] ?? null,
    writeCharacterField: (key, value, id) => { cells[`${id}:${key}`] = JSON.parse(JSON.stringify(value)); },
  };
  const profile = createProfileService({ ctx, client: {}, getConnection: () => ({}) });

  profile.edit('coreDesire', '爱丽丝想去看海');
  currentId = 2;
  assert.equal(profile.read().fields.coreDesire, '', '鲍勃不该看到爱丽丝的侧写');
  profile.edit('coreDesire', '鲍勃想复仇');

  currentId = 1;
  assert.equal(profile.read().fields.coreDesire, '爱丽丝想去看海', '切回来还是自己的');
  assert.equal(profile.read(2).fields.coreDesire, '鲍勃想复仇', '也能按 id 直接读某个角色的');
});

console.log(`\n通过 ${passed} 项`);
