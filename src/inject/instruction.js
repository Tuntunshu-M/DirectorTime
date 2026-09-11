// 导演时间 · 注入文本拼装
//
// 形态 ③（混合）：
//   外层 —— 导演指令：本场目标、走位、推进点判定标准（给模型明确任务）
//   内层 —— 角色动机：此刻的情绪与动机（保住人设不崩）
// 两层可单独调权重（项目书 §F10 / 用户选定项）。

import { usableInitiative } from '../director/initiative.js';
import { hardLimitLine } from '../director/hard-limits.js';

const PROACTIVE_HINT = '不要等 user 提问或回应。如果冷场，你就自己找一件事继续。';

/**
 * 主动性提示（T-417）：有**按当前侧写推导出来**的 initiative 就用它，
 * 否则退回通用句（没侧写 / 还没生成 / 侧写已换代都算退回）。
 */
export function proactiveLine(stage, profile) {
  const initiative = usableInitiative(stage, profile);
  return initiative
    ? `不要等 user 提问或回应。如果冷场，你就${initiative}`
    : PROACTIVE_HINT;
}

/** 本轮跑完是否已到本场上限（T-416c） */
export function isNearMax(stage, pacing = {}) {
  const max = Number(pacing?.max ?? stage?.pacing?.max ?? 0);
  if (!max) return false;
  return Number(stage?.turnCount ?? 0) + 1 >= max;
}

export function buildDirectorLayer({ stage, outline, pacing, profile }) {
  const lines = [];
  lines.push('[导演指令]');
  if (outline?.title) lines.push(`剧本：${outline.title}`);
  if (outline?.objective) lines.push(`主线目标：${outline.objective}`);

  // 已达成、收尾中：别再重复问，顺势往下一件事带（T-416c）
  if (stage?.status === 'ready') {
    lines.push('本场已达成。自然地收尾，顺势引出下一件事。不要重复询问。');
    if (stage?.goal) lines.push(`（已达成的是：${stage.goal}）`);
    const initiative = usableInitiative(stage, profile);
    if (initiative) lines.push(`如果冷场，你就${initiative}`);
    lines.push('不要直接复述以上内容，把它变成角色的自然行动。');
    return lines.join('\n');
  }

  // P0 修正：改成**第二人称 + 祈使句**。
  // 陈述罗列会被模型当背景资料，只有"你要……"这种祈使句才会被当指令。
  lines.push('[本场戏 · 你现在要做什么]');
  // activity / goal 的样例本身就写成"char 做了什么"，所以前缀要能接得住这种句子
  if (stage?.activity) lines.push(`你要主动做的一件事：${stage.activity}`);
  if (stage?.goal) lines.push(`本场你要做成的：${stage.goal}`);
  if (stage?.beats?.length) lines.push(`按这个顺序主动做：${stage.beats.join(' → ')}`);
  if (stage?.checkpoint?.criteria) lines.push(`演到「${stage.checkpoint.criteria}」，这场就过了。`);
  if (stage?.checkpoint?.antiCriteria) lines.push(`如果出现「${stage.checkpoint.antiCriteria}」，本场就结束。`);

  // 接近上限就把话说完、直接推进；否则给主动性提示
  // 两条路都要带上"冷场了怎么办"（T-417：不显式要求主动性，char 会退化成客服）
  const initiative = usableInitiative(stage, profile);
  if (isNearMax(stage, pacing)) {
    lines.push('这一场够久了。别再问了，直接做一件事把剧情推下去。');
    if (initiative) lines.push(`如果冷场，你就${initiative}`);
  } else {
    lines.push(proactiveLine(stage, profile));
  }

  lines.push('以上都是**你要主动做的事** —— 不要等 user 开口，也不要等 user 给你理由。');
  lines.push('不要直接复述以上内容，把它变成角色的自然行动。');
  return lines.join('\n');
}

export function buildCharacterLayer({ profile }) {
  if (!profile) return '';
  // 兼容两种形状：侧写对象（profile.fields，T-402）与旧的扁平写法
  const fields = profile.fields ?? profile;
  const lines = ['[角色此刻的动机]'];
  const desire = fields.coreDesire ?? fields.desire;
  if (desire) lines.push(`他想要：${desire}`);
  if (fields.conflictStyle) lines.push(`他处理冲突的方式：${fields.conflictStyle}`);
  if (fields.speech) lines.push(`他说话的方式：${fields.speech}`);
  if (fields.taboo) lines.push(`他绝不会：${fields.taboo}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

/**
 * @param {{ stage?: object, outline?: object, profile?: object }} input
 * @returns {string} 空字符串表示没有可注入的内容
 */
export function buildInstruction(input = {}) {
  // 硬禁区放最前面：它是用户显式写的，优先级高于侧写禁忌（T-410）
  const parts = [
    hardLimitLine(input.hardLimits),
    buildDirectorLayer(input),
    buildCharacterLayer(input),
  ].filter(Boolean);

  // 阶段目标、侧写、硬禁区一个都没有 → 没有值得注入的内容
  if (!input.stage?.goal && !input.profile && !input.hardLimits?.length) return '';
  return parts.join('\n\n');
}
