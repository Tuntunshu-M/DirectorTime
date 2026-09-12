// 导演时间 · 导演 API 客户端
//
// T-201。只实现「独立 API」模式。
// 禁则 G1：必须自己 fetch()，禁止调用 ST 的 generateRaw / generate / generateQuietPrompt。
//
// 照搬旧版验证过的四件事：
//   1. 响应格式多兼容（各家站子返回结构五花八门）
//   2. 错误信息脱敏（密钥、端点不进日志）
//   3. finish_reason === 'length' 单独识别为截断
//   4. AbortController 超时

import { prependToSystem } from './break-filter.js';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 2000;

export function createError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

// ---------- 响应解析 ----------

function normalizeContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(normalizeContent).join('');
  if (!value || typeof value !== 'object') return value;
  if (typeof value.text === 'string') return value.text;
  if (typeof value.value === 'string') return value.value;
  return undefined;
}

/**
 * 从任意形状的响应里抠出文本内容。
 * 覆盖 OpenAI / Claude / 各家兼容层，以及 response、result、output 三种包装。
 */
export function extractResponseContent(response) {
  if (typeof response === 'string' || Array.isArray(response)) return normalizeContent(response);
  if (!response || typeof response !== 'object') return response;

  const candidates = [
    response.choices?.[0]?.delta?.content,
    response.choices?.[0]?.message?.content,
    response.choices?.[0]?.text,
    response.output_text,
    response.message?.content,
    response.content,
  ];

  for (const candidate of candidates) {
    const content = normalizeContent(candidate);
    if (content !== undefined) return content;
  }

  for (const wrapper of [response.response, response.result, response.output]) {
    if (wrapper !== undefined) {
      const content = extractResponseContent(wrapper);
      if (content !== undefined) return content;
    }
  }

  return undefined;
}

/** 密钥与端点绝不进错误消息 */
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(String(secret)).join('[REDACTED]');
  }
  return out;
}

function chatCompletionsUrl(endpoint) {
  const base = String(endpoint ?? '').replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function modelsUrl(endpoint) {
  const base = String(endpoint ?? '').replace(/\/+$/, '');
  return base.endsWith('/models') ? base : `${base}/models`;
}

/**
 * 端点可能以多种形态出现在错误文本里（完整 URL / origin / 裸域名），
 * 全部收集，否则脱敏会漏——例如报错里只写了域名。
 */
function hostVariants(endpoint) {
  if (!endpoint) return [];
  const list = [endpoint];
  try {
    const url = new URL(endpoint);
    list.push(url.origin, url.host);
  } catch {
    /* 非法 URL 时只用原值 */
  }
  return list;
}

/**
 * 逐块读完响应体（用于流式）。每来一块就重置"空闲计时器"——
 * 长生成不再被总时长一刀切掐断（T-431）。
 * 环境没有 ReadableStream / TextDecoder 时返回 null，由调用方走老路径。
 */
async function readBodyText(response, onChunk = null) {
  const reader = response?.body?.getReader?.();
  if (!reader || typeof TextDecoder !== 'function') return null;
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (typeof onChunk === 'function') onChunk();
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/**
 * 解析 SSE（text/event-stream）：逐行取 `data:`，拼 delta.content。
 * @returns {{ text: string, chunks: number, truncation: boolean }}
 *   chunks === 0 表示这根本不是流（调用方按普通 JSON 兜底）
 */
export function parseSSE(raw) {
  const pieces = [];
  let truncation = false;
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const json = JSON.parse(data);
      if (json?.choices?.[0]?.finish_reason === 'length') truncation = true;
      const piece = extractResponseContent(json);
      if (typeof piece === 'string' && piece) pieces.push(piece);
    } catch {
      /* 单行坏 JSON 跳过，不影响其它块 */
    }
  }
  return { text: pieces.join(''), chunks: pieces.length, truncation };
}

function authHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

// ---------- 客户端 ----------

