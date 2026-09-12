// 导演时间 · 伏笔（T-408）
//
// 埋下的伏笔（一句设定、一个道具、一个约定）要记下来，回收后打标记。
// 关键约束：**重生成剧本时，未回收的伏笔不能丢** —— 否则"前面埋的坑"会被整份重写冲掉。
//
// 回收怎么判：不额外花一次 API。判定推进点的那次调用（JUDGE_CHECKPOINT）顺手让模型
// 回答"这一轮回收了哪几条"，带回来的编号在这里销账。

let seq = 0;
function nextId() {
  seq += 1;
  return `fs_${Date.now().toString(36)}_${seq}`;
}

/**
 * 状态词表按《AI 执行清单》§0.3 的约定：`planted | paidoff | abandoned`。
 * 早期版本写的是 `open` / `resolved`，**读的时候两套都认**（老存档不能因为改词表就丢进度），
 * 写回去统一用约定里的词。
 */
const PAID_OFF_WORDS = ['paidoff', 'resolved'];

/** 这条伏笔回收了没有（兼容旧词表） */
export function isPaidOff(item) {
  return PAID_OFF_WORDS.includes(String(item?.status ?? '').trim());
}

/** 模型给的一律是字符串数组（也可能已经是对象），统一成记录 */
export function normalizeForeshadows(list, { now = Date.now(), stageId = '' } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const text = String(typeof item === 'string' ? item : item?.text ?? '').trim();
      if (!text) return null;
      return {
        id: typeof item?.id === 'string' && item.id ? item.id : nextId(),
        text,
        status: isPaidOff(item) ? 'paidoff' : 'planted',
        stageId: item?.stageId ?? stageId,
        plantedAt: Number(item?.plantedAt) || now,
        resolvedAt: Number(item?.resolvedAt) || 0,
      };
    })
    .filter(Boolean);
}

/** 还没回收的 */
export function openForeshadows(outline) {
  return (outline?.foreshadows ?? []).filter((item) => !isPaidOff(item));
}

/**
 * 重生成剧本时把上一份的未回收伏笔带过来（验收判据 1）。
 * 新的伏笔在前，旧的按文本去重后补在后面。
 */
export function carryOver(previousOutline, freshOutline, { now = Date.now() } = {}) {
  const fresh = normalizeForeshadows(freshOutline?.foreshadows, { now });
  const seen = new Set(fresh.map((item) => item.text));
  const kept = openForeshadows(previousOutline)
    .filter((item) => !seen.has(item.text))
    .map((item) => ({ ...item })); // 原样保留：id / 埋设时间都不变，方便追溯
  return { ...freshOutline, foreshadows: [...fresh, ...kept] };
}

/**
 * 销账：把判定里报回来的编号标成已回收。
 * 认不出来的编号忽略（可能是模型编的）。
 */
export function resolveRecalled(outline, recalled, { now = Date.now() } = {}) {
  const ids = new Set((Array.isArray(recalled) ? recalled : []).map((value) => String(value ?? '').trim()));
  if (!ids.size) return { outline, resolved: [] };

  const resolved = [];
  const foreshadows = (outline?.foreshadows ?? []).map((item) => {
    if (isPaidOff(item) || !ids.has(String(item.id))) return item;
    resolved.push(item);
    return { ...item, status: 'paidoff', resolvedAt: now };
  });

  return { outline: { ...outline, foreshadows }, resolved };
}

/** 喂给 prompt / 判定用的清单；超过 limit 条就截断 */
export function foreshadowText(outline, { limit = 5 } = {}) {
  const open = openForeshadows(outline).slice(0, limit);
  if (!open.length) return '（暂无）';
  return open.map((item, index) => `${index + 1}. [${item.id}] ${item.text}`).join('\n');
}
