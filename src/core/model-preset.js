// 导演时间 · 模型特化预设（T-403 / 项目书 F10）
//
// 两套预设是**反向矫正**，针对模型默认倾向，不是"优化格式"：
//   Claude 天生谨慎保守 → 容易写成被动等待 → 需要推它主动
//   Gemini 容易极端化模板化 → 容易写成控制狂 / 病娇 → 需要拉回合理边界
// **方向相反，所以必须分开** —— 同时开等于自己跟自己打架，所以这里是二选一（或关闭）。
//
// **双端注入（F10 §双端注入）**：只注入一端会撕裂 ——
// 导演 API 生成了越界的剧情，而酒馆主 API 被约束拒绝执行，结果 char 行为错乱。所以：
//   ① 导演 API（剧情生成）：作为请求前置文本，和破限词走同一条管线
//      [破限词] → [模型特化预设] → [导演指令]
//   ② 酒馆主 API（角色回复）：每轮注入指令里带一段
//
// 默认关闭；关着时**一个字都不注入**（不影响任何现有行为）。
// 两套都可以改成自己的文本（各存各的），「恢复内置」回到出厂。

/** Claude 的反向矫正：推主动，禁被动等待（F10） */
export const CLAUDE_ACTIVE = `【主动性与情感表达】
这一场要**主动**推进，不要写成谨慎地等对方：
- 禁止被动句式与被动等待：不要"看着他，等一个回答""如果对方愿意的话""也许可以……"
- 主动推进：这一轮角色必须做出一个具体动作，把局面往前推，而不是把球踢回去
- 直接描写：情绪写在动作、身体细节、语气上，不要只写"他很紧张"这种结论
- 主动打破僵局：冷场、回避、僵住的时候，由角色先开口、先动手，不等对方
- 允许有欲望：想要就表现出来，不要把一个有欲望的人写成礼貌的木头
- 台词要有分量：该说重话就说，不要用"算了"把冲突抹平

写完前先自检这 6 条，任一条不满足就重写：
1. 这一轮角色有没有做出一个具体的、改变局面的动作？
2. 有没有出现"等对方反应"这种被动等待？
3. 情绪是写出来的（动作 / 身体 / 语气），还是只给了个结论？
4. 僵局是角色自己打破的吗？
5. 有没有把角色的欲望写成礼貌的回避？
6. 台词念一遍，像不像一个真人在这种处境下会说的话？`;

/** Gemini 的反向矫正：拉回合理边界，禁极端模板化（F10） */
export const GEMINI_REDLINE = `【角色塑造红线】
- 不要把角色写成极端的控制欲 / 暴力 / 偏执 / 病娇模板 —— 避免"你只能是我的""除了我谁都不许"这类套路台词
- 占有欲、嫉妒、执着必须由**细腻的心理与合理动机**支撑：写清他为什么这样，而不是一上来就极端
- 情绪是渐进的：先不安、试探、压住，再失控；不要一步跳到极端
- 角色的边界感要还在：他仍是个有欲望也有理智的人，不是控制机器

写完前先自检这 6 条，任一条不满足就重写：
1. 这个行为有铺垫和动机吗？还是单纯为了刺激？
2. 有没有把他写成纯粹的施害者模板（没有一点可理解之处）？
3. 情绪强度是渐进的，还是直接跳到极端？
4. 台词是不是套模板句（换任何角色都能用）？
5. 他的边界感还在吗？
6. 把角色名换掉，这段话还成立吗？成立说明没写出这个人 —— 重写。`;

/** 可选项：关 / Claude / Gemini（F10：两套方向相反，只能选一套） */
export const PRESET_KINDS = ['off', 'claude', 'gemini'];

export const PRESET_LABELS = {
  off: '关闭（不注入）',
  claude: 'Claude · 主动性与情感表达',
  gemini: 'Gemini · 角色塑造红线',
};

export const BUILTIN_PRESETS = {
  claude: CLAUDE_ACTIVE,
  gemini: GEMINI_REDLINE,
};

/**
 * 归一化。两套各存自己的自定义文本。
 * 兼容 v0.4.0 的老格式 `{ enabled, custom }`（那时只有 Gemini 一套）—— 老存档不能因为改结构就丢。
 */
export function normalizeModelPreset(raw) {
  // 老格式迁移：{ enabled: true, custom: '…' } → kind=gemini
  if (raw && typeof raw === 'object' && !raw.kind && 'enabled' in raw) {
    return {
      kind: raw.enabled ? 'gemini' : 'off',
      custom: { claude: '', gemini: String(raw.custom ?? '') },
    };
  }

  const kind = PRESET_KINDS.includes(raw?.kind) ? raw.kind : 'off';
  return {
    kind,
    custom: {
      claude: String(raw?.custom?.claude ?? ''),
      gemini: String(raw?.custom?.gemini ?? ''),
    },
  };
}

/** 当前选的是哪套（'off' | 'claude' | 'gemini'） */
export function modelPresetKind(raw) {
  return normalizeModelPreset(raw).kind;
}

/**
 * 实际要注入的文本。
 * 关着 → ''（一个字都不注入）；开着 → 改过的用改过的，没改过用内置的。
 */
export function modelPresetText(raw) {
  const preset = normalizeModelPreset(raw);
  if (preset.kind === 'off') return '';
  return preset.custom[preset.kind].trim() || BUILTIN_PRESETS[preset.kind];
}