export function createDirectorClient({
  onResult = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  // T-411：破限词只在这里加 —— 导演 API 请求的唯一出口，角色回复端拿不到
  getBreakText = null,
  // P0（bugfix 0912 第二波）：调用计数必须挂在**真正发请求**的地方。
  // 以前计数器是个死字段（全仓库没人自增），Debug 永远显示"调用 0 次"。
  onCall = null,
  // T-431：流式开关（默认开，settings.stream 控制）+ 超时改为"空闲超时"
  getStream = null,
  getTimeoutMs = null,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw createError('DirectorConfigError', 'fetch 不可用');
  }

  /**
   * @param {object} options
   * @param {string} options.endpoint
   * @param {string} [options.apiKey]
   * @param {string} options.model
   * @param {Array<{role:string,content:string}>} options.messages
   * @returns {Promise<string>} 模型返回的原始文本
   */
  async function request(options = {}) {
    const { endpoint, apiKey, model, messages, temperature, maxTokens, label = '' } = options;

    if (!endpoint || !model) {
      throw createError('DirectorConfigError', '导演 API 的端点与模型为必填项');
    }

    // 调用日志（调试弹层那张表）：成功失败都记一条，带耗时与 tokens
    const startedAt = Date.now();
    let outcome = { ok: false, error: 'unknown' };
    const record = () => {
      if (typeof onResult !== 'function') return;
      try {
        onResult({ label: label || '未命名调用', ...outcome, at: startedAt, ms: Date.now() - startedAt, model });
      } catch {
        /* 记日志出问题不该影响请求 */
      }
    };

    // T-431：超时 = **空闲超时**（每收到一块数据就续期），不再用总时长一刀切
    const idleMs = Number(options.timeoutMs ?? (typeof getTimeoutMs === 'function' ? getTimeoutMs() : null) ?? timeoutMs)
      || DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), idleMs);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), idleMs);
    };
    const secrets = [apiKey, ...hostVariants(endpoint)].filter(Boolean);
    const useStream = options.stream ?? (typeof getStream === 'function' ? getStream() : false);

    let breakText = '';
    try {
      breakText = typeof getBreakText === 'function' ? String(getBreakText() ?? '') : '';
    } catch {
      breakText = ''; // 破限词出错不该阻断导演调用
    }
    const outgoing = prependToSystem(messages ?? [], breakText);

    // 请求真的发出去了才计数（配置不全 / 没走到这一步的都不算）
    if (typeof onCall === 'function') {
      try {
        onCall({ endpoint, model, label });
      } catch {
        /* 计数出问题不该影响请求 */
      }
    }

    try {
      const response = await fetchImpl(chatCompletionsUrl(endpoint), {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages: outgoing,
          temperature: Number(temperature ?? DEFAULT_TEMPERATURE),
          max_tokens: Number(maxTokens ?? DEFAULT_MAX_TOKENS),
          ...(useStream ? { stream: true } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text?.().catch(() => '');
        throw createError('DirectorHttpError', redact(`导演 API HTTP ${response.status}${detail ? `: ${detail}` : ''}`, secrets));
      }

      // 收到响应头也算一次活动：慢站子建立连接可能就要十几秒
      bump();

      // T-431：流式路径。读不到流 / 不是 SSE → 自动按普通 JSON 兜底，不报错
      if (useStream) {
        const raw = await readBodyText(response, bump);
        if (raw !== null && /data:/.test(raw)) {
          const sse = parseSSE(raw);
          if (sse.chunks > 0) {
            if (sse.truncation) {
              outcome = { ok: false, error: '被截断' };
              throw createError('DirectorTruncationError', '导演 API 输出被截断（finish_reason: length）');
            }
            outcome = { ok: true, tokens: 0, stream: true };
            return sse.text;
          }
        }
        if (raw !== null) {
          // 不是 SSE（站子忽略了 stream 参数）：把整段当 JSON 解析
          let payload = null;
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = null;
          }
          if (payload) {
            if (payload?.choices?.[0]?.finish_reason === 'length') {
              throw createError('DirectorTruncationError', '导演 API 输出被截断（finish_reason: length）');
            }
            const content = extractResponseContent(payload);
            if (content !== undefined && content !== null && content !== '') {
              const usage = payload?.usage ?? null;
              outcome = {
                ok: true,
                tokens: Number(usage?.total_tokens ?? 0)
                  || (Number(usage?.prompt_tokens ?? 0) + Number(usage?.completion_tokens ?? 0))
                  || 0,
                stream: false,
              };
              return content;
            }
            throw createError('DirectorEmptyError', '导演 API 返回空内容');
          }
          // 既不是 SSE 也不是 JSON：退回老办法再读一次（body 已消费，只能报错）
          throw createError('DirectorEmptyError', '导演 API 返回空内容（流式响应解析失败）');
        }
        // 拿不到 reader（老环境）：继续走下面普通路径（body 未被消费）
      }

      const payload = await response.json();

      if (payload?.choices?.[0]?.finish_reason === 'length') {
        throw createError('DirectorTruncationError', '导演 API 输出被截断（finish_reason: length）');
      }

      const content = extractResponseContent(payload);
      if (content === undefined || content === null || content === '') {
        throw createError('DirectorEmptyError', '导演 API 返回空内容');
      }
      const usage = payload?.usage ?? null;
      outcome = {
        ok: true,
        tokens: Number(usage?.total_tokens ?? 0)
          || (Number(usage?.prompt_tokens ?? 0) + Number(usage?.completion_tokens ?? 0))
          || 0,
      };
      return content;
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        outcome = { ok: false, error: '超时' };
        throw createError('TimeoutError', '导演 API 请求超时，请检查连接或增加超时时间。');
      }
      if (['DirectorHttpError', 'DirectorTruncationError', 'DirectorEmptyError', 'DirectorConfigError', 'TimeoutError'].includes(error?.name)) {
        outcome = { ok: false, error: error.name === 'DirectorTruncationError' ? '被截断' : error.name };
        throw error;
      }
      outcome = { ok: false, error: error?.name ?? '请求失败' };
      throw createError(error?.name ?? 'DirectorRequestError', redact(error?.message ?? '导演 API 请求失败', secrets));
    } finally {
      clearTimeout(timer);
      record();
    }
  }

  /** 拉取可用模型列表，用于设置页下拉与连通性测试 */
  async function listModels({ endpoint, apiKey } = {}) {
    if (!endpoint) {
      throw createError('DirectorConfigError', '导演 API 的端点为必填项');
    }
    const secrets = [apiKey, ...hostVariants(endpoint)].filter(Boolean);

    try {
      const response = await fetchImpl(modelsUrl(endpoint), { headers: authHeaders(apiKey) });
      if (!response.ok) {
        throw createError('DirectorHttpError', redact(`导演模型列表 HTTP ${response.status}`, secrets));
      }
      const payload = await response.json();
      return (payload?.data ?? []).map((item) => (typeof item === 'string' ? item : item?.id)).filter(Boolean);
    } catch (error) {
      if (error?.name === 'DirectorHttpError') throw error;
      throw createError('DirectorRequestError', redact(error?.message ?? '获取模型列表失败', secrets));
    }
  }

  /** 连通性测试：能拉到模型列表即视为连通 */
  async function testConnection(connection) {
    const models = await listModels(connection);
    return { ok: true, models };
  }

  return { request, listModels, testConnection };
}
