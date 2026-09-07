// T-201 客户端测试：多格式兼容 / 脱敏 / 截断识别 / 超时 / 模型列表
// 用 stub fetch 验证解析与错误处理逻辑（不涉及真实网络）。

import assert from 'node:assert/strict';
import { createDirectorClient, extractResponseContent, redact } from '../src/llm/client.js';

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

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

const BASE = { endpoint: 'https://api.example.com/v1', apiKey: 'sk-super-secret', model: 'm' };
const MESSAGES = [{ role: 'user', content: 'hi' }];

console.log('T-201 导演 API 客户端');

await check('解析 OpenAI 格式', async () => {
  const client = createDirectorClient({ fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '你好' } }] }) });
  assert.equal(await client.request({ ...BASE, messages: MESSAGES }), '你好');
});

await check('解析流式 delta 格式', async () => {
  const client = createDirectorClient({ fetchImpl: async () => jsonResponse({ choices: [{ delta: { content: '流式' } }] }) });
  assert.equal(await client.request({ ...BASE, messages: MESSAGES }), '流式');
});

await check('解析 output_text（Responses 风格）', async () => {
  const client = createDirectorClient({ fetchImpl: async () => jsonResponse({ output_text: '响应' }) });
  assert.equal(await client.request({ ...BASE, messages: MESSAGES }), '响应');
});

await check('解析 Claude 风格 content', async () => {
  const client = createDirectorClient({ fetchImpl: async () => jsonResponse({ content: [{ text: '克劳德' }] }) });
  assert.equal(await client.request({ ...BASE, messages: MESSAGES }), '克劳德');
});

await check('递归解析 result 包装层', async () => {
  const client = createDirectorClient({ fetchImpl: async () => jsonResponse({ result: { choices: [{ message: { content: '包一层' } }] } }) });
  assert.equal(await client.request({ ...BASE, messages: MESSAGES }), '包一层');
});

await check('finish_reason=length 识别为截断错误', async () => {
  const client = createDirectorClient({
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: 'x' }, finish_reason: 'length' }] }),
  });
  await assert.rejects(
    () => client.request({ ...BASE, messages: MESSAGES }),
    (error) => error.name === 'DirectorTruncationError'
  );
});

await check('空内容报 DirectorEmptyError', async () => {
  const client = createDirectorClient({ fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '' } }] }) });
  await assert.rejects(
    () => client.request({ ...BASE, messages: MESSAGES }),
    (error) => error.name === 'DirectorEmptyError'
  );
});

await check('HTTP 错误里不含密钥与端点', async () => {
  const client = createDirectorClient({
    fetchImpl: async () => jsonResponse({ error: 'bad key sk-super-secret at api.example.com' }, { ok: false, status: 401 }),
  });
  await assert.rejects(
    () => client.request({ ...BASE, messages: MESSAGES }),
    (error) => {
      assert.ok(!error.message.includes('sk-super-secret'), '消息里不应出现密钥');
      assert.ok(!error.message.includes('api.example.com'), '消息里不应出现端点');
      assert.ok(error.message.includes('[REDACTED]'));
      return true;
    }
  );
});

await check('超时触发 TimeoutError 而非未捕获异常', async () => {
  function slowFetch(_url, options) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse({ choices: [{ message: { content: 'late' } }] })), 200);
      options.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  }
  const client = createDirectorClient({ fetchImpl: slowFetch, timeoutMs: 20 });
  await assert.rejects(
    () => client.request({ ...BASE, messages: MESSAGES }),
    (error) => error.name === 'TimeoutError'
  );
});

await check('缺少端点是配置错误，不发请求', async () => {
  let called = false;
  const client = createDirectorClient({ fetchImpl: async () => { called = true; return jsonResponse({}); } });
  await assert.rejects(
    () => client.request({ model: 'm', messages: MESSAGES }),
    (error) => error.name === 'DirectorConfigError'
  );
  assert.equal(called, false);
});

await check('listModels 返回模型 id 列表', async () => {
  const client = createDirectorClient({ fetchImpl: async () => jsonResponse({ data: [{ id: 'a' }, { id: 'b' }] }) });
  assert.deepEqual(await client.listModels(BASE), ['a', 'b']);
});

await check('testConnection 成功返回 ok', async () => {
  const client = createDirectorClient({ fetchImpl: async () => jsonResponse({ data: [{ id: 'a' }] }) });
  const result = await client.testConnection(BASE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, ['a']);
});

await check('extractResponseContent 对未知结构返回 undefined', () => {
  assert.equal(extractResponseContent({ weird: 1 }), undefined);
});

await check('redact 替换所有出现的密钥', () => {
  assert.equal(redact('key sk-1 and sk-1', ['sk-1']), 'key [REDACTED] and [REDACTED]');
});

console.log(`\n通过 ${passed} 项`);
