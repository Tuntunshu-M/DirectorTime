// 导演时间 · char 主动性（T-417 / M13）
//
// 模型默认倾向"等 user 开口"，不显式要求主动性，char 会退化成一问一答的客服。
// 所以每轮指令都要带一句"如果冷场，你就……" —— 但这句话不能是模板：
//   1. 必须**由侧写推导**：让 AI 按这个角色的人设想"他会主动做什么"，
//      没有侧写就不生成（凭空编 = 造人设，比不做更糟）
//   2. 侧写更新后，已有阶段的 initiative 过期，要重新生成（用 profileStamp 判）
//
// 字段名注意：`proactivity` 是侧写里的"主动程度"；`initiative` 是每个阶段
// char 的主动行为，两回事（见 world/character.js 顶部注释）。

import { buildMessages } from '../llm/prompts.js';
import { parseDirectorResponse } from '../llm/schemas.js';
import { profileText } from '../world/character.js';

/** 一句话就够 —— 太长会把指令淹掉 */
export const INITIATIVE_MAX_LENGTH = 60;

/** 有侧写内容才允许谈主动性 */
export function hasProfile(profile) {
  const fields = profile?.fields ?? profile ?? {};
  return Object.values(fields).some((value) => typeof value === 'string' && value.trim());
}

/** 侧写版本戳：侧写一更新（updatedAt 变）就跟着变，用来判断 initiative 是否过期 */
export function profileStamp(profile) {
  if (!hasProfile(profile)) return '';
  return String(profile?.updatedAt ?? 0);
}

/** 清洗模型给的结果：压成单行、去首尾、限长 */
export function normalizeInitiative(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, INITIATIVE_MAX_LENGTH);
}

/** 这个阶段要不要（重新）生成 initiative */
export function needsInitiative(stage, profile) {
  if (!stage || !hasProfile(profile)) return false; // 没有侧写 → 不生成
  if (!normalizeInitiative(stage.initiative)) return true; // 还没有
  return String(stage.initiativeFrom ?? '') !== profileStamp(profile); // 侧写换代了
}

/**
 * 可以注入的 initiative：只有"有侧写 + 盖章且没过期 + 内容非空"才返回，
 * 其余（没侧写 / 没盖章 / 侧写换代 / 阶段为空）一律返回 ''，
 * 调用方退回通用主动性提示（禁则 G5：不注入过期或来路不明的内容）。
 */
export function usableInitiative(stage, profile) {
  if (!stage || !hasProfile(profile)) return '';
  const from = String(stage.initiativeFrom ?? '');
  if (!from || from !== profileStamp(profile)) return '';
  return normalizeInitiative(stage.initiative);
}

/** 给刚生成的阶段盖章：记下"这条 initiative 是按哪一版侧写推出来的" */
export function stampInitiative(stages = [], profile) {
  const from = profileStamp(profile);
  return (stages ?? []).map((stage) => ({
    ...stage,
    initiative: normalizeInitiative(stage.initiative),
    initiativeFrom: from,
  }));
}

export function createInitiativeService({ client, getConnection, stages, now = Date.now } = {}) {
  /**
   * 按当前侧写重生成某一阶段的 initiative。
   * 调用 / 解析失败 → ok:false 且**不写状态**，阶段退回通用提示（G5）。
   */
  async function refresh({ stage, profile } = {}) {
    if (!stage?.id) return { ok: false, code: 'NO_STAGE', error: '没有可更新的阶段' };
    if (!hasProfile(profile)) {
      return { ok: false, code: 'NO_PROFILE', error: '还没有人物侧写，先做侧写再谈主动性' };
    }

    const messages = buildMessages('GEN_INITIATIVE', {
      profile: profileText(profile),
      goal: stage.goal ?? '',
      activity: stage.activity ?? '',
      beats: (stage.beats ?? []).join(' → '),
    });

    let raw;
    try {
      raw = await client.request({ ...getConnection?.(), messages, maxTokens: 300, label: 'GEN_INITIATIVE' });
    } catch (error) {
      return { ok: false, code: error?.name ?? 'DirectorRequestError', error: error?.message ?? '导演 API 请求失败' };
    }

    const data = parseDirectorResponse(raw, 'initiative');
    const initiative = normalizeInitiative(data?.initiative);
    if (!initiative) {
      return { ok: false, code: 'PARSE_FAILED', error: '主动性结果无法解析（或侧写为空），未写入', raw };
    }

    stages?.update?.(stage.id, { initiative, initiativeFrom: profileStamp(profile) });
    return { ok: true, initiative, request: messages, at: now() };
  }

  return { refresh };
}
