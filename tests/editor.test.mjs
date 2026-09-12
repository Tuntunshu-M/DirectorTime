// T-404 测试：剧本编辑器（增删改 / 复制 / 排序 / 锁定 / 快照往返无损 / 截断）

import assert from 'node:assert/strict';
import { createEditorService, blankOutline, blankStage, repairInvariant } from '../src/director/editor.js';
import { createStateStore } from '../src/core/state.js';
import { normalizeStages } from '../src/director/outline.js';
import { createStageService } from '../src/director/stage.js';
import { buildInstruction } from '../src/inject/instruction.js';

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

function makeEnv(stages) {
  const settingsStore = {};
  const ctx = {
    getChatState: () => ({}),
    saveChatState: () => true,
    getExtensionSettings: () => settingsStore,
    saveSettings: () => true,
  };
  const store = createStateStore(ctx, 'dt');
  if (stages) {
    store.update((draft) => ({
      ...draft,
      outline: { title: 'T', objective: 'O', foreshadows: [] },
      stages,
      activeStageId: stages.find((s) => s.status === 'active')?.id ?? null,
    }));
  }
  return { store, stages: createStageService({ store }) };
}

const threeStages = () => normalizeStages([
  { title: '第一场', goal: 'g1', checkpoint: { criteria: 'c1', antiCriteria: 'a1' } },
  { title: '第二场', goal: 'g2', checkpoint: { criteria: 'c2', antiCriteria: 'a2' } },
  { title: '第三场', goal: 'g3', checkpoint: { criteria: 'c3', antiCriteria: 'a3' } },
]);

const countActive = (store) => store.get().stages.filter((s) => s.status === 'active' || s.status === 'ready').length;

console.log('T-404 剧本编辑器 · 基础');

check('空白剧本 / 空白阶段：字段一次补齐（不漏 notes / locked）', () => {
  const outline = blankOutline();
  assert.equal(outline.objective, '');
  const stage = blankStage('新场');
  for (const key of ['id', 'title', 'goal', 'activity', 'checkpoint', 'beats', 'notes', 'locked', 'status', 'turnCount']) {
    assert.ok(key in stage, `缺字段 ${key}`);
  }
  assert.equal(stage.status, 'pending');
  assert.equal(stage.notes, '');
});

check('插空阶段 / 复制 / 删除 / 排序：序号每次都重排', () => {
  const env = makeEnv(threeStages());
  const editor = createEditorService({ store: env.store });

  editor.addStage(0, { title: '插进来的' });
  assert.deepEqual(env.store.get().stages.map((s) => s.title), ['第一场', '插进来的', '第二场', '第三场']);
  assert.deepEqual(env.store.get().stages.map((s) => s.index), [1, 2, 3, 4]);

  const secondId = env.store.get().stages[2].id;
  editor.duplicateStage(secondId);
  const titles = env.store.get().stages.map((s) => s.title);
  assert.deepEqual(titles, ['第一场', '插进来的', '第二场', '第二场（副本）', '第三场']);

  const copyId = env.store.get().stages[3].id;
  editor.removeStage(copyId);
  assert.equal(env.store.get().stages.length, 4);

  editor.moveStage(3, 0);
  assert.deepEqual(env.store.get().stages.map((s) => s.title), ['第三场', '第一场', '插进来的', '第二场']);
});

check('删掉 active 阶段：后面那个顶上（不变量：最多一个 active）', () => {
  const env = makeEnv(threeStages());
  const editor = createEditorService({ store: env.store });
  const activeId = env.store.get().activeStageId;

  editor.removeStage(activeId);
  assert.equal(env.store.get().stages.length, 2);
  assert.equal(countActive(env.store), 1, '要有一个顶上');
  assert.equal(env.store.get().stages[0].title, '第二场');
  assert.equal(env.store.get().stages[0].status, 'active');
  assert.equal(env.store.get().activeStageId, env.store.get().stages[0].id);
});

