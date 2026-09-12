// 导演时间 · 导演强度（T-424）
//
// 反馈 #6：有些角色就是内敛的 —— 一味"主动推进"会把角色写 OOC。
// 拍板方案：**不加一次 API 调用**，只改**注入文案的语气与措辞**。
//
// 三条硬边界（规格 §B「关键边界」）：
//   1. 只改注入文案。判定逻辑 / 状态机 / 熔断 / T-405 意愿矩阵 / 推进点判据**一律不受影响**
//   2. **标准档必须逐字零回归** —— 下面每个函数的 standard 分支就是改之前那句话，一个字都不能动
//   3. 强势档 = 标准档 + 一句主导句；克制档才换措辞

export const INTENSITY_LEVELS = ['restrained', 'standard', 'assertive'];

export const INTENSITY_LABELS = {
  restrained: '克制',
  standard: '标准',
  assertive: '强势',
};

/** 认不出的值一律回落标准档（默认值） */
export function normalizeIntensity(raw) {
  return INTENSITY_LEVELS.includes(raw) ? raw : 'standard';
}

/** 给人看的一句话（设置页用） */
export function intensityLabel(raw) {
  return INTENSITY_LABELS[normalizeIntensity(raw)] ?? INTENSITY_LABELS.standard;
}

/** 设置页的一行说明 */
export function intensityHint(raw) {
  switch (normalizeIntensity(raw)) {
    case 'restrained':
      return '弱化祈使推进词：改成"如果气氛合适，你可以试着推进"；内敛 / 冷淡角色不会被写成热情外放';
    case 'assertive':
      return '在标准档基础上加一句"由你主导节奏"，char 会更少等你回应';
    default:
      return '现状（推荐）：推进语气不变';
  }
}

/** 本场活动的前缀（克制档去掉"你要"的强祈使） */
export function intensityActivityPrefix(raw) {
  return normalizeIntensity(raw) === 'restrained' ? '可以试着做的一件事：' : '你要主动做的一件事：';
}

/** 走位的前缀 */
export function intensityBeatsPrefix(raw) {
  return normalizeIntensity(raw) === 'restrained' ? '可以按这个顺序试着做：' : '按这个顺序主动做：';
}

/** 快接近本场上限时的推进句 */
export function intensityNearMaxLine(raw) {
  return normalizeIntensity(raw) === 'restrained'
    ? '这一场够久了。可以试着做一件事，把剧情往下带一带。'
    : '这一场够久了。别再问了，直接做一件事把剧情推下去。';
}

/** 结尾的强祈使推进句（规格点名的两句之一） */
export function intensityClosingLine(raw) {
  return normalizeIntensity(raw) === 'restrained'
    ? '以上是可以试着推进的方向 —— 如果气氛合适，你可以试着推进，不必勉强。'
    : '以上都是**你要主动做的事** —— 不要等 user 开口，也不要等 user 给你理由。';
}

/** 强势档附加的主导句（其它档位是空串，等于没有） */
export function intensityLeadLine(raw) {
  return normalizeIntensity(raw) === 'assertive' ? '由你主导节奏，不必等 user 回应每一步。' : '';
}

/** 冷场提示（T-417）：克制档保留 initiative，但换成提议语气 */
export function intensityProactive(raw, initiative) {
  if (normalizeIntensity(raw) === 'restrained') {
    return initiative
      ? `如果冷场，你可以${initiative}（不必勉强，也不必热情外放）`
      : '如果冷场，你可以安静地待一会儿，也可以试着推进一步 —— 不必勉强。';
  }
  return initiative
    ? `不要等 user 提问或回应。如果冷场，你就${initiative}`
    : '不要等 user 提问或回应。如果冷场，你就自己找一件事继续。';
}

/** 收尾场（ready）里的冷场提示 */
export function intensityReadyHint(raw, initiative) {
  const soft = normalizeIntensity(raw) === 'restrained';
  return `${soft ? '如果冷场，你可以' : '如果冷场，你就'}${initiative}${soft ? '（不必勉强）' : ''}`;
}

/**
 * GEN_INITIATIVE 生成时的降调说明（克制档才非空）。
 * 规格 §B：克制档要把生成的 initiative **降调重写为提议语气**。
 */
export function intensityInitiativeNote(raw) {
  return normalizeIntensity(raw) === 'restrained'
    ? '（注意：这个角色内敛 / 冷淡，用提议、试探的语气写，不要写成热情外放的动作）'
    : '';
}
