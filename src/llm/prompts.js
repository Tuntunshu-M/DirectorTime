// 导演时间 · Prompt 模板
//
// T-202。所有模板集中在此，禁止散落到业务模块。
// 模板支持 {{变量}}，缺失变量渲染为空字符串（不抛错）；
// 也支持 {{#变量}}…{{/变量}} 条件块（键为空则整块消失，不留空行 —— T-427）。
//
// 全文最关键的是 GEN_OUTLINE 的「推进点写法」与 JUDGE_CHECKPOINT 的「意图级判定」——
// 这两段直接决定是否会出现「完成条件太死、剧情卡住」的老毛病。

/** {{a.b.c}} 形式的变量替换 */
const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** 条件块的开/闭标记（必须独占一行，前后只允许空白） */
const BLOCK_OPEN_RE = /^[ \t]*\{\{#\s*([\w.]+)\s*\}\}[ \t]*$/;
const BLOCK_CLOSE_RE = /^[ \t]*\{\{\/\s*([\w.]+)\s*\}\}[ \t]*$/;

function lookup(vars, path) {
  return String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), vars);
}

/** 空值：undefined / null / false / 空数组 / 纯空白串 —— 都当"这段不出现" */
function isEmptyValue(value) {
  if (value === undefined || value === null || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === '';
}

/**
 * 条件块（T-427）：`{{#key}}` 与 `{{/key}}` 各自独占一行，中间是块内容。
 *
 * - 键**为空**（空串 / undefined / 纯空白）→ 整块（含标记行）消失，**不留空行**
 * - 键**有值** → 标记行消失，内容行原地保留
 *
 * 为什么按行处理而不是一把正则：这样"块在文件首尾、两块相邻、块尾还有空行"都不会留半截空行，
 * 而**不留空行正是 T-427 的硬要求**（首轮请求文本必须与加块之前逐字一致）。
 * 限制：块必须独占整行，写成行内不会被识别（会原样留下 `{{#…}}` 字样，测试会抓）。
 */
function applyConditionalBlocks(template, vars) {
  const lines = String(template).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].match(BLOCK_OPEN_RE);
    if (!open) {
      out.push(lines[i]);
      continue;
    }
    const key = open[1];
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const close = lines[j].match(BLOCK_CLOSE_RE);
      if (close && close[1] === key) break;
      body.push(lines[j]);
    }
    if (j >= lines.length) {
      // 没找到闭合标记：不当条件块处理，原样保留（宁可不渲染，也不静默吞内容）
      out.push(lines[i]);
      continue;
    }
    i = j; // 跳过 {{/key}} 那一行
    if (!isEmptyValue(lookup(vars, key))) out.push(...body);
  }
  return out.join('\n');
}

/** 渲染模板：`{{a.b.c}}` 变量替换 + `{{#key}}…{{/key}}` 条件块（见上） */
export function renderTemplate(template, vars = {}) {
  const stripped = applyConditionalBlocks(template, vars);
  return stripped.replace(VAR_RE, (_match, path) => {
    const value = lookup(vars, path);
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
      "activity": "char 的主要活动（只能写 char 做什么）",
    "checkpoint": {
        "criteria": "达成条件（char 单方面就能完成、意图级、可观测）",
        "antiCriteria": "明确的反意图（必填；这里可以写 user 的反应，但它是判定条件）"
      },
      "beats": ["char 的意图一（不要写成品台词）", "char 的意图二"],
      "initiative": "如果冷场，char 会主动做的一件事",
      "actorId": "这一场由哪个主角主导（填主角列表里的名字；只有一个主角就填空字符串）"
    }
  ]
}`;

/** 演员界定（P0 修正：剧本只能指挥 char，不许预设 user 的行为） */
const ACTOR_RULES = `【演员界定 —— 最重要的一条，违反则整份作废】
- char = AI 扮演的角色。**你写的剧本只能指挥 char。**
- user = 真人。他想什么、怎么回应，由真人自己决定，你无权预设。
- 严禁出现这些写法：
    "让 user 感到……"   "user 会……"   "user 陷入……"
    "user 盯着……"     "user 决定……"   "user 开始……"
