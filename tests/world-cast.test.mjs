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
    // 2026-09-14：这条模拟**当前角色卡的世界书**（主书），多人卡的角色一般就写在这里
    sourceType: 'character-primary',
    sourceLabel: '角色主世界书',
    content: text,
  };
}

const names = (result) => result.detected.map((item) => item.name);
const find = (result, name) => result.detected.find((item) => item.name === name);

console.log('T-437 本地抽取（零调用）');

await check('行首标签式：`XX：` / `XX ——` 认；**行内单破折号不认**（2026-09-14 修）', () => {
  const result = extractWorldCast([entry('艾拉：她是宅子里最安静的那个。\n管家 · 莫兰——管着整栋老宅。')]);
  assert.ok(names(result).includes('艾拉'), '`XX：` 必须能认出来（漏了等于没做）');
  assert.ok(names(result).includes('管家 · 莫兰'), '`XX——` 带间隔号的写法也要认');

  // 单破折号当分隔符会把半句话切成"人名" —— 维护者清单里的 `布满深浅不-` 就是这么来的
  assert.deepEqual(names(extractWorldCast([entry('布满深浅不-的疤痕一直延伸到下颌。')])), [],
    '行内单破折号不是标签分隔符');
});

await check('引号前主语：`XX说：“…”` / `XX低声说：“…”` 认的是 XX', () => {
  const result = extractWorldCast([entry('艾拉说：“别过来。”\n管家低声说：“随您。”')]);
  assert.ok(names(result).includes('艾拉'), '别把"说"粘进名字里');
  assert.ok(names(result).includes('管家'), '`低声说` 要连着剥掉');
  assert.equal(names(result).includes('艾拉说'), false, '不能出现"艾拉说"这种带动词的候选');
});

// 2026-09-14 实机反馈：「温柔 / 底色」混进候选 —— 根因是 `XX的` 这条弱规则。
// 第一次修（hy4）把它降级成弱证据；第二次修（见下）**直接删掉** —— 它造的半句噪声远比真信号多。
await check('称谓模式：`XX 看着` / `XX 笑了` 认；**`XX 的` 已删除**（噪声源）', () => {
  const result = extractWorldCast([entry('莉泽看着窗外。\n艾拉笑了。')]);
  assert.ok(names(result).includes('莉泽'), '动词模式可靠，直接进候选');
  assert.ok(names(result).includes('艾拉'));
  assert.deepEqual(result.weak ?? [], [], '弱证据通道现在是空的（没有规则再产出它）');

  // 这条规则造过的半句噪声（维护者清单里的原话）：全都得消失
  for (const sentence of ['他喜欢用黑色的风衣。', '陈旧血迹的痕迹还在。', '兄弟间存有一份默契。', '布满深浅不一的疤痕。']) {
    const got = names(extractWorldCast([entry(sentence)]));
    assert.deepEqual(got, [], `不该从「${sentence}」里挖出任何名字（实际：${got.join('、')}）`);
  }

  // 但"没名字的角色"要捞回来：`管家` 走的是亲属/角色称谓白名单（规则④），不是 `XX的`
  assert.ok(names(extractWorldCast([entry('管家的手很稳。')])).includes('管家'),
    '`管家` 是角色称谓白名单命中的 —— `XX的` 删了之后靠它捞回来');
});

await check('2026-09-14 反馈：「温柔」「底色」这类词不许进候选', () => {
  const result = extractWorldCast([entry('温柔的底色是冷漠，底色之下没有别的东西。\n成功的阈值很高。')]);
  for (const noise of ['温柔', '底色', '冷漠', '成功', '阈值', '东西']) {
    assert.equal(names(result).includes(noise), false, `「${noise}」不是角色，候选区里不许有`);
  }
  assert.deepEqual(names(result), [], '这一段里根本没有角色名，候选区该是空的');
});

