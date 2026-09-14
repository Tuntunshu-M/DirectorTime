// T-413 测试：副本迁移（导出 / 预览警告 / 往返无损）

import assert from 'node:assert/strict';
import { exportCopy, previewCopy, applyCopy, COPY_FORMAT, COPY_VERSION } from '../src/core/portable.js';
import { createStateStore } from '../src/core/state.js';
import { normalizeStages } from '../src/director/outline.js';
import { normalizeForeshadows } from '../src/director/foreshadow.js';
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

const FIXED_NOW = () => 1700000000000;

function makeStore() {
  const ext = {};
  const ctx = {
    getExtensionSettings: () => ext,
    saveSettings: () => true,
    getChatState: () => ({}),
    saveChatState: () => true,
  };
  const store = createStateStore(ctx, 'portable_test');
  const stages = normalizeStages([
    { goal: '第一场', checkpoint: { criteria: 'c1', antiCriteria: 'a1' }, beats: ['b1'], actorId: '爱丽丝' },
    { goal: '第二场', checkpoint: { criteria: 'c2', antiCriteria: 'a2' } },
  ]);
  store.update((draft) => ({
    ...draft,
    outline: {
      id: 'ol_1', title: '去旅行', objective: '一起出门', premise: 'P',
      foreshadows: normalizeForeshadows(['旧照片'], { now: 1 }),
    },
    stages,
    activeStageId: stages[0].id,
    tone: { daily: 60, crisis: 40, intimate: 0 },
    // 占比释义的用户改动（2026-09-14）：副本必须带着走，不然搬过去会悄悄变回内置
    toneHints: { daily: '我自己的日常释义' },
  }), { track: false });
  store.saveSettings({
    will: 55, objective: '一起出门', worldSelection: { 'a:1': true }, actors: undefined,
    protagonists: [{ id: '', name: '爱丽丝' }],
    hardLimits: ['自杀'],
    connection: { mode: 'independent', endpoint: 'https://secret/v1', apiKey: 'sk-SECRET', model: 'm' },
  });
  return store;
}

const PROFILE = {
  charId: 0, charName: '爱丽丝', fields: { coreDesire: '看海' }, locked: {}, source: 'ai', updatedAt: 9,
};

const buildCopy = (store) => exportCopy({ state: store.get(), settings: store.getSettings(), profile: PROFILE, now: FIXED_NOW });

console.log('T-413 副本迁移 · 导出');

await check('导出含剧本 / 阶段 / 占比 / 设置 / 侧写', () => {
  const copy = buildCopy(makeStore());
  assert.equal(copy.format, COPY_FORMAT);
  assert.equal(copy.version, COPY_VERSION);
  assert.equal(copy.outline.title, '去旅行');
  assert.equal(copy.stages.length, 2);
  assert.equal(copy.stages[0].actorId, '爱丽丝', '阶段字段要原样带走');
  assert.equal(copy.tone.daily, 60);
  assert.equal(copy.profile.fields.coreDesire, '看海');
  assert.deepEqual(copy.settings.worldSelection, { 'a:1': true }, '世界书选择要带走');
});

await check('验收（安全）：密钥 / 端点不进副本', () => {
  const copy = buildCopy(makeStore());
  const text = JSON.stringify(copy);
  assert.equal('connection' in copy.settings, false, '连接配置不搬家');
  assert.equal(text.includes('sk-SECRET'), false);
  assert.equal(text.includes('secret/v1'), false);
});

console.log('T-413 副本迁移 · 预览与警告');

await check('不是副本文件 → ok:false，不猜也不动数据', () => {
  assert.equal(previewCopy(null).ok, false);
  assert.equal(previewCopy('字符串').ok, false);
  assert.equal(previewCopy({ hello: 'world' }).ok, false);
  assert.ok(previewCopy({ format: '别的插件' }).error.includes('导演时间'));
});

await check('概览：剧本名 / 阶段数 / 伏笔数 / 主角数 / 世界书条数', () => {
  const preview = previewCopy(buildCopy(makeStore()));
  assert.equal(preview.ok, true);
  assert.equal(preview.summary.title, '去旅行');
  assert.equal(preview.summary.stages, 2);
  assert.equal(preview.summary.foreshadows, 1);
  assert.equal(preview.summary.protagonists, 1);
  assert.equal(preview.summary.worldSelection, 1);
  assert.equal(preview.summary.hasProfile, true);
  assert.deepEqual(preview.warnings, []);
});

