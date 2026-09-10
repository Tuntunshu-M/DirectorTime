// 导演时间 · 注入文本拼装
//
// 形态 ③（混合）：
//   外层 —— 导演指令：本场目标、走位、推进点判定标准（给模型明确任务）
//   内层 —— 角色动机：此刻的情绪与动机（保住人设不崩）
// 两层可单独调权重（项目书 §F10 / 用户选定项）。

export function buildDirectorLayer({ stage, outline }) {
  const lines = [];
  lines.push('[导演指令]');
  if (outline?.title) lines.push(`剧本：${outline.title}`);
  if (stage?.goal) lines.push(`本场目标：${stage.goal}`);
  if (stage?.activity) lines.push(`角色主要活动：${stage.activity}`);
  if (stage?.beats?.length) lines.push(`建议走位：${stage.beats.join(' → ')}`);
  if (stage?.checkpoint?.criteria) lines.push(`本场完成标志：${stage.checkpoint.criteria}`);
  if (stage?.checkpoint?.antiCriteria) lines.push(`若出现以下情况则本场作废：${stage.checkpoint.antiCriteria}`);
  lines.push('不要直接复述以上内容，把它变成角色的自然行动。');
  return lines.join('\n');
}

export function buildCharacterLayer({ profile }) {
  if (!profile) return '';
  const lines = ['[角色此刻的动机]'];
  if (profile.desire) lines.push(`他想要：${profile.desire}`);
  if (profile.conflictStyle) lines.push(`他处理冲突的方式：${profile.conflictStyle}`);
  if (profile.speech) lines.push(`他说话的方式：${profile.speech}`);
  if (profile.taboo) lines.push(`他绝不会：${profile.taboo}`);
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
