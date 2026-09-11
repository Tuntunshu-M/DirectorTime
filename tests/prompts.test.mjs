// T-202 测试：模板渲染 + JSON 解析降级

import assert from 'node:assert/strict';
import { buildMessages, renderTemplate, PROMPTS } from '../src/llm/prompts.js';
import { extractJson, parseDirectorResponse, isValidOutline } from '../src/llm/schemas.js';

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

console.log('T-202 模板与解析');

check('变量替换正常', () => {
  assert.equal(renderTemplate('你好{{name}}', { name: 'HQ' }), '你好HQ');
});

check('支持嵌套路径', () => {
  assert.equal(renderTemplate('{{a.b}}', { a: { b: '深层' } }), '深层');
});

check('缺失变量渲染为空，不抛错', () => {
  assert.equal(renderTemplate('a{{x}}b', {}), 'ab');
});

check('所有模板都能组装出 system + user', () => {
  for (const name of Object.keys(PROMPTS)) {
    const messages = buildMessages(name, { goal: 'g' });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    assert.ok(messages[0].content.length > 20);
  }
});

check('未知模板名报错', () => {
  assert.throws(() => buildMessages('NOPE'), /未知的 prompt 模板/);
});

check('GEN_OUTLINE 强调意图级与 antiCriteria 必填', () => {
  const text = PROMPTS.GEN_OUTLINE.system;
  assert.ok(text.includes('意图级'), '必须写意图级约束');
  assert.ok(text.includes('antiCriteria'), '必须要求 antiCriteria');
  assert.ok(text.includes('卡死'), '必须说明写错的后果');
});

check('JUDGE_CHECKPOINT 要求按意图判定且低 confidence', () => {
  const text = PROMPTS.JUDGE_CHECKPOINT.system;
  assert.ok(text.includes('按意图判断'), '必须强调意图判定');
  assert.ok(text.includes('不确定就给低值'), '必须说明低 confidence 的处理');
  assert.ok(text.includes('violated'));
});

console.log('解析降级（禁则 G5）');

check('纯 JSON 正常解析', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

check('markdown 代码块可解析', () => {
  const text = '好的：\n```json\n{"a":1}\n```\n就这样';
  assert.deepEqual(extractJson(text), { a: 1 });
});

check('前后夹带废话可解析', () => {
  assert.deepEqual(extractJson('我觉得应该是 {"a":1} 这样'), { a: 1 });
});

check('截断的 JSON 返回 null', () => {
  assert.equal(extractJson('{"a":1'), null);
});

check('空字符串返回 null', () => {
  assert.equal(extractJson('   '), null);
});

check('非对象输入返回 null 而不抛异常', () => {
  assert.equal(extractJson(undefined), null);
  assert.equal(extractJson(123), null);
});

check('缺少 antiCriteria 的大纲判为非法', () => {
  const bad = {
    title: '旅行',
    stages: [{ goal: '确定目的地', checkpoint: { criteria: 'user 同意' } }],
  };
  assert.equal(isValidOutline(bad), false);
});

check('合法大纲通过校验', () => {
  const good = {
    objective: '和 user 一起去 D 市',
    title: '旅行',
    premise: '去 D 市',
    stages: [
      {
        title: '询问',
        goal: '知道想不想去',
        activity: '饭桌上问',
        checkpoint: { criteria: 'user 同意出行', antiCriteria: 'user 明确不想出门' },
        beats: ['做饭', '开口问'],
      },
    ],
  };
  assert.equal(isValidOutline(good), true);
});

check('缺少 objective 的大纲判为非法（T-416）', () => {
  const noObjective = {
    title: '旅行',
    stages: [{ goal: 'g', checkpoint: { criteria: 'c', antiCriteria: 'a' } }],
  };
  assert.equal(isValidOutline(noObjective), false);
  assert.equal(parseDirectorResponse(JSON.stringify(noObjective), 'outline'), null);
});

check('parseDirectorResponse 对非法内容返回 null', () => {
  assert.equal(parseDirectorResponse('这不是 JSON', 'outline'), null);
  assert.equal(parseDirectorResponse('{"status":"瞎写"}', 'judgement'), null);
});

check('parseDirectorResponse 正常返回数据', () => {
  const data = parseDirectorResponse('{"status":"achieved","confidence":0.9}', 'judgement');
  assert.equal(data.status, 'achieved');
});

check('parseDirectorResponse 支持 beats 与 stages（T-205④ / 续写）', () => {
  assert.deepEqual(parseDirectorResponse('{"beats":["a","b"]}', 'beats').beats, ['a', 'b']);
  assert.equal(parseDirectorResponse('{"beats":[]}', 'beats'), null, '空 beats 判非法');
  assert.equal(parseDirectorResponse('{"beats":[" "]}/x', 'beats'), null, '空白 beat 判非法');
  const stages = parseDirectorResponse('{"stages":[{"goal":"g","checkpoint":{"criteria":"c","antiCriteria":"a"}}]}', 'stages');
  assert.equal(stages.stages.length, 1);
  assert.equal(parseDirectorResponse('{"stages":[]}', 'stages'), null);
});

console.log(`\n通过 ${passed} 项`);