await check('警告：版本更新 / 没有阶段 / 没有侧写', () => {
  const newer = previewCopy({ format: COPY_FORMAT, version: COPY_VERSION + 1, stages: [{}], profile: PROFILE });
  assert.ok(newer.warnings.some((line) => line.includes('比当前插件')));

  const empty = previewCopy({ format: COPY_FORMAT, version: COPY_VERSION, stages: [], profile: PROFILE });
  assert.ok(empty.warnings.some((line) => line.includes('没有阶段')));

  const noProfile = previewCopy({ format: COPY_FORMAT, version: COPY_VERSION, stages: [{}] });
  assert.ok(noProfile.warnings.some((line) => line.includes('没有人物侧写')));
});

console.log('T-413 副本迁移 · 导入（验收判据：往返无损）');

await check('验收：导出 → 导入 → 再导出，完全一致', () => {
  const source = makeStore();
  const copy = buildCopy(source);

  const target = makeStore();
  // 目标先弄乱：换个剧本、改设置，验证导入真的覆盖了
  target.update((draft) => ({ ...draft, outline: { title: '别的剧本' }, stages: [] }), { track: false });
  target.saveSettings({ will: 10 });

  let savedProfile = null;
  const result = applyCopy(copy, { store: target, writeProfile: (next) => { savedProfile = next; } });
  assert.equal(result.ok, true);

  const again = exportCopy({ state: target.get(), settings: target.getSettings(), profile: savedProfile, now: FIXED_NOW });
  assert.deepEqual(again, copy, '往返必须一字不差（含 id）');
  assert.deepEqual(savedProfile, PROFILE, '侧写原样写回');
});

await check('导入落地：阶段 / 剧本 / 占比 / 设置都换过来了', () => {
  const target = makeStore();
  target.update((draft) => ({ ...draft, outline: null, stages: [] }), { track: false });
  applyCopy(buildCopy(makeStore()), { store: target, writeProfile: () => {} });

  const state = target.get();
  assert.equal(state.outline.title, '去旅行');
  assert.equal(state.stages.length, 2);
  assert.equal(state.activeStageId, state.stages[0].id);
  assert.equal(state.tone.daily, 60);
  assert.deepEqual(state.toneHints, { daily: '我自己的日常释义' }, '释义要跟着副本搬过来');
  assert.equal(target.getSettings().will, 55);
  assert.deepEqual(target.getSettings().hardLimits, ['自杀']);
  assert.equal(state.runtime.rounds, 0, '换副本 = 重新起一局');
});

await check('老副本（没有 toneHints 字段）导入 → 保留本机现有释义，别清掉', () => {
  const target = makeStore();
  target.update((draft) => ({ ...draft, toneHints: { crisis: '本机改过的危机释义' } }), { track: false });

  const old = buildCopy(makeStore());
  delete old.toneHints; // 模拟 0.14.0 之前导出的副本
  applyCopy(old, { store: target, writeProfile: () => {} });

  assert.deepEqual(target.get().toneHints, { crisis: '本机改过的危机释义' });
});

await check('导入不动本机连接配置（也不清掉你的密钥）', () => {
  const target = makeStore();
  const before = target.getSettings().connection;
  applyCopy(buildCopy(makeStore()), { store: target, writeProfile: () => {} });
  assert.deepEqual(target.getSettings().connection, before, '本机连接配置保持不变');
  assert.equal(target.getSettings().connection.apiKey, 'sk-SECRET', '导入不该抹掉自己的密钥');
});

await check('导入坏文件 → ok:false 且不改任何数据', () => {
  const target = makeStore();
  const before = JSON.stringify(target.get());
  const result = applyCopy({ format: 'nope' }, { store: target, writeProfile: () => {} });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(target.get()), before, '数据一个字节都不能动');
});

await check('导入不会污染默认设置（缺的字段用默认值）', () => {
  const target = makeStore();
  const copy = { format: COPY_FORMAT, version: COPY_VERSION, stages: [], settings: { will: 33 } };
  applyCopy(copy, { store: target, writeProfile: () => {} });
  assert.equal(target.getSettings().will, 33);
  assert.equal(target.getSettings().pacing.min, createDefaultSettings().pacing.min, '没搬的字段保持默认');
});

console.log(`\n通过 ${passed} 项`);
