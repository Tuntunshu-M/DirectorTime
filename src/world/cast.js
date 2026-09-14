// 导演时间 · 主角设置（T-412 多人卡适配 + T-436 多人卡自选）
//
// 多人卡场景里，一局可能有几个"主角"（用户想跟着谁走）。现在两种来源并存：
//   · **自动识别**：酒馆里有哪几张角色卡（`ctx.listCharacters()`），在人物页勾选
//   · **自选**：手动填名字（`manual: true`）—— 给"想攻略的 NPC"用（NPC 可能没有卡）
//
// 三件事：
//   1. 主角可以设多个（settings.protagonists），持久化
//   2. 每个阶段有归属：`Stage.actorId` —— 这一场是谁的戏
//   3. 注入前判断：当前要生成的角色不是主角 → 不注入；是主角、但这一场不是他的戏 → 也不注入
//
// 没配主角时（单卡用户）行为与以前完全一致：照常注入。

/**
 * 归一化成 `[{ id, name, manual? }]`；兼容 `['名字']` 这种简写（当手填处理）。
 * T-436：**去重**（同名只留一条，勾选与手填撞车时不会出现两条）。
 */
export function normalizeProtagonists(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const entry = typeof item === 'string'
      ? { id: '', name: item.trim() } // 简写不标 manual：老数据形状保持不变（`!id` 也能认出是手填）
      : {
        id: String(item?.id ?? '').trim(),
        name: String(item?.name ?? '').trim(),
      };
    if (!entry.id && !entry.name) continue;
    if (typeof item === 'object' && item?.manual === true) entry.manual = true;
    if (out.some((exist) => sameSpeaker(exist, entry))) continue; // 同名/同 id 只留一条
    out.push(entry);
  }
  return out;
}

/** 这个角色在不在主角名单里（界面勾选状态用） */
export function isProtagonist(list, ref) {
  return normalizeProtagonists(list).some((item) => sameSpeaker(item, ref));
}

/** 勾选 / 取消勾选一个（自动识别出来的）角色 —— 返回新的主角列表 */
export function toggleProtagonist(list, entry) {
  const items = normalizeProtagonists(list);
  if (isProtagonist(items, entry)) return items.filter((item) => !sameSpeaker(item, entry));
  return normalizeProtagonists([...items, { id: entry?.id ?? '', name: entry?.name ?? '' }]);
}

/**
 * T-437：勾选 / 取消勾选一个**世界书里识别出来的**角色。
 *
 * 与 `toggleProtagonist`（角色卡）的区别只有一处：世界书里的角色**没有卡 id**，
 * 所以按规格只存 `name`（`id` 为空串），不标 `manual`（那会跑到「自选（手填）」那一节里，变成两处重复）。
 */
export function toggleWorldProtagonist(list, name) {
  const items = normalizeProtagonists(list);
  const text = String(name ?? '').trim();
  if (!text) return items;
  const hit = (item) => item.name && item.name.toLowerCase() === text.toLowerCase();
  if (items.some(hit)) return items.filter((item) => !hit(item));
  return normalizeProtagonists([...items, { id: '', name: text }]);
}

/** 手填一个名字（自选 / NPC）：已存在就原样返回，不重复加 */
export function addProtagonist(list, name) {
  const items = normalizeProtagonists(list);
  const text = String(name ?? '').trim();
  if (!text) return items;
  if (items.some((item) => item.name && item.name.toLowerCase() === text.toLowerCase())) return items;
  return normalizeProtagonists([...items, { id: '', name: text, manual: true }]);
}

/** 移除一个（id 或名字对上就删） */
export function removeProtagonist(list, ref) {
  return normalizeProtagonists(list).filter((item) => !sameSpeaker(item, ref));
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