- 正确思路：**让 char 主动做一件事**，把剧情推到 user 不得不回应的处境。
  user 怎么接，不是你能写的部分。

各字段的主语（写错同样算作废）：
- goal：char 要达成什么，主语是 char —— 例："char 主动挑明昨晚的事，不让 user 回避"
- activity：char 做什么，主语是 char —— 例："char 发来新消息，假装无事地提起"
- beats：每一条都是 char 的动作 —— 例："char 发消息 → char 追问 → char 逼问到底"
- checkpoint.criteria：**char 单方面就能完成的事** —— 例："char 已把话题挑明，user 无法回避"。
  **需要 user 配合才能达成的一律不合格**（"user 与某人见面""user 决定…"）——
  user 不配合时这场也必须能走下去，否则剧情就卡死了。
- checkpoint.antiCriteria：**唯一例外** —— 可以写 user 的反应，但它是**判定条件**，
  不是"让 user 这样做"（写"user 明确表示不想谈"可以；写"让 user 拒绝"不行）
- 一句话原则：**每个字段的主语都必须是 char**，写 char 能独立完成的事。

写**意图**，不要写成**成品**：
- 禁止把台词、动作描述写死进 goal / activity / beats。
  错："他打出了'随便你怎么想'这句话"
  对："他不想多解释，冷冷地回一句"（具体台词由演员自己想）
- 写死的成品会被模型原样抄进对话里，指令原文就露馅了。



`;

/**
 * T-424 A：人设尊重（恒开，无开关）。
 * 反馈 #6：一味"主动推进"会把内敛角色写 OOC。这句同时进剧本生成与侧写生成。
 */
export const PERSONA_RESPECT = `推进剧情的表达方式必须符合角色既有性格。
内敛 / 冷淡角色的"主动"可以是微小动作与试探，不必热情外放；
禁止为了推进而让角色做出违背人设的热络举动。

但**卡面写明的特质优先**，别把"尊重人设"读成"一律收敛"：
- 角色卡里写着主动、会撩、会勾引、主动吸引对方的，就必须照卡面写成主动的
- 不许写"绝不主动""情感上绝不动心""绝不先低头"这类**回避型结论**：那不是内敛，是把戏写死
- "内敛角色的主动是微小动作与试探"说的是**表达方式**，不是"什么都不做"`;

/**
 * T-426：判定三段的口径抽成常量 —— 单条判定模板与合并模板共用同一份措辞
 * （否则合并版和单条版会各说各话，判定结果就对不上了）。
 */
const STANCE_SYSTEM = `判断 user 这句话对当前剧情方向的态度。按意图判断，不做字面匹配。

输出 JSON（不要解释）：
{ "stance": "accept" | "reject" | "hesitate" | "irrelevant" | "redirect", "confidence": 0到1之间的数 }

- accept：接受、同意
- reject：拒绝、反对
- hesitate：犹豫、模糊
- irrelevant：与剧情无关
- redirect：想改变方向`;

const CHECKPOINT_SYSTEM = `你是场记，负责判断这一场戏是否拍完了。

**按意图判断，不要字面匹配关键词。**
- 达成条件写的是 **char 做到的事**：char 做到了就算达成，即使他一个字都没说出口
- 判定看 **char 做到没有**，不是 user 有没有配合 —— user 不配合不代表没达成
- 但 user **完全没回应**不算达成：他一直聊别的、没接这一场的话 → 判 pending
  （一句话：**不要求 user 说什么，但要求 user 有在说**）
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

confidence 填你的把握程度。**不确定就给低值** —— 系统对低 confidence 一律按推进处理，因为剧情卡住比跳一步的危害大得多。`;

const SPECULATE_SYSTEM = `另外顺便猜一下 **user 接下来想干什么**，并提前把下一轮该怎么演的导演指令写好。
- speculation.guess 是**意图 / 方向**，不是台词：写"user 会试探性地靠近""user 会拒绝并转移话题"，每句不超过 15 字
  **绝对不要写完整台词**（写"我顺势坐下，深吸一口气，说：谢谢你…"这种整句永远猜不中）
