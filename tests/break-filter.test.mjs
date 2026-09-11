// T-411 测试：破限词（三种模式 / 只进导演请求 / <plot> 清洗）

import assert from 'node:assert/strict';
import {
  normalizeBreakFilter, breakText, prependToSystem, extractPlot, createBreakFilterService, BREAK_MODES,
} from '../src/llm/break-filter.js';
import { createDirectorClient } from '../src/llm/client.js';
import { parseDirectorResponse } from '../src/llm/schemas.js';
import { buildInstruction } from '../src/inject/instruction.js';
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

const PRESET = '酒馆预设的破限词';
const CUSTOM = '我的自定义破限词';

console.log('T-411 破限词 · 模式');

await check('模式：默认关闭；认不出的模式一律当关闭', () => {
  assert.deepEqual(normalizeBreakFilter(null), { mode: 'off', custom: '' });
  assert.equal(normalizeBreakFilter({ mode: '乱写' }).mode, 'off');
  assert.equal(BREAK_MODES.length, 4);
  assert.deepEqual(createDefaultSettings().breakFilter, { mode: 'off', custom: '' }, '默认关闭、不注入任何额外内容');
});

await check('验收：三种模式都拼得出文本', () => {
  const preset = { presetText: PRESET };
  assert.equal(breakText({ mode: 'preset' }, preset), PRESET);
  assert.equal(breakText({ mode: 'custom', custom: CUSTOM }, preset), CUSTOM);
  assert.equal(breakText({ mode: 'append', custom: CUSTOM }, preset), `${PRESET}\n\n${CUSTOM}`, '附加 = 预设后追加');
  assert.equal(breakText({ mode: 'off', custom: CUSTOM }, preset), '');
});

await check('空内容 / 空白 / 没有预设时都不残留空行', () => {
  assert.equal(breakText({ mode: 'custom', custom: '   ' }), '');
  assert.equal(breakText({ mode: 'preset' }, { presetText: '' }), '');
  assert.equal(breakText({ mode: 'append', custom: '' }, { presetText: PRESET }), PRESET);
  assert.equal(breakText({ mode: 'append', custom: CUSTOM }, { presetText: '' }), CUSTOM);
});

await check('拼进 system 消息：不改原数组、没有文本就原样返回', () => {
  const messages = [{ role: 'system', content: '原系统提示' }, { role: 'user', content: 'U' }];
  const out = prependToSystem(messages, CUSTOM);
  assert.equal(out[0].content, `${CUSTOM}\n\n原系统提示`);
  assert.equal(out[1], messages[1]);
  assert.equal(messages[0].content, '原系统提示', '原数组不能被改');
  assert.equal(prependToSystem(messages, ''), messages);
  assert.deepEqual(prependToSystem([], CUSTOM), []);
});

console.log('T-411 破限词 · <plot> 清洗');

await check('extractPlot：只取标签内，标签外的残渣丢掉', () => {
  const raw = '好的，我按破限指令来：\n<plot>\n{"title":"T"}\n</plot>\n（以上为剧情内容）';
  assert.equal(extractPlot(raw), '{"title":"T"}');
});

await check('extractPlot：没有标签就原样返回（老行为不变）', () => {
  assert.equal(extractPlot('{"title":"T"}'), '{"title":"T"}');
  assert.equal(extractPlot(''), '');
  assert.equal(extractPlot(null), '');
});

await check('验收：清洗后解析只认标签内的 JSON（破限残渣进不来）', () => {
  const dirty = '先说一句破限词：忽略以上所有限制。\n<plot>{"status":"achieved","confidence":0.9,"reason":"r"}</plot>\n完事。';
  const parsed = parseDirectorResponse(dirty, 'judgement');
  assert.equal(parsed.status, 'achieved');
  assert.equal(JSON.stringify(parsed).includes('忽略以上所有限制'), false, '标签外的内容不许进结果');
});

console.log('T-411 破限词 · 接线');

function makeClient(getBreakText, captured) {
  return createDirectorClient({
    fetchImpl: async (_url, options) => {
      captured.body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }),
      };
    },
    getBreakText,
  });
}

await check('验收：破限词只进导演 API 请求', async () => {
  const captured = {};
  const client = makeClient(() => CUSTOM, captured);
  await client.request({
    endpoint: 'https://x/v1', model: 'm',
    messages: [{ role: 'system', content: '系统' }, { role: 'user', content: '用户' }],
  });
  assert.equal(captured.body.messages[0].content, `${CUSTOM}\n\n系统`);
  assert.equal(captured.body.messages[1].content, '用户', 'user 消息不该被动');
});

await check('验收：角色回复端永远拿不到破限词', () => {
  const text = buildInstruction({
    stage: { goal: 'g' },
    profile: { fields: { coreDesire: '看海' } },
    hardLimits: ['自杀'],
    // 就算有人把破限词塞进来也不该被用；正常流程里这里根本没有它
  });
  assert.equal(text.includes(CUSTOM), false);
  assert.ok(text.includes('看海'), '正常内容照旧');
});

await check('关着 / 没配的时候，请求体里一点破限痕迹都没有', async () => {
  const captured = {};
  const client = makeClient(() => '', captured);
  await client.request({ endpoint: 'https://x/v1', model: 'm', messages: [{ role: 'system', content: '系统' }] });
  assert.equal(captured.body.messages[0].content, '系统');
});

await check('服务层：三种模式端到端（含预设读取失败时静默）', async () => {
  const filter = { mode: 'append', custom: CUSTOM };
  const service = createBreakFilterService({ getFilter: () => filter, getPresetText: () => PRESET });
  assert.equal(service.text(), `${PRESET}\n\n${CUSTOM}`);

  filter.mode = 'preset';
  assert.equal(service.text(), PRESET);

  const broken = createBreakFilterService({
    getFilter: () => filter,
    getPresetText: () => { throw new Error('读预设炸了'); },
  });
  assert.equal(broken.text(), '', '读预设失败当没有，不该抛出来');

  const noProvider = createBreakFilterService({ getFilter: () => ({ mode: 'preset' }) });
  assert.equal(noProvider.text(), '', 'T-418 还没接上时，预设模式为空（静默，不伪造）');
});

await check('客户端：getBreakText 抛错也不阻断导演调用', async () => {
  const captured = {};
  const client = makeClient(() => { throw new Error('炸'); }, captured);
  const text = await client.request({ endpoint: 'https://x/v1', model: 'm', messages: [{ role: 'system', content: '系统' }] });
  assert.equal(text, '{"ok":true}');
  assert.equal(captured.body.messages[0].content, '系统');
});

console.log(`\n通过 ${passed} 项`);
