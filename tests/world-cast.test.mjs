// T-437 测试：世界书里的角色识别（只扫已勾选条目 · 本地零调用 · 等用户勾选）
//
// 规格：`规格-T437-世界书角色识别.md §6 验收`。这个文件覆盖：
//   行首标签式 / 引号主语 / 称谓模式 / 停用词过滤 / 长度过滤 /
//   次数与出处统计 / 排序与上限 / 只扫已勾选 / 零 API 调用 / 不自动设主角 / 缓存失效

import assert from 'node:assert/strict';
import {
  extractWorldCast, isCastNameCandidate, normalizeCastName, WORLD_CAST_LIMIT,
} from '../src/world/world-cast.js';
import { entryKey } from '../src/world/lorebook.js';
import { toggleWorldProtagonist } from '../src/world/cast.js';
import { bootstrap } from '../src/bootstrap.js';
import { createStateStore } from '../src/core/state.js';

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

async function acheck(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

/** 造一条"条目"（形状与 lorebook.normalizeEntry + pickSelected 的产出一致） */
function entry(text, name = '条', book = '书') {
  return {
    key: entryKey(book, name),
    entryKey: entryKey(book, name),
    name,
    bookName: book,
    sourceType: 'library',
    sourceLabel: '全部世界书',
    content: text,
  };
}

const names = (result) => result.detected.map((item) => item.name);
const find = (result, name) => result.detected.find((item) => item.name === name);

console.log('T-437 本地抽取（零调用）');

await check('行首标签式：`XX：` / `XX ——` / `XX -` 都能识别（世界书最常见的写法）', () => {
  const result = extractWorldCast([entry('艾拉：她是宅子里最安静的那个。\n管家 · 莫兰——管着整栋老宅。\n莉泽 - 只在夜里出现。')]);
  assert.ok(names(result).includes('艾拉'), '`XX：` 必须能认出来（漏了等于没做）');
  assert.ok(names(result).includes('管家 · 莫兰'), '`XX——` 带间隔号的写法也要认');
  assert.ok(names(result).includes('莉泽'), '`XX -` 也要认');
});

await check('引号前主语：`XX说：“…”` / `XX低声说：“…”` 认的是 XX', () => {
  const result = extractWorldCast([entry('艾拉说：“别过来。”\n管家低声说：“随您。”')]);
  assert.ok(names(result).includes('艾拉'), '别把"说"粘进名字里');
  assert.ok(names(result).includes('管家'), '`低声说` 要连着剥掉');
  assert.equal(names(result).includes('艾拉说'), false, '不能出现"艾拉说"这种带动词的候选');
});

await check('称谓模式：`XX 看着` / `XX 笑了` / `XX 的`', () => {
  const result = extractWorldCast([entry('莉泽看着窗外。\n艾拉笑了。\n管家的手很稳。')]);
  assert.ok(names(result).includes('莉泽'));
  assert.ok(names(result).includes('艾拉'));
  assert.ok(names(result).includes('管家'));
});

await check('停用词过滤（噪声比漏检更烦人）', () => {
  const result = extractWorldCast([entry('世界：这个故事的时间线是这样的。\n他们：我们讨论过自己。\n不知：其实并没有。\n第三章：夜色降临。')]);
  for (const noise of ['世界', '故事', '时间', '他们', '我们', '自己', '不知', '其实', '没有', '第三章']) {
    assert.equal(names(result).includes(noise), false, `不该把「${noise}」当角色`);
  }
});

await check('长度 / 字符过滤：1 字、7 字、纯数字、纯符号都丢掉', () => {
  assert.equal(isCastNameCandidate('艾'), false, '1 字不算');
  assert.equal(isCastNameCandidate('一二三四五六七'), false, '7 字不算');
  assert.equal(isCastNameCandidate('1234'), false, '纯数字不算');
  assert.equal(isCastNameCandidate('！！？？'), false, '纯符号不算');
  assert.equal(isCastNameCandidate('艾拉'), true);
  assert.equal(isCastNameCandidate('管家 · 莫兰'), true, '间隔号不算字数');
  assert.equal(isCastNameCandidate('裴氏集团'), false, '组织不是可攻略的角色');
  assert.equal(isCastNameCandidate('以上为本条目'), false, '虚词堆起来的不算名字');

  const result = extractWorldCast([entry('1234：数字不该进来。\n艾：一个字也不该进来。')]);
  assert.deepEqual(names(result), []);
});

await check('出现次数与出处准确（同一位置被多条规则命中只算一次）', () => {
  const result = extractWorldCast([
    entry('艾拉：第一次登场。\n艾拉说：“又一次。”', '条1', '书A'),
    entry('莉泽提起过艾拉。\n莉泽笑了。', '条2', '书B'),
  ]);
  const ella = find(result, '艾拉');
  assert.equal(ella.count, 3, '条1 两次 + 条2 一次；`艾拉：` 与 `艾拉说：` 是同一处，别重复计');
  assert.equal(ella.sources.length, 2, '出自 2 条');
  assert.deepEqual(ella.sources.map((item) => item.entryKey), [entryKey('书A', '条1'), entryKey('书B', '条2')]);
  assert.equal(ella.sources[0].bookName, '书A', '出处要带书名，界面要显示');
  assert.equal(find(result, '莉泽').count, 2, '规则认出来的名字，裸提也数上（用户手动数一遍能对上）');
});

await check('排序：出现次数降序；同次数按首次出现位置；上限 30', () => {
  const result = extractWorldCast([entry('艾拉说：“一。”\n莉泽笑了。\n莉泽说：“二。”\n管家的手很稳。')]);
  assert.deepEqual(names(result), ['莉泽', '艾拉', '管家'], '次数多的在前，同次数按谁先出现');

  const many = extractWorldCast([
    entry(Array.from({ length: 40 }, (_, i) => `角色${'甲乙丙丁戊己庚辛壬癸'[i % 10]}${i}：第 ${i} 条。`).join('\n')),
  ]);
  assert.equal(many.detected.length, WORLD_CAST_LIMIT, `最多列 ${WORLD_CAST_LIMIT} 个`);
  assert.equal(many.truncated, true, '超出的要能告诉界面"还有 N 个"');
  assert.equal(many.total, 40);
});

await check('已知名单（主角 / 当前生成者）排最前，且豁免长度限制', () => {
  const result = extractWorldCast(
    [entry('莉泽说：“一。”\n莉泽笑了。\n罗德里戈：他来了。\n艾：只有一个字。')],
    { known: ['罗德里戈', '艾'] },
  );
  assert.deepEqual(names(result).slice(0, 2), ['罗德里戈', '艾'], '已知名单必须排最前');
  assert.ok(names(result).includes('莉泽'), '已知名单不该把别人挤掉');
});

await check('空输入 / 空文本不崩', () => {
  assert.deepEqual(names(extractWorldCast([])), []);
  assert.deepEqual(names(extractWorldCast([entry('')])), []);
  assert.deepEqual(names(extractWorldCast(null)), []);
  assert.equal(normalizeCastName(' 管家 · 莫兰 '), '管家 · 莫兰');
});

console.log('T-437 装配层：只扫已勾选 · 零调用 · 不自动设主角');

/** 最小环境：两本书 + 一个"当前生成者" */
function makeEnv({ selection = {}, books } = {}) {
  const reads = [];
  const data = books ?? {
    书A: [
      { uid: 1, comment: '艾拉', text: '艾拉：她是宅子里最安静的那个。\n艾拉说：“别过来。”\n莉泽看着她。' },
      { uid: 2, comment: '风景', text: '老宅的走廊很长，窗外下着雨。' },
    ],
    书B: [{ uid: 1, comment: '罗德里戈', text: '罗德里戈：他才是真正的主角。' }],
  };
  const ext = {};
  const chat = {};
  const ctx = {
    capabilities: {},
    getExtensionSettings: () => ext,
    saveSettings: () => true,
    getChatState: () => chat,
    saveChatState: () => true,
    getMessages: () => [],
    on: () => () => {},
    showSystemMessage: () => {},
    setExtensionPrompt: () => true,
    clearExtensionPrompt: () => true,
    getCharacterId: () => 0,
    getCharacterData: () => ({ name: '罗德里戈' }),
    getLorebookSources: () => [{ type: 'library', label: '全部世界书', names: Object.keys(data) }],
    loadWorldInfoBook: async (name) => {
      reads.push(name);
      if (data[name] === 'ERROR') throw new Error('加载失败');
      return { entries: data[name] };
    },
    getCharacterBookEntries: () => [],
  };
  const store = createStateStore(ctx, 'director_time_worldcast_test');
  const api = bootstrap({ ctx, store });
  if (Object.keys(selection).length) api.ui.saveWorldSelection(selection);
  return { ctx, store, api, reads };
}

await acheck('只扫**已勾选**的条目：没勾的书一本都不读', async () => {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  const result = await env.api.cast.scanWorld();

  assert.deepEqual(env.reads, ['书A'], '书B 一条都没勾，不该去读它');
  assert.equal(result.selectedCount, 1, '共勾选 1 条');
  assert.equal(result.scannedCount, 1, '扫了 1 条');
  const got = result.detected.map((item) => item.name);
  assert.ok(got.includes('艾拉'), '勾选条目里提到的角色要认出来');
  assert.ok(got.includes('莉泽'));
  assert.equal(got.includes('罗德里戈'), false, '没勾的条目（书B）里的角色不许出现');
});

await check('取消勾选后重扫，扫的条数跟着变小（并如实显示"共勾选 Y 条"）', async () => {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true, [entryKey('书B', '1')]: true } });
  const first = await env.api.cast.scanWorld();
  assert.equal(first.selectedCount, 2);
  assert.equal(first.scannedCount, 2);
  assert.ok(first.detected.map((item) => item.name).includes('罗德里戈'), '勾了书B就该扫到');

  env.api.ui.saveWorldSelection({ [entryKey('书A', '1')]: true });
  const second = await env.api.cast.scanWorld();
  assert.equal(second.selectedCount, 1, '取消勾选后共勾选要变小');
  assert.equal(second.scannedCount, 1, '扫的条数也要跟着变小');
  assert.ok(second.scannedCount <= second.selectedCount, 'X 必须 ≤ Y');
  assert.equal(second.detected.map((item) => item.name).includes('罗德里戈'), false, '取消勾选后不该再有它');
});

