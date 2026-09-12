// T-426 测试：调用合并（JUDGE_COMBINED + 投机搭车 + 分段独立降级）

import assert from 'node:assert/strict';
import { parseDirectorResponse, parseJudgeCombined } from '../src/llm/schemas.js';
import { extractBalanced, extractField, firstJsonObject } from '../src/llm/sections.js';
import { createCombinedJudge, COMBINED_MAX_TOKENS } from '../src/director/judge-combined.js';
import { createReviewService } from '../src/director/review.js';
import { createStageService } from '../src/director/stage.js';
import { createStateStore } from '../src/core/state.js';
import { normalizeStages } from '../src/director/outline.js';
import { PROMPTS } from '../src/llm/prompts.js';

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

const GOOD = `{
  "stance": "accept",
  "confidence": 0.9,
  "judgement": { "status": "partial", "confidence": 0.8, "reason": "沾边了", "recalled": ["fs_1"] },
  "speculation": { "guess": "user 会追问昨晚的事", "keywords": ["昨晚", "为什么"], "injection": "继续逼问" }
}`;

function makeEnv() {
  const meta = {};
  const ctx = {
    getChatState: () => meta,
    saveChatState: () => true,
    getExtensionSettings: () => ({}),
    saveSettings: () => true,
  };
  const store = createStateStore(ctx, 'combined_test');
  const stages = createStageService({ store });
  let current = null;
  const registry = {
    register: (text) => { current = text || null; return true; },
    clear: () => { current = null; return true; },
    getStatus: () => ({ registered: current !== null, length: current?.length ?? 0, text: current ?? '' }),
  };
  stages.load(normalizeStages([
    { title: '询问', goal: '知道想不想去', activity: '问一句', checkpoint: { criteria: 'char 挑明', antiCriteria: 'user 拒绝' }, beats: ['开口'] },
  ]));
  return { store, stages, registry };
}

console.log('T-426 分段解析工具');

await check('extractBalanced：对象 / 数组 / 字符串 / 数字，截断时返回 null', () => {
  assert.deepEqual(extractBalanced('{"a":1}', 0).value, { a: 1 });
  assert.deepEqual(extractBalanced('[1,2]', 0).value, [1, 2]);
  assert.equal(extractBalanced('"hi"', 0).value, 'hi');
  assert.equal(extractBalanced('42,', 0).value, 42);
  assert.equal(extractBalanced('{"a":1', 0).value, null, '没闭合 = 这段降级');
});

await check('extractField：抠字段，含嵌套与转义', () => {
  const text = '{"judgement": {"reason": "带\\"引号\\"的理由", "status": "achieved"}}';
  assert.deepEqual(extractField(text, 'judgement'), { reason: '带"引号"的理由', status: 'achieved' });
  assert.equal(extractField(text, '不在'), null);
  assert.ok(firstJsonObject(`前言 ${'{"a":1}'} 后语`));
});

console.log('T-426 合并解析：三段各自独立');

await check('一份好的输出：三段都拿到', () => {
  const parsed = parseJudgeCombined(GOOD);
  assert.equal(parsed.stance, 'accept');
  assert.equal(parsed.confidence, 0.9);
  assert.equal(parsed.judgement.status, 'partial');
  assert.equal(parsed.judgement.recalled[0], 'fs_1');
  assert.equal(parsed.speculation.guess, 'user 会追问昨晚的事');
  assert.deepEqual(parsed.ok, { stance: true, judgement: true, speculation: true });
});

await check('投机段坏掉 → stance / judgement 照常生效（验收 3）', () => {
  const broken = `{
    "stance": "reject",
    "confidence": 0.85,
    "judgement": { "status": "pending", "confidence": 0.6, "reason": "没碰到", "recalled": [] },
    "speculation": { "guess": "半截就断了`;
  const parsed = parseJudgeCombined(broken);
  assert.equal(parsed.stance, 'reject');
  assert.equal(parsed.judgement.status, 'pending');
  assert.equal(parsed.speculation, null, '坏掉的那段单独降级');
  assert.deepEqual(parsed.ok, { stance: true, judgement: true, speculation: false });
});

await check('判定段坏掉 → stance 与投机照常（不连坐）', () => {
  const broken = `{
    "stance": "accept",
    "confidence": 0.9,
    "judgement": { "status": "achieved", "confidence": ,
    "speculation": { "guess": "user 会靠近", "keywords": ["走近"], "injection": "别急着回应" }
  }`;
  const parsed = parseJudgeCombined(broken);
  assert.equal(parsed.stance, 'accept');
  assert.equal(parsed.judgement, null);
  assert.equal(parsed.speculation.injection, '别急着回应');
});

await check('整份不是 JSON（被截断成半句）→ 三段全 null，但函数不抛', () => {
  const parsed = parseJudgeCombined('{"stance": "acc');
  assert.equal(parsed.stance, null);
  assert.equal(parsed.judgement, null);
  assert.equal(parsed.speculation, null);
  assert.deepEqual(parsed.ok, { stance: false, judgement: false, speculation: false });
});

await check('parseDirectorResponse 支持 judgeCombined 这个 kind', () => {
  const viaKind = parseDirectorResponse(GOOD, 'judgeCombined');
  assert.equal(viaKind.stance, 'accept');
  assert.equal(viaKind.speculation.keywords.length, 2);
});

await check('不在候选里的 stance 值不算数（防模型瞎写）', () => {
  const parsed = parseJudgeCombined('{"stance": "maybe", "confidence": 0.5}');
  assert.equal(parsed.stance, null);
  assert.equal(parsed.ok.stance, false);
});