- speculation.keywords：2 到 4 个**如果真是这个意图、他大概率会用到**的词或短语
  （例：意图是"拒绝" → ["算了","不必","不想"]）
- speculation.injection：写成给角色的行为指令（本场该做什么、不要做什么），不写心理描写`;

export const PROMPTS = {
  GEN_OUTLINE: {
    system: `${ACTOR_RULES}你是电影导演，正在为一部即兴戏剧编写分场剧本。

输出要求：
- 只输出 JSON，不要解释，不要 markdown 代码块标记
- 严格遵循这个结构：
${OUTLINE_SHAPE}

分场要求：
- objective 是整个副本的主目标；**每个阶段的 goal 都必须服务于它**，不要写与它无关的支线
- 3 到 5 个阶段，每个阶段只推进一件事
- goal 一句话说清 char 这一场要达成什么（主语是 char）
- beats 是 char 的具体走位，2 到 4 条，每条都要是 char 的动作
- initiative 必须**由「人物侧写」推导**：这一场如果冷场，这个角色会主动做的一件具体事
  （一句话、能演、符合他的人设）。**侧写为空就填空字符串**，不要凭角色名瞎编
- foreshadows 是提前埋下的伏笔（一个道具、一句设定、一个约定），1 到 3 条、每条一句话。
  不要和「已经埋下、还没回收」的伏笔重复

推进点的写法（最关键，写错会导致剧情卡死）：
- criteria 必须是**可观测行为**，禁止心理或状态描写
- criteria 的主语必须是 **char**，而且**char 单方面就能做到**：
  正确："char 已经把出行的事挑明，让这件事再也搁置不下去"
  错误："char 说服 user 答应出行"——要等 user 配合才算达成，user 不配合这场就永远过不去
  错误："user 与 char 面对面"——主语是 user，等于把戏写给了真人
- criteria 写**意图级**，不要写死具体名词：
  错误："char 说出 D 市"——user 换个说法就判不中，剧情会卡死
- antiCriteria 必填，描述明确的反意图（唯一可以写 user 反应的地方，但那是判定条件）
- 一次只判一件事，复合条件拆成两个连续阶段

${PERSONA_RESPECT}`,
    user: `当前情况：
- 用户想法：{{premise}}
- 用户指定的主目标：{{objective}}
  （若为空：请你自己构思一个主目标，所有阶段必须服务于它）
