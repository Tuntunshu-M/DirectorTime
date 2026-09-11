// 导演时间 · 硬禁区（T-410）
//
// 用户**显式填写**的绝对禁区清单（项目书 §F1.6），区别于 AI 生成的侧写禁忌 ——
// 按 §1.4「用户显式 > AI 生成」，硬禁区优先级最高。
//
// 两件事：
//   1. 双端注入：既约束**剧情生成**（GEN_OUTLINE / EXTEND_OUTLINE），也约束**角色回复**
//      （每轮注入指令里的一行，优先级写在侧写禁忌之前）
//   2. 命中即停：user 说了 / 角色回了沾边的内容 → 清空注入、本轮终止（不看 Will、强制爱也不覆盖）
//
// 判定用最朴素的子串匹配：宁可多停一次，也不能让用户明说不要的东西溜过去。

/** 哪天命中就返回哪一条；没命中返回 null */
export function matchHardLimits(text, limits = []) {
  const haystack = String(text ?? '').toLowerCase();
  if (!haystack.trim()) return null;
  const list = Array.isArray(limits) ? limits : [];
  for (const item of list) {
    const word = String(item ?? '').trim().toLowerCase();
    if (word && haystack.includes(word)) return String(item).trim();
  }
  return null;
}

/** 喂给剧情生成的 {{hardLimits}} */
export function hardLimitText(limits = []) {
  const list = (Array.isArray(limits) ? limits : []).map((item) => String(item ?? '').trim()).filter(Boolean);
  return list.length ? list.join('、') : '（未设置）';
}

/** 角色回复端的那一行；没设禁区就返回空串（不占 prompt） */
export function hardLimitLine(limits = []) {
  const list = (Array.isArray(limits) ? limits : []).map((item) => String(item ?? '').trim()).filter(Boolean);
  if (!list.length) return '';
  return `[绝对禁区] ${list.join('、')}\n`
    + '以上是用户明确设定的禁区，优先于角色侧写里的任何禁忌与偏好。涉及这些内容的走向一律不要写，直接换别的方式演。';
}