check('修不变量：多个 active → 只留一个；指空 → 从后面挑一个', () => {
  const broken = normalizeStages([
    { title: 'A', checkpoint: {} },
    { title: 'B', checkpoint: {} },
    { title: 'C', checkpoint: {} },
  ]).map((stage) => ({ ...stage, status: 'active' }));

  const fixed = repairInvariant(broken, broken[1].id, 1);
  assert.equal(fixed.stages.filter((s) => s.status === 'active').length, 1);
  assert.equal(fixed.activeStageId, broken[1].id);

  const none = broken.map((stage) => ({ ...stage, status: 'pending' }));
  const picked = repairInvariant(none, '不存在', 1);
  assert.equal(picked.activeStageId, none[1].id, '从原位置往后挑第一个还活着的');
});

console.log('T-404 剧本编辑器 · 字段与锁定');

check('手改字段：即使锁着也生效（用户显式优先于 AI）', () => {
  const env = makeEnv(threeStages());
  const editor = createEditorService({ store: env.store });
  const id = env.store.get().stages[0].id;

  editor.setLocked(id, true);
  editor.updateStage(id, { goal: '用户自己写的目标' });
  assert.equal(env.store.get().stages[0].goal, '用户自己写的目标');
  assert.equal(env.store.get().stages[0].locked, true);
  assert.ok(env.store.get().stages[0].aiOriginal, '要留一份 AI 原稿');
});

check('附注（notes）会作为「本场附注」进注入', () => {
  const env = makeEnv(threeStages());
  const editor = createEditorService({ store: env.store });
  const id = env.store.get().stages[0].id;
  editor.updateStage(id, { notes: '这里要写得更克制' });

  const text = buildInstruction({ stage: env.store.get().stages[0], outline: env.store.get().outline });
  assert.ok(text.includes('（本场附注：这里要写得更克制）'), text);
});

console.log('T-404 剧本编辑器 · 快照（导出导入往返无损）');

check('往返无损：导出 → 导入 → 再导出，两次完全一致', () => {
  const env = makeEnv(threeStages());
  const editor = createEditorService({ store: env.store });
  const id = env.store.get().stages[0].id;

  // 弄点差异出来：锁定 / 附注 / 计数 / 手改
  editor.setLocked(env.store.get().stages[1].id, true);
  editor.updateStage(id, { notes: '手写附注', turnCount: 4, stuckCount: 2 });
  env.stages.setStatus(env.store.get().stages[0].id, 'ready');

  const before = editor.exportJson();
  const result = editor.importJson(before);
  assert.equal(result.ok, true, result.error);
  const after = editor.exportJson();
  assert.equal(after, before, '导出导入往返必须无损（含 id / 状态 / 计数 / 锁定）');
  assert.equal(JSON.parse(after).stages[0].notes, '手写附注');
  assert.equal(JSON.parse(after).activeStageId, id);
});

check('导入失败的分支：一个字段都不写（G5）', () => {
  const env = makeEnv(threeStages());
  const editor = createEditorService({ store: env.store });
  const before = editor.exportJson();

  for (const [bad, hint] of [['不是 JSON', 'JSON'], ['{}', 'stages'], ['{"stages":[]}', '阶段']]) {
    const result = editor.importJson(bad);
    assert.equal(result.ok, false, `${bad} 应该失败`);
    assert.ok(result.error.includes(hint), `${bad} 的提示要提到 ${hint}：${result.error}`);
  }
  assert.equal(editor.exportJson(), before, '失败的导入不能改任何东西');
});

check('截断：从当前阶段往后全删（当前保留）', () => {
  const env = makeEnv(threeStages());
  const editor = createEditorService({ store: env.store });
  const activeId = env.store.get().activeStageId;

  editor.truncateAfterCurrent();
  assert.equal(env.store.get().stages.length, 1);
  assert.equal(env.store.get().stages[0].id, activeId);
  assert.equal(countActive(env.store), 1);
});

check('没有剧本时各操作安全返回，不崩', () => {
  const env = makeEnv();
  const editor = createEditorService({ store: env.store });
  assert.equal(editor.removeStage('nope'), null);
  assert.equal(editor.duplicateStage('nope'), null);
  assert.equal(editor.truncateAfterCurrent(), null);
  editor.moveStage(0, 5); // 越界直接不动
  assert.equal(env.store.get().stages.length, 0);
});

console.log(`\n通过 ${passed} 项`);
