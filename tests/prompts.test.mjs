// T-202 测试：模板渲染 + JSON 解析降级

import assert from 'node:assert/strict';
import { buildMessages, renderTemplate, PROMPTS, PERSONA_RESPECT } from '../src/llm/prompts.js';
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

console.log('T-424 A · 模板层人设尊重（恒开）');

await check('GEN_OUTLINE / EXTEND_OUTLINE / GEN_PROFILE 都带上「符合人设」那句', () => {
  for (const key of ['GEN_OUTLINE', 'EXTEND_OUTLINE', 'GEN_PROFILE']) {
    const system = PROMPTS[key].system;
    assert.ok(system.includes(PERSONA_RESPECT), `${key} 缺人设尊重段`);
    assert.ok(system.includes('必须符合角色既有性格'), key);
    assert.ok(system.includes('不必热情外放'), key);
  }
});

await check('渲染出来的请求里也能看到（不是只写在常量里）', () => {
  const messages = buildMessages('GEN_PROFILE', { char: '卡', world: '', context: '' });
  assert.ok(messages[0].content.includes('必须符合角色既有性格'));
});

await check('GEN_INITIATIVE 带 intensityNote 变量（克制档降调用）', () => {
  assert.ok(PROMPTS.GEN_INITIATIVE.user.includes('{{intensityNote}}'));
  const messages = buildMessages('GEN_INITIATIVE', {
    profile: '', goal: 'g', activity: 'a', beats: 'b', intensityNote: '（注意：这个角色内敛）',
  });
  assert.ok(messages[1].content.includes('这个角色内敛'));
});

console.log('T-427 · 条件块 + 重生成带上驳回原因（首轮零回归）');

/** 独立实现：按行把条件块整段删掉（与被测实现用不同机制，用来钉住"零回归"） */
function stripBlockByLines(template, key) {
  const lines = String(template).split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === `{{#${key}}}`) { inside = true; continue; }
    if (line.trim() === `{{/${key}}}`) { inside = false; continue; }
    if (!inside) out.push(line);
  }
  return out.join('\n');
}

const GEN_VARS = {
  premise: 'p', objective: 'o', protagonists: '主角', hardLimits: '无禁忌', tone: '冷',
  profile: '侧写文本', world: '世界书文本', foreshadows: '无', context: '近期对话',
};

check('条件块：键为空 → 整块连它那一行一起消失（不留空行）', () => {
  assert.equal(renderTemplate('a\n{{#note}}\n内容\n{{/note}}\nb', {}), 'a\nb');
  assert.equal(renderTemplate('a\n{{#note}}\n内容\n{{/note}}\nb', { note: '   ' }), 'a\nb', '纯空白也算空');
  assert.equal(renderTemplate('a\n{{#note}}\n内容\n{{/note}}\nb', { note: '' }), 'a\nb', '空串也算空');
});

check('条件块：有值 → 标记行消失、内容行原地保留（不多空行、不少内容）', () => {
  assert.equal(
    renderTemplate('a\n{{#note}}\n原因：{{note}}\n{{/note}}\nb', { note: '太热情' }),
    'a\n原因：太热情\nb',
  );
});

check('条件块：文件首尾也能用；相邻两块互不影响；没闭合就原样保留', () => {
  assert.equal(renderTemplate('{{#x}}\n正文\n{{/x}}\n尾', {}), '尾');
  assert.equal(renderTemplate('{{#x}}\n正文\n{{/x}}\n尾', { x: 1 }), '正文\n尾');
  // 相邻两块：一个空一个有值
  assert.equal(
    renderTemplate('A\n{{#x}}\nX\n{{/x}}\n{{#y}}\nY\n{{/y}}\nB', { y: 1 }),
    'A\nY\nB',
  );
  // 没闭合标记 → 原样保留（不静默吞内容）
  assert.equal(renderTemplate('A\n{{#x}}\nX\nB', { x: 1 }), 'A\n{{#x}}\nX\nB');
});

check('首轮零回归：不带 rejectReason 时，渲染结果与"把块整段删掉"逐字一致', () => {
  for (const name of ['GEN_OUTLINE', 'EXTEND_OUTLINE']) {
    const rendered = renderTemplate(PROMPTS[name].user, GEN_VARS);
    const golden = stripBlockByLines(PROMPTS[name].user, 'rejectReason');
    assert.equal(rendered, renderTemplate(golden, GEN_VARS), `${name}：与删掉块的原文不一致（多/少了空行）`);
    assert.equal(
      rendered.split('\n').length,
      golden.split('\n').length,
      `${name}：行数变了，说明留了空行`,
    );
    assert.ok(!rendered.includes('上一版被判定为不符合人设'), `${name}：首轮不该出现驳回原因段`);
    assert.ok(!rendered.includes('{{'), `${name}：不能留下未替换的占位符`);
  }
});

check('重生成：rejectReason 有值 → 请求里能看到原因原文与"必须避开"要求', () => {
  for (const name of ['GEN_OUTLINE', 'EXTEND_OUTLINE']) {
    const rendered = renderTemplate(PROMPTS[name].user, { ...GEN_VARS, rejectReason: '他太热情外放了，不像内敛角色' });
    assert.ok(rendered.includes('上一版被判定为不符合人设，原因是：他太热情外放了，不像内敛角色。'), name);
    assert.ok(rendered.includes('这一版必须避开这个具体问题'), name);
    assert.ok(rendered.includes('其它要求（主目标 / 剧情占比 / 硬禁区 / 演员界定）一律不变'), name);
    assert.ok(!rendered.includes('{{'), `${name}：不能留下未替换的占位符`);
  }
});

check('两次驳回：拼成两行一起带上（最新那条必含）', () => {
  const rendered = renderTemplate(PROMPTS.GEN_OUTLINE.user, { ...GEN_VARS, rejectReason: '第一条原因\n第二条原因' });
  assert.ok(rendered.includes('第一条原因\n第二条原因'), rendered.slice(0, 300));
});

check('两条模板都带着这段（不然规格只做一半）', () => {
  assert.ok(PROMPTS.GEN_OUTLINE.user.includes('{{#rejectReason}}'));
  assert.ok(PROMPTS.EXTEND_OUTLINE.user.includes('{{#rejectReason}}'));
  assert.ok(PROMPTS.GEN_OUTLINE.user.includes('{{/rejectReason}}'));
  assert.ok(PROMPTS.EXTEND_OUTLINE.user.includes('{{/rejectReason}}'));
});

console.log(`\n通过 ${passed} 项`);
