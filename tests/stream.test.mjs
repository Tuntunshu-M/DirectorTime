// T-431 流式拉取 + 空闲超时（回归保护）
import assert from 'node:assert/strict';
import { createDirectorClient, parseSSE } from '../src/llm/client.js';

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function sseBody(lines) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function jsonBody(payload) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify(payload)));
      controller.close();
    },
  });
}

console.log('T-431 流式 · SSE 解析');

await check('拼 delta.content，[DONE] 收尾', () => {
  const out = parseSSE('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n');
  assert.equal(out.text, '你好');
  assert.equal(out.chunks, 2);
  assert.equal(out.truncation, false);
});

await check('finish_reason: length → 标记为截断', () => {
  const out = parseSSE('data: {"choices":[{"delta":{"content":"半句话"},"finish_reason":"length"}]}\n\n');
  assert.equal(out.truncation, true);
});

await check('不是 SSE（没有 data:）→ chunks 为 0，交给调用方兜底', () => {
  const out = parseSSE('{"choices":[{"message":{"content":"整块 JSON"}}]}');
  assert.equal(out.chunks, 0);
});

await check('单行坏 JSON 不影响其它块', () => {
  const out = parseSSE('data: {坏掉的\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\n');
  assert.equal(out.text, '好');
});

console.log('T-431 流式 · 客户端');

await check('开流式：请求带 stream:true，返回拼接后的文本', async () => {
  let sent = null;
  const client = createDirectorClient({
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return { ok: true, body: sseBody(['data: {"choices":[{"delta":{"content":"剧本"}}]}\n\n', 'data: [DONE]\n\n']) };
    },
    getStream: () => true,
  });
  const text = await client.request({ endpoint: 'https://x.test/v1', model: 'm', messages: [] });
  assert.equal(text, '剧本');
  assert.equal(sent.stream, true);
});

await check('开流式但站子返回整块 JSON → 自动降级，不报错', async () => {
  const client = createDirectorClient({
    fetchImpl: async () => ({ ok: true, body: jsonBody({ choices: [{ message: { content: '整块' } }] }) }),
    getStream: () => true,
  });
  assert.equal(await client.request({ endpoint: 'https://x.test/v1', model: 'm', messages: [] }), '整块');
});

await check('关流式：请求不带 stream，行为与旧版一致', async () => {
  let sent = null;
  const client = createDirectorClient({
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '老办法' } }] }) };
    },
    getStream: () => false,
  });
  assert.equal(await client.request({ endpoint: 'https://x.test/v1', model: 'm', messages: [] }), '老办法');
  assert.equal('stream' in sent, false, '关掉时请求体里不许出现 stream 字段');
});

await check('空闲超时：一直没数据会被掐断并报 TimeoutError', async () => {
  const client = createDirectorClient({
    fetchImpl: async () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, body: sseBody([]) }), 5000)),
    getStream: () => true,
    getTimeoutMs: () => 120,
  });
  await assert.rejects(
    () => client.request({ endpoint: 'https://x.test/v1', model: 'm', messages: [] }),
    (error) => error?.name === 'TimeoutError',
  );
});

console.log(`\n通过 ${passed} 项`);
