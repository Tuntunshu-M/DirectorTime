// 导演时间 · 主角设置（T-412 多人卡适配）
//
// 多人卡场景里，一局可能有几个"主角"（用户想跟着谁走）。**由用户显式设置，不做自动识别**。
//
// 三件事：
//   1. 主角可以设多个（settings.protagonists），持久化
//   2. 每个阶段有归属：`Stage.actorId` —— 这一场是谁的戏
//   3. 注入前判断：当前要生成的角色不是主角 → 不注入；是主角、但这一场不是他的戏 → 也不注入
//
// 没配主角时（单卡用户）行为与以前完全一致：照常注入。

/** 归一化成 [{ id, name }]；兼容 ['名字'] 这种简写 */
export function normalizeProtagonists(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (typeof item === 'string') return { id: '', name: item.trim() };
      return {
        id: String(item?.id ?? '').trim(),
        name: String(item?.name ?? '').trim(),
      };
    })
    .filter((item) => item.id || item.name);
}

/**
 * 是不是同一个人：id 或名字**任一**对上就算。
 * 之所以不只比 id：阶段的 actorId 是模型填的，它可能填名字也可能填 id。
 */
function sameSpeaker(a, b) {
  const left = { id: String(a?.id ?? '').trim(), name: String(a?.name ?? '').trim() };
  const right = { id: String(b?.id ?? '').trim(), name: String(b?.name ?? '').trim() };
  if (left.id && right.id && left.id === right.id) return true;
  if (left.name && right.name) return left.name.toLowerCase() === right.name.toLowerCase();
  return false;
}

/**
 * 这一轮该不该注入。
 * @param {{stage?: object, speaker?: {id?: string, name?: string}, protagonists?: Array}} input
 */
export function shouldInject({ stage, speaker, protagonists } = {}) {
  const list = normalizeProtagonists(protagonists);
  if (!list.length) return true; // 没配主角 → 维持单卡老行为
  if (!speaker?.id && !speaker?.name) return true; // 问不到当前角色时别乱拦

  const me = list.find((item) => sameSpeaker(item, speaker));
  if (!me) return false; // 当前生成者根本不是主角 → 不注入主角的戏

  const actor = stage?.actorId;
  if (!actor) return true; // 阶段没写归属 → 主角自己演，照常注入
  // actorId 可能是名字也可能是 id，两种都比一次
  const actorRef = typeof actor === 'string' ? { name: actor, id: actor } : actor;
  return sameSpeaker(actorRef, me); // 归属别的主角 → 这场不是给你演的，不注入
}

/** 喂给剧情生成的 {{protagonists}} */
export function protagonistText(list) {
  const items = normalizeProtagonists(list);
  if (!items.length) return '（未设置，按单卡处理）';
  return items.map((item, index) => `${index + 1}. ${item.name || item.id}（actorId 填「${item.name || item.id}」）`).join('\n');
}
