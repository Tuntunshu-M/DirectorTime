// 导演时间 · 人物侧写（T-402 / M8）
//
// 八字段：核心欲望 / 恐惧 / 说话方式 / 对 user 的态度 / 处理冲突的方式 / 主动程度 / 亲密表达 / 禁忌
//
// 存储：characters[i].data.extensions.director_time —— **与角色绑定、跨聊天复用**，
// 不是每 chat 一份（换聊天不用重新生成，换角色才需要）。
//
// 两条纪律：
//   1. 手改过的字段置 locked，AI 不得覆盖（项目书 §1.4）
//   2. 解析失败一律不写、不注入（禁则 G5）
//
// 字段名注意：侧写的主动程度叫 `proactivity`；`initiative` 是 T-417 每个阶段 char 的主动行为，别混。

import { buildMessages } from '../llm/prompts.js';
import { parseDirectorResponse, normalizeCastList } from '../llm/schemas.js';

export const PROFILE_STORAGE_KEY = 'director_time';

export const PROFILE_FIELDS = [
  'coreDesire', 'fear', 'speech', 'attitudeToUser',
  'conflictStyle', 'proactivity', 'intimacy', 'taboo',
];

export const PROFILE_FIELD_LABELS = {
  coreDesire: '核心欲望',
  fear: '恐惧',
  speech: '说话方式',
  attitudeToUser: '对 user 的态度',
  conflictStyle: '处理冲突的方式',
  proactivity: '主动程度',
  intimacy: '亲密表达方式',
  taboo: '禁忌',
};

