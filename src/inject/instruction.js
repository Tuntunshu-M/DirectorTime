// 导演时间 · 注入文本拼装
//
// 形态 ③（混合）：
//   外层 —— 导演指令：本场目标、走位、推进点判定标准（给模型明确任务）
//   内层 —— 角色动机：此刻的情绪与动机（保住人设不崩）
// 两层可单独调权重（项目书 §F10 / 用户选定项）。

const PROACTIVE_HINT = '不要等 user 提问或回应。如果冷场，你就自己找一件事继续。';

/** 本轮跑完是否已到本场上限（T-416c） */
export function isNearMax(stage, pacing = {}) {
  const max = Number(pacing?.max ?? stage?.pacing?.max ?? 0);
  if (!max) return false;
  return Number(stage?.turnCount ?? 0) + 1 >= max;
}

export function buildDirectorLayer({ stage, outline, pacing }) {
  const lines = [];
  lines.push('[导演指令]');
  if (outline?.title) lines.push(`剧本：${outline.title}`);
  if (outline?.objective) lines.push(`主线目标：${outline.objective}`);

  // 已达成、收尾中：别再重复问，顺势往下一件事带（T-416c）
  if (stage?.status === 'ready') {
    lines.push('本场已达成。自然地收尾，顺势引出下一件事。不要重复询问。');
    if (stage?.goal) lines.push(`（已达成的是：${stage.goal}）`);
    lines.push('不要直接复述以上内容，把它变成角色的自然行动。');
    return lines.join('\n');
  }

  if (stage?.goal) lines.push(`本场目标：${stage.goal}`);
  if (stage?.activity) lines.push(`角色主要活动：${stage.activity}`);
  if (stage?.beats?.length) lines.push(`建议走位：${stage.beats.join(' → ')}`);
  if (stage?.checkpoint?.criteria) lines.push(`本场完成标志：${stage.checkpoint.criteria}`);
  if (stage?.checkpoint?.antiCriteria) lines.push(`若出现以下情况则本场作废：${stage.checkpoint.antiCriteria}`);

  // 接近上限就把话说完、直接推进；否则给主动性提示
  if (isNearMax(stage, pacing)) {
    lines.push('这一场够久了。别再问了，直接做一件事把剧情推下去。');
  } else {
    lines.push(PROACTIVE_HINT);
  }

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
  const director = buildDirectorLayer(input);
  const character = buildCharacterLayer(input);

  const parts = [director, character].filter(Boolean);
  if (!parts.length) return '';
  // 没有侧写时只有导演层，也算完整指令
  if (parts.length === 1 && !input.stage?.goal) return '';
  return parts.join('\n\n');
}
