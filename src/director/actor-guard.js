// 导演时间 · 演员界定兜底检查（P0 修正）
//
// 剧本只能指挥 char。user 是真人，他想什么、怎么回应，插件无权预设 ——
// 但模型偶尔还是会写出"让 user 感到……""user 决定……"这种给人写戏的句子。
//
// prompt 里已经把这条约束写死了（GEN_OUTLINE / EXTEND_OUTLINE 开头的【演员界定】），
// 这里做**本地兜底**：只在控制台报警，**不擅自改剧本、不打断生成**。
// 用户自己在 Debug 的注入全文里也能一眼看出跑偏。

/**
 * 在任何字段里都不允许的写法：在替 user 做决定、替 user 演动作。
 * 规格里点名的六种（"让 user 感到 / user 会 / user 陷入 / user 盯着 / user 决定 / user 开始"）
 * 再加一类实测最常见的形式："user 在房间里来回踱步" —— 同样是给人写戏。
 */
export const USER_PRESCRIBING = [
  /让\s*user/i,
  /让\s*用户/,
  /user\s*(会|将|陷入|盯着|决定|开始|感到|变得|应该)/i,
  /用户\s*(会|将|陷入|盯着|决定|开始|感到|变得|应该)/,
  /user\s*(在|正在)/i,
  /用户\s*(在|正在)/,
];

/** antiCriteria 是唯一例外：它要描述 user 的反应（判定条件），但同样不许"让 user 这样做" */
export const USER_PRESCRIBING_IN_ANTI = [
  /让\s*user/i,
  /让\s*用户/,
  /user\s*应该/i,
  /用户\s*应该/,
];

/**
 * "不让 user 回避" / "不要让 user 被晾着" 是**禁止**预设 user —— 恰恰是我们要的写法，
 * 不能误判。所以先把"否定 + 让 user"这种片段抹掉再查。
 */
function stripNegatedPrescribing(text) {
  return String(text ?? '').replace(/[不别勿莫没]要?\s*让\s*(?:user|用户)/gi, '');
}

function scan(text, patterns, field, stageIndex, issues) {
  const value = String(text ?? '');
  if (!value.trim()) return;
  const probe = stripNegatedPrescribing(value);
  for (const pattern of patterns) {
    const hit = probe.match(pattern);
    if (hit) {
      issues.push({ stageIndex, field, text: value, pattern: String(pattern), hit: hit[0] });
      return; // 一个字段报一次就够
    }
  }
}

/**
 * 找出"在指挥 user"的字段。
 * @returns {Array<{stageIndex: number, field: string, text: string, pattern: string, hit: string}>}
 */
export function findUserDirectives(stages = []) {
  const issues = [];
  (Array.isArray(stages) ? stages : []).forEach((stage, stageIndex) => {
    scan(stage?.goal, USER_PRESCRIBING, 'goal', stageIndex, issues);
    scan(stage?.activity, USER_PRESCRIBING, 'activity', stageIndex, issues);
    scan(stage?.initiative, USER_PRESCRIBING, 'initiative', stageIndex, issues);
    (stage?.beats ?? []).forEach((beat, index) => scan(beat, USER_PRESCRIBING, `beats[${index}]`, stageIndex, issues));
    scan(stage?.checkpoint?.criteria, USER_PRESCRIBING, 'checkpoint.criteria', stageIndex, issues);
    scan(stage?.checkpoint?.antiCriteria, USER_PRESCRIBING_IN_ANTI, 'checkpoint.antiCriteria', stageIndex, issues);
  });
  return issues;
}

/**
 * §七：剧本里写死了"成品"（台词、完整句子）→ 模型会原样抄进对话，指令就露馅了。
 * 只认"引用/说出+引号"这类痕迹，不误伤正常叙述。
 */
export const FINISHED_LINE_PATTERNS = [
  // 引号里包着一整句（中英文引号都算）—— 用 \u 转义，免得被编辑器/编码偷偷换掉
  /[\u201c"][^\u201c\u201d"]{2,}[\u201d"]/,
  /[\u2018'][^\u2018\u2019']{2,}[\u2019']/,
  /[「『][^」』]{2,}[」』]/,
  // "他说：xxx" / "他问：xxx" —— 冒号后面就是成品台词
  /(说|问|答|吼|喊|道)[:：]\s*\S/,
];

/** 找出把台词写死的字段（同上：只报警，不改剧本） */
export function findFinishedLines(stages = []) {
  const issues = [];
  (Array.isArray(stages) ? stages : []).forEach((stage, stageIndex) => {
    const fields = [
      ['goal', stage?.goal],
      ['activity', stage?.activity],
      ...(stage?.beats ?? []).map((beat, index) => [`beats[${index}]`, beat]),
      ['checkpoint.criteria', stage?.checkpoint?.criteria],
    ];
    for (const [field, value] of fields) {
      const text = String(value ?? '');
      if (!text.trim()) continue;
      for (const pattern of FINISHED_LINE_PATTERNS) {
        const hit = text.match(pattern);
        if (hit) {
          issues.push({ stageIndex, field, text, pattern: String(pattern), hit: hit[0] });
          break;
        }
      }
    }
  });
  return issues;
}

/** 报警文案（控制台用） */
export function describeIssues(issues = []) {
  return issues
    .map((issue) => `阶段${issue.stageIndex + 1}.${issue.field} 写了 user 的戏：「${issue.hit}」→ ${issue.text}`)
    .join('\n');
}