export function emptyProfile({ charId = null, charName = '' } = {}) {
  return {
    schemaVersion: 1,
    charId,
    charName,
    fields: Object.fromEntries(PROFILE_FIELDS.map((key) => [key, ''])),
    locked: {},
    source: 'ai',
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 旧数据 / 缺字段一律补默认，保证不崩 */
export function normalizeProfile(raw, { charId = null, charName = '' } = {}) {
  const base = emptyProfile({ charId, charName });
  if (!raw || typeof raw !== 'object') return base;

  const fields = { ...base.fields };
  for (const key of PROFILE_FIELDS) {
    if (typeof raw.fields?.[key] === 'string') fields[key] = raw.fields[key];
  }

  return {
    ...base,
    ...raw,
    charId: raw.charId ?? charId,
    charName: raw.charName || charName,
    fields,
    locked: { ...(raw.locked ?? {}) },
  };
}

/** 侧写 → 一段文本，喂给 GEN_OUTLINE / EXTEND_OUTLINE 的 {{profile}} */
export function profileText(profile) {
  if (!profile?.fields) return '';
  return PROFILE_FIELDS
    .filter((key) => String(profile.fields[key] ?? '').trim())
    .map((key) => `${PROFILE_FIELD_LABELS[key]}：${profile.fields[key]}`)
    .join('\n');
}

export function createProfileService({ ctx, client, getConnection, now = Date.now } = {}) {
  function currentCharId() {
    return ctx?.getCharacterId?.() ?? null;
  }

  function currentCharName() {
    return ctx?.getCharacterData?.()?.name ?? '';
  }

  /** 读当前角色的侧写（按角色绑定，跨聊天复用） */
  function read(charId = null) {
    const raw = ctx?.getCharacterField?.(PROFILE_STORAGE_KEY, charId);
    return normalizeProfile(raw, { charId: charId ?? currentCharId(), charName: currentCharName() });
  }

  function save(profile) {
    const next = {
      ...profile,
      charId: profile?.charId ?? currentCharId(),
      charName: currentCharName() || profile?.charName || '',
      updatedAt: now(),
      createdAt: profile?.createdAt || now(),
    };
    ctx?.writeCharacterField?.(PROFILE_STORAGE_KEY, next, next.charId);
    return next;
  }

  /**
   * 调 GEN_PROFILE；解析失败返回 ok:false，调用方不写不注入（G5）。
   * @param {{world?: string, context?: string, persona?: string}} options
   *   persona：**user 的人设**（2026-09-14 反馈 #2）—— 不带的话模型不知道用户是"讨厌薄荷"的人，
   *   侧写与剧本都可能写出用户明确反感的东西。
   */
  async function generate({ world = '', context = '', persona = '', knownCast = '' } = {}) {
    const card = ctx?.getCharacterData?.() ?? null;
    const charText = [card?.description, card?.personality].filter(Boolean).join('\n') || '（无角色卡）';
    const messages = buildMessages('GEN_PROFILE', {
      char: charText,
      world: world || '（未选世界书）',
      context: context || '（暂无对话）',
      userPersona: String(persona ?? '').trim(),
      // T-438 §4：用户手填/已勾选的名字 —— 让模型把它们也抓进 cast
      knownCast: String(knownCast ?? '').trim() || '（用户没有额外指定）',
    });

    let raw;
    try {
      raw = await client.request({ ...getConnection?.(), messages, label: 'GEN_PROFILE' });
    } catch (error) {
      return { ok: false, code: error?.name ?? 'DirectorRequestError', error: error?.message ?? '导演 API 请求失败' };
    }

    const data = parseDirectorResponse(raw, 'profile');
    if (!data) {
      // 别让用户对着"一片空白"猜：原始返回直接打到控制台
      console.warn('[导演时间] 侧写结果无法解析（需要至少 4 个字段有内容）。原始返回：\n', raw);
      return { ok: false, code: 'PARSE_FAILED', error: '侧写结果无法解析（至少要 4 个字段有内容），未写入；原始返回已打到控制台', raw };
    }

    // 补齐八项：模型没写的按空字符串存，面板上看得见、改得动（P0 修正）
    const fields = Object.fromEntries(
      PROFILE_FIELDS.map((key) => [key, String(data[key] ?? '').trim()])
    );
    /**
     * T-438 §3：顺带回来的候选角色 —— **同一次调用，零额外花费**。
     * 解析失败（模型没给 cast / 给坏了）只影响这一段：`normalizeCastList` 永不抛，
     * 拿不到就是空数组，**侧写照常写入**（G5：不连坐）。
     */
    const cast = normalizeCastList(data.cast);
    if (!cast.length && data.cast !== undefined) {
      console.warn('[导演时间] 侧写里的 cast 解析不出来（按空处理，侧写不受影响）。原值：', data.cast);
    }
    return { ok: true, fields, cast, request: messages };
  }

  /** 生成并写入；**locked 的字段保留旧值**，只重生成未锁定的 */
  async function regenerate({ world = '', context = '', persona = '', knownCast = '' } = {}) {
    const current = read();
    const result = await generate({ world, context, persona, knownCast });
    if (!result.ok) return result;

    const fields = { ...result.fields };
    for (const key of PROFILE_FIELDS) {
      if (current.locked?.[key] && String(current.fields?.[key] ?? '').trim()) {
        fields[key] = current.fields[key];
      }
    }

    return {
      ok: true,
      profile: save({ ...current, fields, source: 'ai' }),
      cast: result.cast ?? [],
      request: result.request,
    };
  }

  /** 手改某字段 → 该字段置 locked */
  function edit(field, value) {
    const current = read();
    if (!PROFILE_FIELDS.includes(field)) return current;
    return save({
      ...current,
      fields: { ...current.fields, [field]: String(value ?? '') },
      locked: { ...current.locked, [field]: true },
    });
  }

  /** 解锁：field 为空表示全部解锁 */
  function unlock(field = null) {
    const current = read();
    if (!field) return save({ ...current, locked: {} });
    const locked = { ...current.locked };
    delete locked[field];
    return save({ ...current, locked });
  }

  /**
   * 一致性自检：拿侧写检查这批阶段是否符合人设。
   * 解析失败 / 调用失败都按「合格」处理 —— 审校不该阻塞生成，也不改任何东西（G5）。
   */
  async function checkConsistency({ profile, stages = [] } = {}) {
    const text = (stages ?? [])
      .map((stage) => `- ${stage.title ?? ''}｜目标：${stage.goal ?? ''}｜走位：${(stage.beats ?? []).join(' → ')}`)
      .join('\n');
    const messages = buildMessages('CHECK_CONSISTENCY', { profile: profileText(profile), stages: text });

    try {
      const raw = await client.request({ ...getConnection?.(), messages, maxTokens: 400, label: 'CHECK_CONSISTENCY' });
      const data = parseDirectorResponse(raw, 'consistency');
      if (!data) return { ok: true, reason: '自检结果无法解析，按合格处理' };
      return { ok: data.ok, reason: data.reason };
    } catch (error) {
      return { ok: true, reason: `自检调用失败：${error?.message ?? '未知'}` };
    }
  }

  return { read, save, generate, regenerate, edit, unlock, checkConsistency };
}
