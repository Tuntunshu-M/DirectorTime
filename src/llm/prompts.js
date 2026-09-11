// 导演时间 · Prompt 模板
//
// T-202。所有模板集中在此，禁止散落到业务模块。
// 模板支持 {{变量}}，缺失变量渲染为空字符串（不抛错）。
//
// 全文最关键的是 GEN_OUTLINE 的「推进点写法」与 JUDGE_CHECKPOINT 的「意图级判定」——
// 这两段直接决定是否会出现「完成条件太死、剧情卡住」的老毛病。

/** {{a.b.c}} 形式的变量替换 */
export function renderTemplate(template, vars = {}) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), vars);
    return value === undefined || value === null ? '' : String(value);
  });
}

const OUTLINE_SHAPE = `{
  "objective": "这个剧本最终要达成什么（一句话主目标）",
  "title": "剧本标题",
  "premise": "一句话前提",
  "foreshadows": ["埋下的伏笔：一句设定或一个道具（1~3 条）"],
  "stages": [
    {
      "title": "阶段名",
      "goal": "这一场要达成什么",
      "activity": "角色主要活动",
      "checkpoint": {
        "criteria": "达成条件（意图级、可观测）",
        "antiCriteria": "明确的反意图（必填）"
      },
      "beats": ["步骤一", "步骤二"],
      "initiative": "如果冷场，这个角色会主动做的一件事",
      "actorId": "这一场由哪个主角主导（填主角列表里的名字；只有一个主角就填空字符串）"
    }
  ]
}`;