// ★ 2026-09-14 第二次实机反馈的主症状：世界书是"设定卡"写法（每行 `栏目名：值`），
//   而规则①把每个栏目名都当成了人名 —— 维护者贴出的几十个假人名就是这些。
await check('★ 设定卡写法：栏目名一个都不许进候选，只留下真角色', () => {
  const card = [
    '名称：裴玉',
    '代号：Lobo',
    '性别：男',
    '年龄：25',
    '体型：高挺',
    '面部：轮廓柔和',
    '发型：黑短发',
    '遮面：无',
    '价值观：利己',
    '知识盲区：青春期',
    '核心身份：裴氏集团小裴董',
    '性格：温柔、腹黑',
    '性格调色盘：强硬 / 冷酷无情',
    '外貌：黑短发整齐，浅灰下垂眼，布满深浅不一的疤痕',
    '服饰：喜欢用黑色的风衣',
    '鞋履：皮鞋',
    '配饰：手表',
    '气味：香柠檬',
    '习惯：摸爬滚打多年，经过血火考验',
    '经历：青春期在宿舍',
    '语言：说带浓重口普',
    '对话示例：“你来了。”',
    '关系描述：与伯伯、哥哥、父亲、母亲',
    '角色阶段：远观窥伺 → 蛇行试探',
    '作息：工作后熬夜',
    '变化倾向：兽化缠身',
    '表达方式：惯于按摩',
    '基本信息：补充说明',
  ].join('\n');

  const result = extractWorldCast([entry(card, '裴玉设定', '裴玉')], { known: ['裴玉'] });

  // 维护者清单里的栏目名（含他那张卡的自定义栏目）—— 一个都不许出现
  const fieldLabels = ['名称', '代号', '性别', '年龄', '体型', '面部', '发型', '遮面', '价值观',
    '知识盲区', '核心身份', '性格', '性格调色盘', '外貌', '服饰', '鞋履', '配饰', '气味', '习惯',
    '经历', '语言', '对话示例', '关系描述', '角色阶段', '作息', '变化倾向', '表达方式', '基本信息',
    '青春期', '宿舍', '按摩', '惯于', '补充', '描述', '重点'];
  for (const word of fieldLabels) {
    assert.equal(names(result).includes(word), false, `栏目名「${word}」不许进候选`);
  }

  // 真角色要留下：裴玉（已知名单）+ 代号的值 Lobo（T-438①）+ 关系行里那四个没名字的配角
  assert.deepEqual(names(result), ['裴玉', 'Lobo', '伯伯', '哥哥', '父亲', '母亲'],
    '设定卡该只剩角色：主角 + 代号 Lobo + 关系描述里那几位');
});

// ★ T-438 增量一：`代号：Lobo` 这类"身份字段的值"要当角色名捞回来
await check('★ T-438① 身份字段的值要当角色名（`代号：Lobo` → Lobo）', () => {
  const card = [
    '名称：裴玉',
    '代号：Lobo',
    '英文名：Lobo Wolf',
    '别名：夜莺 / 老K',
    '昵称：小裴董',
  ].join('\n');
  const got = names(extractWorldCast([entry(card)]));
  for (const expect of ['裴玉', 'Lobo', 'Lobo Wolf', '夜莺', '老K', '小裴董']) {
    assert.ok(got.includes(expect), `身份字段的值「${expect}」要捞回来（实际：${got.join('、')}）`);
  }
  assert.equal(names(extractWorldCast([entry('名称：裴玉')])).includes('名称'), false, '栏目名本身仍不许进候选');
});

await check('★ T-438① 非身份字段的值一个都不许捞', () => {
  const result = extractWorldCast([entry('性格：冷酷\n年龄：38\n服饰：黑色风衣\n代号：Lobo')]);
  const got = names(result);
  for (const bad of ['冷酷', '38', '黑色风衣', '性格', '年龄', '服饰']) {
    assert.equal(got.includes(bad), false, `「${bad}」不是角色（实际：${got.join('、')}）`);
  }
  assert.ok(got.includes('Lobo'), '同一份里身份字段的值仍要捞回来');
});

await check('角色小标题 `【裴玉】` / `[裴玉]` / `### 裴玉` 是最直白的信号', () => {
  const result = extractWorldCast([entry('【裴玉】\n他是小裴董。\n\n### 罗德里戈\n另一个主角。')]);
  assert.ok(names(result).includes('裴玉'), '`【名字】` 要认');
  assert.ok(names(result).includes('罗德里戈'), '`### 名字` 要认');
  // `[名字]` 也要认，但 markdown 链接 `[文字](url)` 不算
  assert.ok(names(extractWorldCast([entry('[莉泽] 只在夜里出现。')])).includes('莉泽'));
  assert.deepEqual(names(extractWorldCast([entry('见 [设定文档](https://example.com/x) 的说明。')])), []);
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
  // 管家 = 角色称谓白名单（规则④）命中的 —— `XX的` 删掉之后，靠它把这类"没名字的角色"捞回来
  assert.deepEqual(names(result), ['莉泽', '艾拉', '管家'], '次数多的在前，同次数按谁先出现');

  // 「名字：描述句」是**角色列表**（值长），不是设定卡（值短）—— 40 个都该认出来
  const many = extractWorldCast([
    entry(Array.from({ length: 40 }, (_, i) => `角色${'甲乙丙丁戊己庚辛壬癸'[i % 10]}${i}：他是第 ${i} 个离开村子的人，走的时候只带了一只旧皮箱。`).join('\n')),
  ]);
  assert.equal(many.detected.length, WORLD_CAST_LIMIT, `最多列 ${WORLD_CAST_LIMIT} 个`);
  assert.equal(many.truncated, true, '超出的要能告诉界面"还有 N 个"');
  assert.equal(many.total, 40);
});

