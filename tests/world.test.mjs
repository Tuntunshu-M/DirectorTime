// T-401 测试：世界书来源枚举、勾选筛选、搜索、prompt 文本拼装

import assert from 'node:assert/strict';
import { createLorebookService, normalizeEntry, entryKey } from '../src/world/lorebook.js';

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

console.log('T-401 世界书');

await check('条目字段兼容三套命名', () => {
  const a = normalizeEntry({ uid: 7, comment: '老板娘', text: '独眼' }, 0, '酒馆');
  assert.equal(a.id, '7');
  assert.equal(a.name, '老板娘');
  assert.equal(a.content, '独眼');
  assert.equal(a.key, entryKey('酒馆', '7'));

  const b = normalizeEntry({ keys: ['甲', '乙'], content: '丙' }, 3, '书');
  assert.equal(b.id, '3', '缺 id 时用下标兜底');
  assert.equal(b.name, '甲, 乙', 'keys 兜底');
  assert.equal(b.content, '丙');
});

await check('启用状态：disable → 禁用，constant → 常驻', () => {
  assert.equal(normalizeEntry({ content: 'x' }, 0, 'B').enabled, true);
  assert.equal(normalizeEntry({ disable: true, content: 'x' }, 0, 'B').enabled, false);
  assert.equal(normalizeEntry({ constant: true, content: 'x' }, 0, 'B').constant, true);
});

await check('只有勾选的条目进入 {{world}} 文本', () => {
  const service = createLorebookService({});
  const sources = [{
    type: 'global',
    label: '全局',
    books: [{
      name: '酒馆',
      entries: [
        { id: '1', key: entryKey('酒馆', '1'), name: '老板娘', content: '独眼' },
        { id: '2', key: entryKey('酒馆', '2'), name: '情报网', content: '地下' },
      ],
    }],
  }];
  const picked = service.pick(sources, { [entryKey('酒馆', '1')]: true });
  assert.equal(picked.length, 1);
  const text = service.buildText(picked);
  assert.ok(text.includes('【酒馆】老板娘：独眼'));
  assert.ok(!text.includes('情报网'));
});

await check('条数上限生效（默认 20，可传 limit）', () => {
  const service = createLorebookService({});
  const entries = Array.from({ length: 5 }, (_, i) => ({ bookName: 'B', name: `n${i}`, content: 'c' }));
  const text = service.buildText(entries, { limit: 2 });
  assert.equal(text.split('\n').length, 2);
  assert.ok(text.includes('n0') && text.includes('n1'));
  assert.ok(!text.includes('n2'));
  assert.equal(service.buildText(entries).split('\n').length, 5);
});

await check('搜索：命中书名时该书条目全留', () => {
  const service = createLorebookService({});
  const sources = [{
    type: 'global',
    label: '全局',
    books: [
      { name: '酒馆日常', entries: [{ name: 'a', content: 'x' }, { name: 'b', content: 'y' }] },
      { name: '别的书', entries: [{ name: 'c', content: 'z' }] },
    ],
  }];
  const books = service.search(sources, '酒馆').map((source) => source.books).flat();
  assert.equal(books.find((book) => book.name === '酒馆日常').entries.length, 2);
  assert.equal(books.find((book) => book.name === '别的书').entries.length, 0);
});

await check('搜索：命中条目内容', () => {
  const service = createLorebookService({});
  const sources = [{
    type: 'global',
    label: '全局',
    books: [{ name: 'B', entries: [{ name: 'a', content: 'x' }, { name: 'b', content: '左撇子' }] }],
  }];
  const books = service.search(sources, '左撇').map((source) => source.books).flat();
  assert.deepEqual(books[0].entries.map((entry) => entry.name), ['b']);
});

console.log('T-434 · 懒加载（展开哪本才读哪本）');

