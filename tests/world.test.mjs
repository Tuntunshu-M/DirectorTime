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

await check('collect 枚举来源；单本书加载失败只记录、不中断', async () => {
  const ctx = {
    getLorebookSources: () => [
      { type: 'global', label: '全局世界书', names: ['好书', '坏书'] },
      { type: 'character-embedded', label: '角色卡内嵌', names: [], embedded: true },
    ],
    loadWorldInfoBook: async (name) => {
      if (name === '坏书') throw new Error('加载失败');
      return { entries: [{ uid: 1, comment: '老板娘', text: '独眼' }] };
    },
    getCharacterBookEntries: () => [{ uid: 9, comment: '童年', text: '创伤' }],
  };
  const service = createLorebookService({ ctx });
  const sources = await service.collect();

  assert.equal(sources.length, 2);
  assert.equal(sources[0].books[0].entries[0].name, '老板娘');
  assert.equal(sources[0].books[0].entries[0].key, entryKey('好书', '1'));
  assert.equal(sources[0].books[1].error, '加载失败');
  assert.deepEqual(sources[0].books[1].entries, []);
  assert.equal(sources[1].books[0].entries[0].name, '童年');
});

console.log(`\n通过 ${passed} 项`);