await check('★ 角色列表（`名字：描述句`）不能被当成设定卡误杀', () => {
  const list = [
    '艾拉：宅子里最安静的那个，总喜欢躲在角落看书。',
    '莉泽：只在夜里出现，从不和任何人说话。',
    '罗德里戈：名义上的家主，实际上早就不管事了。',
    '管家：管着整栋老宅，规矩比谁都多。',
  ].join('\n');
  const result = extractWorldCast([entry(list)]);
  assert.ok(names(result).includes('艾拉'), '值长的"名字：描述"块要认（值短才是设定卡）');
  assert.ok(names(result).includes('莉泽'));
  assert.ok(names(result).length >= 3, `这一块应该都是角色（实际：${names(result).join('、')}）`);
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
  /** 侧写存在角色卡扩展字段里（T-402）—— 给个内存实现，好断言"到底写进去了没有" */
  const cells = {};
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
    getCharacterField: (key) => cells[key] ?? null,
    writeCharacterField: (key, value) => { cells[key] = JSON.parse(JSON.stringify(value)); },
    // 2026-09-14：模拟**当前角色卡的主世界书**（多人卡的角色就写在这种书里）
    getLorebookSources: () => [{ type: 'character-primary', label: '角色主世界书', names: Object.keys(data) }],
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
  // 2026-09-14：快照按来源分档（current = 当前角色卡的书 / other = 其它世界书）
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  assert.equal(env.api.ui.read().cast.world.current.stale, true, '还没扫过 = 过期');

  await env.api.cast.scanWorld();
  const snapshot = env.api.ui.read().cast.world.current;
  assert.equal(snapshot.stale, false, '扫完就不该再算过期');
  assert.equal(snapshot.scannedCount, 1);
  assert.equal(snapshot.selectedCount, 1);
  assert.ok(snapshot.detected.length >= 2, '快照要带候选清单（界面读这份）');

  const readsAfterFirst = env.reads.length;
  await env.api.cast.scanWorld();
  assert.equal(env.reads.length, readsAfterFirst, '勾选没变 → 走缓存，不重读世界书');

  env.api.ui.saveWorldSelection({ [entryKey('书A', '1')]: true, [entryKey('书B', '1')]: true });
  assert.equal(env.api.ui.read().cast.world.current.stale, true, '改了勾选 → 下次打开人物页要重扫');
  await env.api.cast.scanWorld();
  assert.equal(env.api.ui.read().cast.world.current.selectedCount, 2);
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

await check('T-438②：忽略过的名字不再展示，恢复后回来；主角名忽略无效', async () => {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  await env.api.cast.scanWorld();
  const namesOf = () => env.api.ui.read().cast.world.current.detected.map((item) => item.name);
  assert.ok(namesOf().includes('莉泽'), '先确认它在候选里');

  env.api.cast.ignoreWorldCast('莉泽');
  assert.deepEqual(env.api.cast.blocklist(), ['莉泽'], '进了黑名单');
  assert.equal(namesOf().includes('莉泽'), false, '忽略后不再展示');

  // 主角 / 当前生成者永不被忽略（这里当前生成者是 罗德里戈）
  env.api.cast.ignoreWorldCast('罗德里戈');
  assert.deepEqual(env.api.cast.blocklist(), ['莉泽'], '已知名单不能被忽略');

  env.api.cast.unignoreWorldCast('莉泽');
  assert.deepEqual(env.api.cast.blocklist(), [], '恢复后黑名单清空');
  assert.ok(namesOf().includes('莉泽'), '恢复后候选里又有了（不用重扫，缓存没动）');
});

await check('一条世界书都没勾选时：不报错、扫 0 条', async () => {
  const env = makeEnv({ selection: {} });
  const result = await env.api.cast.scanWorld();
  assert.equal(result.selectedCount, 0);
  assert.equal(result.scannedCount, 0);
  assert.deepEqual(result.detected, []);
  assert.deepEqual(env.reads, [], '没勾选就别去读书');
});

console.log('T-438③/④ 侧写搭车（零额外调用）+ 手填 NPC 进 knownCast');

/** 造一份"侧写 + cast"的模型返回（cast 直接塞进同一份 JSON） */
function profileReply(cast) {
  return {
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            coreDesire: '被需要', fear: '被抛弃', speech: '平缓', attitudeToUser: '温柔',
            conflictStyle: '不动声色', proactivity: '会主动靠近', intimacy: '黏人', taboo: '绝不伤人',
            cast,
          }),
        },
      }],
    }),
  };
}