/** 造一个"读哪本记哪本"的 host */
function makeLazyCtx() {
  const reads = [];
  const ctx = {
    getLorebookSources: () => [
      { type: 'global', label: '全局世界书', names: ['好书', '坏书', '闲书'] },
      { type: 'character-embedded', label: '角色卡内嵌', names: [], embedded: true },
    ],
    loadWorldInfoBook: async (name) => {
      reads.push(name);
      if (name === '坏书') throw new Error('加载失败');
      return { entries: [{ uid: 1, comment: `${name}条`, text: '独眼' }] };
    },
    getCharacterBookEntries: () => [{ uid: 9, comment: '童年', text: '创伤' }],
  };
  return { ctx, reads };
}

await check('collect：不读任何书（只给书名 + lazy），内嵌书直接给', () => {
  const { ctx, reads } = makeLazyCtx();
  const service = createLorebookService({ ctx });
  const sources = service.collect();

  assert.equal(reads.length, 0, 'collect 一次都不该读');
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0].books.map((book) => book.name), ['好书', '坏书', '闲书']);
  assert.equal(sources[0].books[0].lazy, true);
  assert.deepEqual(sources[0].books[0].entries, []);
  assert.equal(sources[1].books[0].entries[0].name, '童年', '内嵌书不花请求，直接给');
});

await check('loadBook：按需读一本、读过的进缓存（一本只读一次），collect 之后带上条目', async () => {
  const { ctx, reads } = makeLazyCtx();
  const service = createLorebookService({ ctx });

  const book = await service.loadBook('好书');
  assert.equal(book.entries[0].name, '好书条');
  assert.equal(book.entries[0].key, entryKey('好书', '1'));
  await service.loadBook('好书');
  assert.deepEqual(reads, ['好书'], '第二遍走缓存');

  const sources = service.collect();
  assert.equal(sources[0].books[0].loaded, true);
  assert.equal(sources[0].books[0].entries[0].name, '好书条');
  assert.equal(sources[0].books[1].lazy, true, '没读过的还是 lazy');
});

await check('读失败只记录、不中断，也不反复重试', async () => {
  const { ctx, reads } = makeLazyCtx();
  const service = createLorebookService({ ctx });

  const book = await service.loadBook('坏书');
  assert.equal(book.error, '加载失败');
  assert.deepEqual(book.entries, []);
  await service.loadBook('坏书');
  assert.deepEqual(reads, ['坏书'], '失败结果也缓存，别每次点都重试');
});

await check('pickSelected：**只读有勾选的那些书**（未勾的一本都不读）', async () => {
  const { ctx, reads } = makeLazyCtx();
  const service = createLorebookService({ ctx });
  const sources = service.collect();

  const picked = await service.pickSelected(sources, { [entryKey('好书', '1')]: true });
  assert.deepEqual(reads, ['好书'], '只读了勾选的那本');
  assert.equal(picked.length, 1);
  assert.equal(picked[0].bookName, '好书');
  assert.equal(picked[0].sourceLabel, '全局世界书');
});

await check('pickSelected：勾了没读过的书 → 为它去读（注入不能少东西）', async () => {
  const { ctx, reads } = makeLazyCtx();
  const service = createLorebookService({ ctx });
  const sources = service.collect();

  const picked = await service.pickSelected(sources, { [entryKey('闲书', '1')]: true, [entryKey('坏书', '1')]: true });
  assert.deepEqual(reads, ['坏书', '闲书'], '按来源里书的顺序读，且只读勾过的');
  assert.deepEqual(picked.map((entry) => entry.bookName), ['闲书'], '读失败的那本不产出条目');
});

await check('pickSelected：一条没勾 → 一本都不读', async () => {
  const { ctx, reads } = makeLazyCtx();
  const service = createLorebookService({ ctx });
  assert.deepEqual(await service.pickSelected(service.collect(), {}), []);
  assert.deepEqual(reads, []);
});

await check('forget：丢掉缓存（界面点「刷新」= 重新读）', async () => {
  const { ctx, reads } = makeLazyCtx();
  const service = createLorebookService({ ctx });
  await service.loadBook('好书');
  service.forget();
  await service.loadBook('好书');
  assert.deepEqual(reads, ['好书', '好书']);
  assert.equal(service.collect()[0].books[0].loaded, true, '重读后 collect 又带上条目');
});

console.log(`\n通过 ${passed} 项`);