export const PROMPTS = {
  GEN_OUTLINE: {
    system: `你是电影导演，正在为一部即兴戏剧编写分场剧本。

输出要求：
- 只输出 JSON，不要解释，不要 markdown 代码块标记
- 严格遵循这个结构：
${OUTLINE_SHAPE}

分场要求：
- objective 是整个副本的主目标；**每个阶段的 goal 都必须服务于它**，不要写与它无关的支线
- 3 到 5 个阶段，每个阶段只推进一件事
- goal 一句话说清这一场要达成什么
- beats 是角色的具体走位，2 到 4 条
- initiative 必须**由「人物侧写」推导**：这一场如果冷场，这个角色会主动做的一件具体事
  （一句话、能演、符合他的人设）。**侧写为空就填空字符串**，不要凭角色名瞎编
- foreshadows 是提前埋下的伏笔（一个道具、一句设定、一个约定），1 到 3 条、每条一句话。
  不要和「已经埋下、还没回收」的伏笔重复

推进点的写法（最关键，写错会导致剧情卡死）：
- criteria 必须是**可观测行为**，禁止心理或状态描写
- criteria 必须是**意图级**，不要写死具体名词
  正确："user 同意这次出行"
  错误："user 说出 D 市"——用户换个说法就判不中，剧情会卡死
- antiCriteria 必填，描述明确的反意图
- 一次只判一件事，复合条件拆成两个连续阶段`,
    user: `当前情况：
- 用户想法：{{premise}}
- 用户指定的主目标：{{objective}}
  （若为空：请你自己构思一个主目标，所有阶段必须服务于它）
- 主角（可能不止一个，每个阶段用 actorId 指明是谁的戏）：{{protagonists}}
- 绝对禁区（用户显式设定，**优先于人物侧写里的任何禁忌**，一个都不许碰）：{{hardLimits}}
- 剧情基调：{{tone}}
- 人物侧写：{{profile}}
- 世界书设定：{{world}}
- 已经埋下、还没回收的伏笔：{{foreshadows}}
- 近期对话：{{context}}

请生成一份分场剧本。`,
  },

  JUDGE_CHECKPOINT: {
    system: `你是场记，负责判断这一场戏是否拍完了。

**按意图判断，不要字面匹配关键词。**
- user 说"好啊那就去吧"，即使没提具体地名的字面，也算达成
- 只有明确表达相反意图，才算 violated

输出 JSON（不要解释）：
{ "status": "achieved" | "partial" | "pending" | "violated", "confidence": 0到1之间的数, "reason": "一句话理由", "recalled": ["这一轮回收了的伏笔编号"] }

recalled：只填这一轮剧情里**真的回收/解答了**的伏笔编号（没有就留空数组），不要臆测。

档位含义：
- achieved：意图明确达成
- partial：沾边但不够明确
- pending：完全没碰到
- violated：明确表达了相反意图

confidence 填你的把握程度。**不确定就给低值** —— 系统对低 confidence 一律按推进处理，因为剧情卡住比跳一步的危害大得多。`,
    user: `本场目标：{{goal}}
达成条件：{{criteria}}
反意图：{{antiCriteria}}
待回收伏笔：
{{foreshadows}}

user 刚才说：{{userMessage}}
角色回复：{{charMessage}}

判断这一场是否达成，并列出这一轮回收掉的伏笔编号。`,
  },

  JUDGE_STANCE: {
    system: `判断 user 这句话对当前剧情方向的态度。按意图判断，不做字面匹配。

输出 JSON（不要解释）：
{ "stance": "accept" | "reject" | "hesitate" | "irrelevant" | "redirect", "confidence": 0到1之间的数 }

- accept：接受、同意
- reject：拒绝、反对
- hesitate：犹豫、模糊
- irrelevant：与剧情无关
- redirect：想改变方向`,
    user: `当前剧情方向：{{goal}}

user 刚才说：{{userMessage}}

判断 user 的态度。`,
  },

  REWRITE_BEATS: {
    system: `你是电影导演。这一场戏拍到一半走偏了，需要给**同一场戏**换一组走位（beats）。

输出要求：
- 只输出 JSON，不要解释，不要 markdown 代码块标记
- 结构：{ "beats": ["走位一", "走位二"] }
- 2 到 4 条；每条是一个具体可演的动作，不写心理描写
- 必须换一条新路子：不与原走位重复，也不改变本场目标`,
    user: `本场目标：{{goal}}
达成条件：{{criteria}}
原走位：{{beats}}
刚才的判断：{{reason}}

user 说：{{userMessage}}
角色回：{{charMessage}}

请给这一场换一组新走位。`,
  },

  EXTEND_OUTLINE: {
    system: `你是电影导演。这部戏已经演到一半，需要你接着往下写分场剧本。

输出要求：
- 只输出 JSON，不要解释，不要 markdown 代码块标记
- 严格遵循这个结构：
{ "stages": [ { "title": "阶段名", "goal": "这一场要达成什么", "activity": "角色主要活动", "checkpoint": { "criteria": "达成条件（意图级、可观测）", "antiCriteria": "明确的反意图（必填）" }, "beats": ["步骤一", "步骤二"], "initiative": "如果冷场，这个角色会主动做的一件事", "actorId": "这一场由哪个主角主导（填主角列表里的名字）" } ] }
- 只写 {{count}} 个阶段，紧接着已经发生过的剧情往下走，不要重复已有阶段
- 一个阶段只推进一件事；criteria 写意图级，不要写死具体名词；antiCriteria 必填
- initiative 由「人物侧写」推导（同 GEN_OUTLINE）：侧写为空就填空字符串，不要瞎编`,
    user: `剧本：{{title}}
前提：{{premise}}
当前主目标：{{objective}}
主角（可能不止一个，每个阶段用 actorId 指明是谁的戏）：{{protagonists}}
绝对禁区（用户显式设定，优先于人物侧写里的任何禁忌）：{{hardLimits}}
剧情基调：{{tone}}
人物侧写：{{profile}}
世界书设定：{{world}}

已经演过的阶段：
{{history}}

近期对话：
{{context}}

续写的 {{count}} 个阶段必须继续服务于「当前主目标」，不要另起炉灶。`,
  },

  GEN_INITIATIVE: {
    system: `你是电影导演。这一场戏里如果 user 不说话、场面冷下来，角色要自己找一件事做 ——
不能变成一问一答的客服。

输出要求：
- 只输出 JSON，不要解释，不要 markdown 代码块标记
- 结构：{ "initiative": "一句话，角色的具体主动行为" }
- **必须从这个角色的人物侧写推导**：他会主动做什么，取决于他的欲望、恐惧、性格、说话方式与禁忌
- 写成一个能演的动作，不写心理描写，也不要与本场走位重复
- 侧写为空 → 填空字符串，不要凭角色名瞎编`,
    user: `人物侧写：
{{profile}}

本场目标：{{goal}}
角色主要活动：{{activity}}
本场走位：{{beats}}

这一场如果冷场了，这个角色会主动做什么？`,
  },

  SPECULATE_NEXT: {
    system: `你是电影导演。user 还没开口，你要先猜他下一句会说什么，
并**提前把这一轮该怎么演的导演指令写好**。猜中就用，猜不中会被丢掉 —— 所以不要勉强。

输出要求：
- 只输出 JSON，不要解释，不要 markdown 代码块标记
- 结构：{ "guess": "你猜 user 下一句会说的话", "injection": "如果猜中了，这一轮告诉角色该怎么演" }
- guess 要短、像 user 本人会说的话（第一人称），不要复述角色台词
- injection 写成给角色的行为指令（本场该做什么、不要做什么），不写心理描写`,
    user: `主线目标：{{objective}}
本场目标：{{goal}}
角色主要活动：{{activity}}
本场走位：{{beats}}

user 刚说：{{userMessage}}
角色刚回：{{charMessage}}

猜猜 user 下一句会说什么，并写好对应的导演指令。`,
  },

  GEN_PROFILE: {
    system: `你是角色分析师。为一个虚构角色写人物侧写，供后续编剧使用。

输出 JSON（不要解释，不要 markdown 代码块）：
{
  "coreDesire": "核心欲望",
  "fear": "恐惧",
  "speech": "说话方式",
  "attitudeToUser": "对 user 的态度",
  "conflictStyle": "处理冲突的方式",
  "proactivity": "主动程度",
  "intimacy": "亲密表达方式",
  "taboo": "禁忌"
}

每个字段的要求：
- 一句话，30 字以内。不要写段落。
- 必须有依据 —— 依据只能来自下面给你的角色卡、世界书、近期对话。
  **没有依据就不要编**，填"未知"。
- proactivity 要写到能指导行动的程度：
  差的："比较主动"
  好的："想要什么会直接开口要，被拒绝就换一种方式再试一次"
- taboo 写"绝不会做什么"，不要写"他不喜欢…"（太软，无法判定）

禁止：
- 不要把角色卡原文抄进来
- 不要写成人物小传（不要生平、不要经历）
- 不要评价角色好坏`,
    user: `角色卡：
{{char}}

世界书设定：
{{world}}

近期对话：
{{context}}

请生成这个角色的侧写。`,
  },

  CHECK_CONSISTENCY: {
    system: `你是剧本审校。判断这段分场剧本是否符合给定的人物侧写。

输出 JSON（不要解释）：
{ "ok": true 或 false, "reason": "一句话理由" }

只要阶段目标或走位明显违背侧写（例如让"绝不会当众示弱"的角色当众示弱），就判 ok=false。
不确定时判 ok=true —— 宁可放过，也别因为审校反复重写。`,
    user: `人物侧写：
{{profile}}

待检查的阶段：
{{stages}}

这段剧本符合人设吗？`,
  },
};

/**
 * 组装成 messages 数组，交给 client.request。
 * @param {'GEN_OUTLINE'|'EXTEND_OUTLINE'|'GEN_PROFILE'|'GEN_INITIATIVE'
 *         |'JUDGE_CHECKPOINT'|'JUDGE_STANCE'|'REWRITE_BEATS'|'CHECK_CONSISTENCY'} name
 */
export function buildMessages(name, vars = {}) {
  const template = PROMPTS[name];
  if (!template) throw new Error(`[导演时间] 未知的 prompt 模板：${name}`);

  return [
    { role: 'system', content: renderTemplate(template.system, vars) },
    { role: 'user', content: renderTemplate(template.user, vars) },
  ];
}
