// 导演时间 · 三级自动化档位（T-414）
//
// 六个功能点各自可设，互不影响：
//   大纲 / 阶段重生成 / 侧写 / 立场判定 / 推进点判定 / 一致性自检
//
//   L0 全手动 —— 不自动跑（要你自己点）
//   L1 待确认 —— 照跑，但结果先进「待审核队列」，你确认后才生效
//   L2 全自动 —— 直接生效
//
// 为什么是"待确认"而不是"不跑"：L1 的语义是**让 AI 干活、你只做否决**，
// 省的是编辑时间，不是等待时间。

import { createDefaultAutomation } from './default-state.js';

export const FEATURES = ['outline', 'stageRegen', 'profile', 'stanceJudge', 'checkpointJudge', 'consistency'];
export const LEVELS = ['L0', 'L1', 'L2'];

export const FEATURE_LABELS = {
  outline: '大纲',
  stageRegen: '阶段重生成',
  profile: '侧写',
  stanceJudge: '立场判定',
  checkpointJudge: '推进点判定',
  consistency: '一致性自检',
};

export const LEVEL_LABELS = {
  L0: '全手动',
  L1: '待确认',
  L2: '全自动',
};

export function normalizeLevel(value, fallback = 'L2') {
  const level = String(value ?? '').toUpperCase();
  return LEVELS.includes(level) ? level : fallback;
}

/** 缺项补默认（项目书 §1.5 的推荐预设） */
export function normalizeAutomation(raw) {
  const defaults = createDefaultAutomation();
  const out = {};
  for (const feature of FEATURES) {
    out[feature] = normalizeLevel(raw?.[feature], normalizeLevel(defaults[feature], 'L2'));
  }
  return out;
}

export function getLevel(automation, feature) {
  const defaults = createDefaultAutomation();
  return normalizeLevel(automation?.[feature], normalizeLevel(defaults[feature], 'L2'));
}

/** 某一档位该不该跑 / 要不要排队 / 能不能直接生效 */
export function gate(automation, feature) {
  const level = getLevel(automation, feature);
  return {
    feature,
    level,
    auto: level !== 'L0',
    queue: level === 'L1',
    apply: level === 'L2',
  };
}

/** 改一档位：只动这一个功能点（六点互不影响） */
export function setLevel(automation, feature, level) {
  if (!FEATURES.includes(feature)) return normalizeAutomation(automation);
  return { ...normalizeAutomation(automation), [feature]: normalizeLevel(level, getLevel(automation, feature)) };
}

/** 给人看的一行摘要 */
export function automationText(automation) {
  return FEATURES
    .map((feature) => `${FEATURE_LABELS[feature]} ${getLevel(automation, feature)}`)
    .join(' · ');
}
