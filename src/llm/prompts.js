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
  "title": "剧本标题",
  "premise": "一句话前提",
  "stages": [
    {
      "title": "阶段名",
      "goal": "这一场要达成什么",
      "activity": "角色主要活动",
      "checkpoint": {
        "criteria": "达成条件（意图级、可观测）",
        "antiCriteria": "明确的反意图（必填）"
      },
      "beats": ["步骤一", "步骤二"]
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
- 3 到 5 个阶段，每个阶段只推进一件事
- goal 一句话说清这一场要达成什么
- beats 是角色的具体走位，2 到 4 条

推进点的写法（最关键，写错会导致剧情卡死）：
- criteria 必须是**可观测行为**，禁止心理或状态描写
- criteria 必须是**意图级**，不要写死具体名词
  正确："user 同意这次出行"
  错误："user 说出 D 市"——用户换个说法就判不中，剧情会卡死
- antiCriteria 必填，描述明确的反意图
- 一次只判一件事，复合条件拆成两个连续阶段`,
    user: `当前情况：
- 用户想法：{{premise}}
- 剧情基调：{{tone}}
- 人物侧写：{{profile}}
- 世界书设定：{{world}}
- 近期对话：{{context}}

请生成一份分场剧本。`,
  },

  JUDGE_CHECKPOINT: {
    system: `你是场记，负责判断这一场戏是否拍完了。

**按意图判断，不要字面匹配关键词。**
- user 说"好啊那就去吧"，即使没提具体地名的字面，也算达成
- 只有明确表达相反意图，才算 violated

输出 JSON（不要解释）：
{ "status": "achieved" | "partial" | "pending" | "violated", "confidence": 0到1之间的数, "reason": "一句话理由" }

档位含义：
- achieved：意图明确达成
- partial：沾边但不够明确
- pending：完全没碰到
- violated：明确表达了相反意图

confidence 填你的把握程度。**不确定就给低值** —— 系统对低 confidence 一律按推进处理，因为剧情卡住比跳一步的危害大得多。`,
    user: `本场目标：{{goal}}
达成条件：{{criteria}}
反意图：{{antiCriteria}}

user 刚才说：{{userMessage}}
角色回复：{{charMessage}}

判断这一场是否达成。`,
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
};

/**
 * 组装成 messages 数组，交给 client.request。
 * @param {'GEN_OUTLINE'|'JUDGE_CHECKPOINT'|'JUDGE_STANCE'} name
 */
export function buildMessages(name, vars = {}) {
  const template = PROMPTS[name];
  if (!template) throw new Error(`[导演时间] 未知的 prompt 模板：${name}`);

  return [
    { role: 'system', content: renderTemplate(template.system, vars) },
    { role: 'user', content: renderTemplate(template.user, vars) },
  ];
}