await check('零 API 调用：累计调用次数不变，且全程不发任何请求', async () => {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  const before = env.store.get().cost?.callCount ?? 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('扫描不该发请求（本地零调用）'); };
  try {
    await env.api.cast.scanWorld();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(env.store.get().cost?.callCount ?? 0, before, '扫描前后累计调用次数必须一样');
  assert.equal(before, 0, '这个环境里本来就一次都没调过');
});

await check('**绝不自动设主角**：扫完 protagonists 一个都没多', async () => {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  const before = env.store.getSettings().protagonists;
  assert.deepEqual(before, [], '开局没有主角');

  const result = await env.api.cast.scanWorld();
  assert.ok(result.detected.length >= 2, '确实识别到了角色');
  assert.deepEqual(env.store.getSettings().protagonists, [], '识别结果只进候选，不许自动设主角');
  assert.deepEqual(env.api.ui.read().cast.list, [], '界面看到的名单也还是空的');
});

await check('勾选候选 = 只存名字（没有卡 id），再点一次 = 移除', async () => {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  await env.api.cast.scanWorld();

  env.api.cast.toggleWorld('艾拉');
  assert.deepEqual(env.store.getSettings().protagonists, [{ id: '', name: '艾拉' }], '世界书来的角色只存 name');

  env.api.cast.toggleWorld('艾拉');
  assert.deepEqual(env.store.getSettings().protagonists, [], '再点一次就取消');

  // 已有的主角（角色卡来的）不能被重复加
  assert.deepEqual(toggleWorldProtagonist([{ id: '1', name: '艾拉' }], '艾拉'), []);
});