- 主角（可能不止一个，每个阶段用 actorId 指明是谁的戏）：{{protagonists}}
- 绝对禁区（用户显式设定，**优先于人物侧写里的任何禁忌**，一个都不许碰）：{{hardLimits}}
- 剧情基调（每项的百分比 = 这批阶段里该基调占的大致比例，括号里是它的含义）：{{tone}}
- 人物侧写：{{profile}}
- 世界书设定：{{world}}
{{#userPersona}}
- user 的人设（**必须尊重**：不要写出他明确反感 / 忌讳 / 过敏的东西，也不要替他做决定）：{{userPersona}}
{{/userPersona}}
{{#rejectReason}}
上一版被判定为不符合人设，原因是：{{rejectReason}}。
这一版必须避开这个具体问题；其它要求（主目标 / 剧情占比 / 硬禁区 / 演员界定）一律不变。
{{/rejectReason}}
- 已经埋下、还没回收的伏笔：{{foreshadows}}
- 近期对话：{{context}}

请生成一份分场剧本。`,
  },

  JUDGE_CHECKPOINT: {
    system: CHECKPOINT_SYSTEM,
    user: `本场目标：{{goal}}
达成条件：{{criteria}}
反意图：{{antiCriteria}}
待回收伏笔：
{{foreshadows}}

最近的对话（背景参考 —— 用来判断他是不是一直在朝这个方向走；判定主依据仍是本轮 user 消息与达成条件，别被无关闲聊带偏）：
{{context}}

user 刚才说：{{userMessage}}
角色回复：{{charMessage}}

判断这一场是否达成，并列出这一轮回收掉的伏笔编号。`,
  },

  JUDGE_STANCE: {
    system: STANCE_SYSTEM,
    user: `当前剧情方向：{{goal}}

最近的对话（背景参考 —— 判定主依据仍是 user 刚才那一句，前文只用来看他是不是在延续之前的态度）：
{{context}}

user 刚才说：{{userMessage}}

判断 user 的态度。`,
  },

  /**
   * T-426：判定合一 —— 一次调用同时返回 stance / judgement / speculation 三段，
   * 把每轮 2~3 次调用压到 1 次（站子按次计费）。
   * 三段各自独立解析、独立降级（见 llm/sections.js），任何一段坏掉不连坐其它段。
   */
  JUDGE_COMBINED: {
    system: `你要一次做完三件事，并把结果合成**一个** JSON 输出。

【第一件：态度判定】
${STANCE_SYSTEM}

【第二件：推进点判定】
${CHECKPOINT_SYSTEM}

【第三件：投机预生成（可选）】
${SPECULATE_SYSTEM}

输出要求：
- 只输出**一个** JSON 对象，不要解释、不要 markdown 代码块标记
- 结构固定为：
{ "stance": "accept|reject|hesitate|irrelevant|redirect", "confidence": 0到1之间的数,
  "judgement": { "status": "achieved|partial|pending|violated", "confidence": 0到1之间的数, "reason": "一句话理由", "recalled": [] },
  "speculation": { "guess": "≤15字意图", "keywords": ["…"], "injection": "下一轮该怎么演" } }
- judgement 与 speculation **不要求时就不要输出这两个字段**（省 token）
- 三段互不影响：某一段拿不准就按该段自己的降级规则给保守值，不要因为一段不确定就整份不作答`,
    user: `当前剧情方向：{{goal}}
达成条件：{{criteria}}
反意图：{{antiCriteria}}
待回收伏笔：
{{foreshadows}}

最近的对话（背景参考 —— 判定主依据仍是本轮 user 消息与达成条件，别被无关闲聊带偏）：
{{context}}

user 刚才说：{{userMessage}}
角色回复：{{charMessage}}

{{asks}}`,
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
    system: `${ACTOR_RULES}你是电影导演。这部戏已经演到一半，需要你接着往下写分场剧本。

输出要求：
- 只输出 JSON，不要解释，不要 markdown 代码块标记
- 严格遵循这个结构：
{ "stages": [ { "title": "阶段名", "goal": "char 这一场要达成什么", "activity": "char 要做什么（写意图，不要写成品台词）", "checkpoint": { "criteria": "达成条件（char 单方面就能完成、意图级、可观测）", "antiCriteria": "明确的反意图（必填；这里可以写 user 的反应，但它是判定条件）" }, "beats": ["char 的意图一", "char 的意图二"], "initiative": "如果冷场，char 会主动做的一件事", "actorId": "这一场由哪个主角主导（填主角列表里的名字）" } ] }
- 只写 {{count}} 个阶段，紧接着已经发生过的剧情往下走，不要重复已有阶段
- 一个阶段只推进一件事；criteria 写意图级，不要写死具体名词；antiCriteria 必填
- initiative 由「人物侧写」推导（同 GEN_OUTLINE）：侧写为空就填空字符串，不要瞎编
- 每个字段的主语都必须是 char（goal / activity / beats / criteria 全一样）；
  criteria 必须是 **char 单方面就能完成的事**（别写"user 走到某地"这种要 user 配合的）；
  只有 antiCriteria 例外：它可以写 user 的反应，但那是判定条件，不是"让 user 这样做"
- 写**意图**，不要写成**成品**：不要把台词写死（错："他打出了'随便你怎么想'这句话"；
  对："他不想多解释，冷冷地回一句"）—— 写死的成品会被原样抄进对话里

${PERSONA_RESPECT}`,
    user: `剧本：{{title}}
前提：{{premise}}
当前主目标：{{objective}}
主角（可能不止一个，每个阶段用 actorId 指明是谁的戏）：{{protagonists}}
绝对禁区（用户显式设定，优先于人物侧写里的任何禁忌）：{{hardLimits}}
剧情基调（每项的百分比 = 这批阶段里该基调占的大致比例，括号里是它的含义）：{{tone}}
人物侧写：{{profile}}
世界书设定：{{world}}
{{#userPersona}}
user 的人设（必须尊重：不要写出他明确反感 / 忌讳的东西，也不要替他做决定）：
{{userPersona}}
{{/userPersona}}
{{#rejectReason}}
上一版被判定为不符合人设，原因是：{{rejectReason}}。
这一版必须避开这个具体问题；其它要求（主目标 / 剧情占比 / 硬禁区 / 演员界定）一律不变。
{{/rejectReason}}

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
- 侧写为空 → 填空字符串，不要凭角色名瞎编
- **不许写"什么都不做""绝不主动""继续等他"这类答案**（那是冷场，不是主动性）：
  内敛角色的答案可以是试探、递个东西、换话题、多站近一步 —— 但必须是一个**真的做了的动作**`,
    user: `人物侧写：
{{profile}}
{{#userPersona}}

user 的人设（尊重它：别写他明确反感的东西）：
{{userPersona}}
{{/userPersona}}

本场目标：{{goal}}
char 的主要活动：{{activity}}
本场走位：{{beats}}

这一场如果冷场了，这个角色会主动做什么？
{{intensityNote}}`,
  },

  SPECULATE_NEXT: {
    system: `你是电影导演。user 还没开口，你要先猜他**接下来想干什么**，
并**提前把这一轮该怎么演的导演指令写好**。猜中就用，猜不中会被丢掉 —— 所以不要勉强。

输出要求：
- 只输出 JSON，不要解释，不要 markdown 代码块标记
- 结构：{ "guess": "user 的意图或方向（一句话）", "keywords": ["可能出现的词"], "injection": "如果猜中了，这一轮告诉角色该怎么演" }
- **guess 是意图/方向，不是台词**：写"user 会试探性地靠近""user 会拒绝并转移话题""user 会追问昨晚的事"
  —— 每句不超过 15 字。**绝对不要写完整台词**（写"我顺势坐下，深吸一口气，说：谢谢你…"这种整句永远猜不中）
- keywords：2 到 4 个**如果真是这个意图、他大概率会用到**的词或短语（例：意图是"拒绝" → ["算了","不必","不想"]）
- injection 写成给角色的行为指令（本场该做什么、不要做什么），不写心理描写`,
    user: `主线目标：{{objective}}
本场目标：{{goal}}
char 的主要活动：{{activity}}
本场走位：{{beats}}

user 刚说：{{userMessage}}
角色刚回：{{charMessage}}

猜猜 user 接下来想干什么（写意图，不写台词），并写好对应的导演指令。`,
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
  **禁止写"绝不主动""情感上从不主动表达"这类回避型结论** —— 那不是侧写，是把角色写死；
  卡面写了主动（会撩、会勾引、主动吸引对方）就必须照卡面写主动。
- taboo 写"绝不会做什么"，不要写"他不喜欢…"（太软，无法判定）
- attitudeToUser / intimacy 要顺带照顾到 **user 的人设**：不要写"他明知 user 讨厌 X 还偏要送 X"这类
  明显冒犯用户的互动方式（用户人设在下面）

禁止：
- 不要把角色卡原文抄进来
- 不要写成人物小传（不要生平、不要经历）
- 不要评价角色好坏

${PERSONA_RESPECT}
（写 proactivity 时尤其注意：内敛角色的主动性就是"微小动作与试探"，不要把它写成热情外放；
但"内敛"不等于"什么都不做"，更不等于"绝不主动"）`,
    user: `角色卡：
{{char}}
{{#userPersona}}

user 的人设（**必须尊重**：不要写出他明确反感、忌讳、过敏的东西，也别替他做决定）：
{{userPersona}}
{{/userPersona}}

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