console.log('T-426 合并服务：一次调用 + 按需要段');

await check('wantJudgement / wantSpeculation 决定要不要那两段', async () => {
  const seen = [];
  const env = makeEnv();
  const service = createCombinedJudge({
    stages: env.stages,
    getConnection: () => ({}),
    client: {
      request: async ({ messages, maxTokens }) => {
        seen.push({ text: messages.map((m) => m.content).join('\n'), maxTokens });
        return GOOD;
      },
    },
  });

  const full = await service.judge({ userMessage: '嗯' });
  assert.equal(full.judgement.status, 'partial');
  assert.equal(full.speculation.injection, '继续逼问');
  assert.equal(seen[0].maxTokens, COMBINED_MAX_TOKENS, '规格 §3：800 → 1200');

  const lean = await service.judge({ userMessage: '嗯', wantJudgement: false, wantSpeculation: false });
  assert.equal(lean.judgement, null, '没要就不采纳');
  assert.equal(lean.speculation, null);
  assert.ok(seen[1].text.includes('不要输出 judgement 字段'), seen[1].text);
  assert.ok(seen[1].text.includes('不要输出 speculation 字段'));
});

await check('调用失败 → stance 降级 accept、judgement 留空（各自降级）', async () => {
  const env = makeEnv();
  const service = createCombinedJudge({
    stages: env.stages,
    getConnection: () => ({}),
    client: { request: async () => { throw new Error('断网'); } },
  });
  const result = await service.judge({ userMessage: '嗯' });
  assert.equal(result.ok, false);
  assert.equal(result.stance, 'accept', 'G5：拿不准就当接受，别卡住');
  assert.equal(result.judgement, null);
  assert.equal(result.speculation, null);
});

console.log('T-426 编排：每轮只发 1 次（规则不命中路径）');

await check('连跑 5 轮 → 判定+投机总共 5 次调用（原来 10~15 次）', async () => {
  const env = makeEnv();
  let calls = 0;
  const combinedJudge = {
    judge: async ({ wantJudgement, wantSpeculation }) => {
      calls += 1;
      const parsed = parseJudgeCombined(GOOD);
      return {
        ok: true,
        stance: parsed.stance,
        confidence: parsed.confidence,
        judgement: wantJudgement ? parsed.judgement : null,
        speculation: wantSpeculation ? parsed.speculation : null,
        ok_sections: parsed.ok,
        raw: GOOD,
      };
    },
  };

  const taken = [];
  const service = createReviewService({
    checkpoint: {
      judge: async () => { calls += 1; return { action: 'hold', reason: '不该走到这里（合并已经带回了 judgement）' }; },
      // 真实服务有这个方法：判定已经在手上，只算放行规则（不发调用）
      fromJudgement: ({ judgement, raw }) => ({ action: 'hold', reason: '合并带回的判定', judgement, raw }),
    },
    combinedJudge,
    // 规则定不了 → 走合并调用
    will: { classify: () => ({ needsLlm: true, stance: null }) },
    speculate: {
      accept: (record) => { taken.push(record); return record; },
      consumeCombined: () => true,
      settle: () => ({ hit: false, speculation: null }),
    },
    stages: env.stages,
    registry: env.registry,
    store: env.store,
    getSettings: () => ({}),
    getContext: () => '最近的对话',
  });

  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.run({ userMessage: `第 ${i} 句`, charMessage: '他看了你一眼' });
  }

  assert.equal(calls, 5, `5 轮应该只发 5 次调用，实际 ${calls}`);
  assert.equal(taken.length, 5, '每轮投机都搭车回来了');
  assert.ok(taken[0].injection, '投机段要带注入文本');
});

await check('规则命中 → 一次合并调用都不发（零成本路径保住）', async () => {
  const env = makeEnv();
  let combined = 0;
  let checkpointCalls = 0;
  const service = createReviewService({
    checkpoint: {
      judge: async () => { checkpointCalls += 1; return { action: 'hold', reason: 'x', judgement: { status: 'pending', confidence: 0.9 } }; },
    },
    combinedJudge: { judge: async () => { combined += 1; return { ok: true, stance: 'accept', confidence: 0.9, judgement: null, speculation: null, ok_sections: {}, raw: '' }; } },
    will: { classify: () => ({ needsLlm: false, stance: 'accept', confidence: 0.95 }) },
    stages: env.stages,
    registry: env.registry,
    store: env.store,
    getSettings: () => ({}),
  });

  await service.run({ userMessage: '好啊，走吧' });
  assert.equal(combined, 0, '规则够准就不该发合并调用');
  assert.equal(checkpointCalls, 1, '只需单独跑一次推进点判定');
});

console.log('T-426 prompt 与判定口径');

await check('合并模板包含三段口径，且与单条模板同源', () => {
  const system = PROMPTS.JUDGE_COMBINED.system;
  assert.ok(system.includes(PROMPTS.JUDGE_STANCE.system), 'stance 口径与单条版逐字一致');
  assert.ok(system.includes(PROMPTS.JUDGE_CHECKPOINT.system), 'judgement 口径与单条版逐字一致');
  assert.ok(system.includes('"speculation"'));
  assert.ok(PROMPTS.JUDGE_COMBINED.user.includes('{{context}}'), 'P1-4 的上下文也加在合并模板上');
  assert.ok(PROMPTS.JUDGE_COMBINED.user.includes('{{asks}}'));
});

console.log(`\n通过 ${passed} 项`);