await check('读不到内容的条目如实计入「N 条读不到内容」', async () => {
  const env = makeEnv({
    selection: { [entryKey('坏书', '1')]: true, [entryKey('书A', '1')]: true },
    books: { 坏书: 'ERROR', 书A: [{ uid: 1, comment: '艾拉', text: '艾拉：她来了。' }] },
  });
  const result = await env.api.cast.scanWorld();
  assert.equal(result.selectedCount, 2);
  assert.equal(result.scannedCount, 1);
  assert.equal(result.unreadable, 1, '拿不到的那条要报出来，别假装都扫到了');
});

await check('缓存：勾选没变不重扫；勾选变了自动标记过期', async () => {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  assert.equal(env.api.ui.read().cast.world.stale, true, '还没扫过 = 过期');

  await env.api.cast.scanWorld();
  const snapshot = env.api.ui.read().cast.world;
  assert.equal(snapshot.stale, false, '扫完就不该再算过期');
  assert.equal(snapshot.scannedCount, 1);
  assert.equal(snapshot.selectedCount, 1);
  assert.ok(snapshot.detected.length >= 2, '快照要带候选清单（界面读这份）');

  const readsAfterFirst = env.reads.length;
  await env.api.cast.scanWorld();
  assert.equal(env.reads.length, readsAfterFirst, '勾选没变 → 走缓存，不重读世界书');

  env.api.ui.saveWorldSelection({ [entryKey('书A', '1')]: true, [entryKey('书B', '1')]: true });
  assert.equal(env.api.ui.read().cast.world.stale, true, '改了勾选 → 下次打开人物页要重扫');
  await env.api.cast.scanWorld();
  assert.equal(env.api.ui.read().cast.world.selectedCount, 2);
});

await check('「重新识别」= force：指纹没变也照重算（不能把旧缓存端回去）', async () => {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  const first = await env.api.cast.scanWorld();
  assert.equal(await env.api.cast.scanWorld(), first, '不 force → 指纹一样就复用缓存');

  const forced = await env.api.cast.scanWorld({ force: true });
  assert.notEqual(forced, first, '点了「重新识别」必须真重算');
  assert.equal(forced.scannedCount, first.scannedCount, '重算结果要与事实一致');
  assert.deepEqual(forced.detected.map((item) => item.name), first.detected.map((item) => item.name));
});

await check('一条世界书都没勾选时：不报错、扫 0 条', async () => {
  const env = makeEnv({ selection: {} });
  const result = await env.api.cast.scanWorld();
  assert.equal(result.selectedCount, 0);
  assert.equal(result.scannedCount, 0);
  assert.deepEqual(result.detected, []);
  assert.deepEqual(env.reads, [], '没勾选就别去读书');
});

console.log(`\n通过 ${passed} 项`);
