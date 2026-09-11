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

function authHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

// ---------- 客户端 ----------

export function createDirectorClient({
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  // T-411：破限词只在这里加 —— 导演 API 请求的唯一出口，角色回复端拿不到
  getBreakText = null,
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
    const { endpoint, apiKey, model, messages, temperature, maxTokens } = options;

    if (!endpoint || !model) {
      throw createError('DirectorConfigError', '导演 API 的端点与模型为必填项');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? timeoutMs);
    const secrets = [apiKey, ...hostVariants(endpoint)].filter(Boolean);

    let breakText = '';
    try {
      breakText = typeof getBreakText === 'function' ? String(getBreakText() ?? '') : '';
    } catch {
      breakText = ''; // 破限词出错不该阻断导演调用
    }
    const outgoing = prependToSystem(messages ?? [], breakText);

    try {
      const response = await fetchImpl(chatCompletionsUrl(endpoint), {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages: outgoing,
          temperature: Number(temperature ?? DEFAULT_TEMPERATURE),
          max_tokens: Number(maxTokens ?? DEFAULT_MAX_TOKENS),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text?.().catch(() => '');
        throw createError('DirectorHttpError', redact(`导演 API HTTP ${response.status}${detail ? `: ${detail}` : ''}`, secrets));
      }

      const payload = await response.json();

      if (payload?.choices?.[0]?.finish_reason === 'length') {
        throw createError('DirectorTruncationError', '导演 API 输出被截断（finish_reason: length）');
      }

      const content = extractResponseContent(payload);
      if (content === undefined || content === null || content === '') {
        throw createError('DirectorEmptyError', '导演 API 返回空内容');
      }
      return content;
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        throw createError('TimeoutError', '导演 API 请求超时，请检查连接或增加超时时间。');
      }
      if (['DirectorHttpError', 'DirectorTruncationError', 'DirectorEmptyError', 'DirectorConfigError', 'TimeoutError'].includes(error?.name)) {
        throw error;
      }
      throw createError(error?.name ?? 'DirectorRequestError', redact(error?.message ?? '导演 API 请求失败', secrets));
    } finally {
      clearTimeout(timer);
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