/** 侧写要真的写进去就得 L2（L1 是"待确认"档，先进队列） */
const AUTOMATION_L2 = {
  outline: 'L1', stageRegen: 'L1', profile: 'L2',
  stanceJudge: 'L2', checkpointJudge: 'L2', consistency: 'L2',
};

function makeProfileEnv() {
  const env = makeEnv({ selection: { [entryKey('书A', '1')]: true } });
  env.store.saveSettings({ connection: { endpoint: 'https://x/v1', model: 'm', apiKey: 'k' }, automation: AUTOMATION_L2 });
  return env;
}

await acheck('T-438③：侧写那次调用顺带拿回 cast —— **调用次数只 +1**', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ''));
    return profileReply([
      { name: '裴玉', aliases: ['Lobo'], confidence: 0.9, evidence: '代号：Lobo' },
      { name: '艾拉', confidence: 0.3, evidence: '只提了一句' },
    ]);
  };
  try {
    const env = makeProfileEnv();
    const before = env.store.get().cost?.callCount ?? 0;
    const result = await env.api.profileApi.regenerate();

    assert.equal(result.ok, true, '侧写要生成成功');
    assert.equal(bodies.length, 1, 'cast 是顺带的 —— 不许出现第二次请求');
    assert.equal((env.store.get().cost?.callCount ?? 0) - before, 1, '累计调用次数只 +1');

    const ai = env.api.ui.read().cast.ai;
    assert.equal(ai.list.length, 2, '两侧候选都进了界面快照');
    assert.deepEqual(ai.list[0], { name: '裴玉', aliases: ['Lobo'], confidence: 0.9, evidence: '代号：Lobo' },
      '主名 + 别名 + 置信度 + 证据 都要留住（别名是花名问题的解法）');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await acheck('T-438③：cast 缺失 / 解析失败**不连坐侧写**（G5 降级）', async () => {
  const originalFetch = globalThis.fetch;
  for (const bad of [undefined, '不是数组', null, [{ v: 1 }, '艾拉']]) {
    globalThis.fetch = async () => profileReply(bad);
    try {
      const env = makeProfileEnv();
      const result = await env.api.profileApi.regenerate();
      assert.equal(result.ok, true, `cast=${JSON.stringify(bad)} 时侧写仍要成功`);
      const written = env.api.profileApi.read().fields;
      assert.ok(String(written.coreDesire ?? '').trim() || String(written.fear ?? '').trim(),
        '侧写字段照常写入');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

await acheck('T-438④：手填的 NPC 进 {{knownCast}}，且没生成侧写时就已进主角名单', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ''));
    return profileReply([{ name: '酒馆老板', aliases: [], confidence: 0.5, evidence: '' }]);
  };
  try {
    const env = makeProfileEnv();
    env.api.cast.add('酒馆老板');
    // 零回归：还没生成侧写，手填的名字就已经直接进主角名单了
    assert.deepEqual(env.store.getSettings().protagonists, [{ id: '', name: '酒馆老板', manual: true }]);

    await env.api.profileApi.regenerate();
    assert.ok(bodies[0].includes('用户另外指定了这些角色'), '提示词那段要在请求里');
    assert.ok(bodies[0].includes('酒馆老板'), '手填的名字要喂进 {{knownCast}}');
    assert.ok(env.api.ui.read().cast.ai.list.some((item) => item.name === '酒馆老板'),
      '手填的名字要能出现在返回的 cast 里（标「手填」）');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\n通过 ${passed} 项`);
