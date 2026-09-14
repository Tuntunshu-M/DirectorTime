// 导演时间 · T-437 世界书角色识别（**本地规则抽取，零 API 调用**）
//
// 规格：`规格-T437-世界书角色识别.md`
//   只扫**当前已勾选**的世界书条目文本 → 本地抽出里面提到的角色
//   → 候选清单（带出现次数 + 出处）→ **交给用户勾选，绝不自动设为主角**。
//
// 为什么是"本地规则"而不是模型：用户按次计费，扫描必须零调用。
// 规则漏了有手填兜底（人物页那个输入框）；乱调 API 是实打实花钱。
// 所以这个文件只有正则 + 词表，**不 import client，不 fetch**。

/** 候选上限（超出的折叠成「还有 N 个」） */
export const WORLD_CAST_LIMIT = 30;
/** 名字长度：2~6 字（**已知名单豁免** —— 主角 / 当前生成者必须认得出） */
export const WORLD_CAST_MIN_LEN = 2;
export const WORLD_CAST_MAX_LEN = 6;

/**
 * 停用词：这些词长得像名字但不是角色。
 * 用户原话是"噪声比漏检更烦人"，所以这里宁可多列。
 */
export const WORLD_CAST_STOPWORDS = new Set([
  '世界', '故事', '现在', '他们', '她们', '我们', '你们', '自己', '对方', '双方',
  '时间', '内容', '设定', '背景', '人物', '角色', '以上', '以下', '之前', '之后',
  '以后', '以前', '同时', '然后', '接着', '于是', '突然', '终于', '似乎', '好像',
  '仿佛', '大概', '也许', '当然', '其实', '只是', '还是', '就是', '因为', '所以',
  '如果', '虽然', '但是', '可是', '不过', '而且', '其它', '其他', '一切', '所有',
  '部分', '全部', '名字', '身份', '关系', '情况', '问题', '办法', '结果', '原因',
  '道理', '意思', '事情', '东西', '时候', '地方', '哪里', '这里', '那里', '这个',
  '那个', '什么', '怎么', '为什么', '眼睛', '目光', '声音', '语气', '表情', '动作',
  '心里', '脸上', '身上', '手中', '门口', '窗外', '房间', '空气', '夜色', '气氛',
  '感觉', '想法', '记忆', '过去', '未来', '开始', '结束', '注意', '重要', '可能',
  '需要', '应该', '不能', '没有', '不是', '一个', '两个', '知道', '不知', '一样',
  '十分', '非常', '已经', '正在', '一直', '再次', '继续', '立刻', '马上', '缓缓',
  '轻轻', '淡淡', '冷冷', '默默', '备注', '注释', '说明', '简介', '概括', '总结',
  '提示', '登场', '出场',
  // 动作词本身不是名字（`艾拉低声说` 要剥成 `艾拉`）
  '低声', '低语', '沉默', '看着', '说道', '开口', '回答', '反问', '追问', '抬头',
  '低头', '转身', '点头', '摇头', '皱眉', '叹气', '冷笑', '笑了', '笑着',
]);

/** 名字里带这些字一定不是人名（的/了/着/是/在/和/与/为 都是纯虚词） */
const FUNCTION_CHARS = /[\u7684\u4e86\u7740\u662f\u5728\u548c\u4e0e\u4e3a]/;
/** 组织 / 地点不是"可攻略的角色"（`裴氏集团` `洛佩兹的庄园` 这类） */
const NON_PERSON_SUFFIX = /(集团|公司|家族|世家|学院|学校|组织|协会|商会|教会|门派|帮派|军队|部队|王国|帝国|联邦|庄园|城堡|公馆|别墅|宅邸|城镇|村庄|城市|基地|中心)$/;
/** 以代词 / 指示词 / 副词开头的不是名字（他…… / 这…… / 谁也…… / 不知……） */
const PRONOUN_START = /^[\u4ed6\u5979\u5b83\u6211\u4f60\u60a8\u54b1\u8fd9\u90a3\u54ea\u8c01\u4e0d\u6ca1\u522b\u65e0\u5f88\u592a\u66f4\u6700\u90fd\u4e5f\u8fd8\u5c31\u624d\u53c8\u518d\u5df2\u7adf\u751a\u81f3\u5219\u800c\u5374]/;
/** 章节标题不是角色名：第一章 / 第三幕 / 第二场 */
const CHAPTER_TITLE = /^第[0-9一二三四五六七八九十百千]+[章节回幕场次篇讲]$/;
/** 名字里至少得有中日文 / 假名 / 英文字母（纯数字、纯符号丢掉） */
const HAS_NAME_CHAR = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afA-Za-z]/;
/** 名字允许出现的字符（捕获用） */
const NAME_CHARS = '\u4e00-\u9fff\u3040-\u30ffA-Za-z';

// ---------- 抽取规则（规格 §3.1，按优先级）----------

/**
 * 说话/动作词。**长词必须排前面**，否则 `笑了笑` 会被 `笑` 抢先匹配。
 * 规则②（引号前主语）与规则③（称谓模式）共用同一份。
 */
const VERB_ALT = [
  '低声说', '笑了笑', '点着头', '低声', '低语', '看着', '沉默', '说道', '笑了', '笑着',
  '嘱咐', '提醒', '冷笑', '叹气', '皱眉', '点头', '摇头', '回答', '开口',
  '说', '道', '问', '答', '笑', '喊',
].join('|');

/** ① 行首标签式：`名字：` / `名字——` / `名字 -`（世界书最常见的角色条目写法） */
const LABEL_RE = new RegExp(
  `^[\\t\\u3000 ]*([^\\n\\r：:，。！？；、（）()\\[\\]【】“”"'「」『』]{2,10}?)[\\t\\u3000 ]*(?:[：:]|[-—－]{1,2})`,
  'gm',
);
/** ② 引号前的主语：`“…”` 前面那截以动词收尾的名字 */
const QUOTE_OPEN_RE = /[“"「『]/g;
/** 动词尾缀：要**反复剥**（`艾拉低声说` → `艾拉低声` → `艾拉`） */
const VERB_SUFFIX_RE = new RegExp(`(${VERB_ALT})(着|道|了)?$`);
/** 引号前面可能夹着的标点（`艾拉说：“…”` 里那个冒号） */
const TRAILING_PUNCT_RE = /[\s\u3000，,：:、；;]+$/;
/** ③ 称谓模式：`XX 说` `XX 问` `XX 笑了` `XX 看着` */
const TITLE_VERB_RE = new RegExp(`([${NAME_CHARS}]{2,6}?)(?:${VERB_ALT})`, 'g');
/** ③ 称谓模式：`XX 的`（后接汉字才算） */
const TITLE_OF_RE = new RegExp(`([${NAME_CHARS}]{2,6})的(?=[${NAME_CHARS}])`, 'g');

/** 去掉首尾空白与分隔符，中间空白压成一个空格（`管家 · 莫兰` 这种写法要留住） */
export function normalizeCastName(raw) {
  return String(raw ?? '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
    .replace(/^[·、\-—－ ]+/, '')
    .replace(/[·、\-—－ ]+$/, '');
}

/** 数"名字本体"几个字：空格与间隔号不算（`管家 · 莫兰` = 5 字） */
function coreLength(name) {
  return [...String(name).replace(/[\s·・]/g, '')].length;
}

/** 剥掉名字尾部的动词（`艾拉低声说` → `艾拉`）；剥空了就返回空串 */
export function stripTrailingVerb(raw) {
  let name = normalizeCastName(raw);
  for (let i = 0; i < 4; i += 1) {
    const verb = name.match(VERB_SUFFIX_RE)?.[0];
    if (!verb || verb.length >= name.length) break;
    name = normalizeCastName(name.slice(0, name.length - verb.length));
  }
  return name;
}

/**
 * 这个名字收不收（长度 / 字符 / 停用词 / 虚词 / 章节标题）。
 * 已知名单不走这里（见 acceptKnown）——主角名哪怕 1 个字也得认出来。
 */
export function isCastNameCandidate(raw) {
  const name = normalizeCastName(raw);
  if (!name) return false;
  const len = coreLength(name);
  if (len < WORLD_CAST_MIN_LEN || len > WORLD_CAST_MAX_LEN) return false;
  if (!HAS_NAME_CHAR.test(name)) return false;
  if (WORLD_CAST_STOPWORDS.has(name)) return false;
  if (CHAPTER_TITLE.test(name)) return false;
  if (FUNCTION_CHARS.test(name)) return false;
  if (PRONOUN_START.test(name)) return false;
  if (NON_PERSON_SUFFIX.test(name)) return false;
  return true;
}

/** 已知名单（主角 / 当前生成者）豁免长度与停用词，只要求是个像名字的串 */
function acceptKnown(raw) {
  const name = normalizeCastName(raw);
  return Boolean(name) && HAS_NAME_CHAR.test(name);
}

/** 正则里的字面量转义（已知名单要按原样搜正文） */
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从**一段文本**里挖出候选（名字 + 下标）。
 * 返回 `[[name, index], ...]`；同一位置被多条规则命中时由调用方用 Set 去重。
 */
function ruleHits(text) {
  const out = [];

  // ① 行首标签式
  for (const match of text.matchAll(LABEL_RE)) {
    const offset = match.index + match[0].search(/[^\s\u3000]/);
    out.push([stripTrailingVerb(match[1]), offset]);
  }

  // ② 引号前主语（`艾拉低声说：“…”`）
  QUOTE_OPEN_RE.lastIndex = 0;
  let quote;
  while ((quote = QUOTE_OPEN_RE.exec(text))) {
    const headStart = Math.max(0, quote.index - 12);
    const head = text.slice(headStart, quote.index).replace(TRAILING_PUNCT_RE, '');
    const run = head.match(new RegExp(`([${NAME_CHARS}·]{1,10})$`))?.[1];
    if (!run || !VERB_SUFFIX_RE.test(run)) continue;
    const name = stripTrailingVerb(run);
    if (!name || name === normalizeCastName(run)) continue; // 剥不掉动词 = 那不是"谁在说"
    out.push([name, headStart + head.length - run.length]);
  }

  // ③ 称谓模式：XX 说 / XX 问 / XX 笑了 / XX 看着
  for (const match of text.matchAll(TITLE_VERB_RE)) {
    out.push([normalizeCastName(match[1]), match.index]);
  }
  // ③ 称谓模式：XX 的
  for (const match of text.matchAll(TITLE_OF_RE)) {
    out.push([normalizeCastName(match[1]), match.index]);
  }

  return out;
}

/**
 * **核心**：扫一批条目文本，抽出里面的角色候选。
 *
 * @param {Array<{content?: string, name?: string, key?: string, bookName?: string, sourceType?: string, sourceLabel?: string}>} entries
 *        只该传**当前已勾选**的条目（调用方负责过滤；本函数不读世界书、不发请求）
 * @param {{ known?: string[], limit?: number }} options
 *        `known` = 当前主角 + 当前生成者名（直接命中且排最前）
 * @returns {{ detected: Array<{name: string, count: number, known: boolean, sources: Array}>, total: number, truncated: boolean, scanned: number }}
 */
export function extractWorldCast(entries = [], { known = [], limit = WORLD_CAST_LIMIT } = {}) {
  const list = (entries ?? []).filter((item) => String(item?.content ?? ''));
  const knownSet = new Set((known ?? []).map(normalizeCastName).filter(acceptKnown));
  const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : WORLD_CAST_LIMIT;

  // ① 第一遍：按规则找出"谁是角色"（行首标签 / 引号主语 / 称谓 / 已知名单）
  const nameSet = new Set();
  for (const item of list) {
    for (const [name] of ruleHits(String(item.content))) {
      if (isCastNameCandidate(name)) nameSet.add(name);
    }
  }
  for (const name of knownSet) nameSet.add(name);
  if (!nameSet.size) return { detected: [], total: 0, truncated: false, scanned: list.length };

  /**
   * ② 第二遍：把认出来的名字在全篇里的**每一次出现**都数上（含"莉泽提起过艾拉"这种裸提）
   * —— 这样界面上的"出现 N 次"跟用户手动数一遍能对上（验收判据）。
   * 长名字排前面，免得 `罗德里戈二世` 被短的 `罗德里戈` 抢走。
   */
  const combined = new RegExp(
    [...nameSet].sort((a, b) => b.length - a.length).map(escapeRe).join('|'),
    'g',
  );

  const found = new Map(); // name → { name, count, firstSeq, sources: Map(key → source) }
  let seq = 0;
  for (const item of list) {
    const text = String(item.content);

    /** 一条条目里"名字 → 出现过的下标集合"（同一位置被多条规则命中只算一次） */
    const indexes = new Map();
    combined.lastIndex = 0;
    let hit;
    while ((hit = combined.exec(text))) {
      const name = hit[0];
      if (!indexes.has(name)) indexes.set(name, new Set());
      indexes.get(name).add(hit.index);
      if (combined.lastIndex === hit.index) combined.lastIndex += 1; // 空匹配保护
    }

    for (const [name, set] of indexes) {
      if (!found.has(name)) found.set(name, { name, count: 0, firstSeq: Infinity, sources: new Map() });
      const record = found.get(name);
      record.count += set.size;
      record.firstSeq = Math.min(record.firstSeq, seq + Math.min(...set));
      const sourceKey = String(item?.key ?? item?.entryKey ?? `${item?.bookName ?? ''}::${item?.name ?? ''}`);
      if (!record.sources.has(sourceKey)) {
        record.sources.set(sourceKey, {
          entryKey: String(item?.key ?? item?.entryKey ?? ''),
          entryName: String(item?.name ?? ''),
          bookName: String(item?.bookName ?? ''),
          sourceType: String(item?.sourceType ?? ''),
          sourceLabel: String(item?.sourceLabel ?? ''),
        });
      }
    }
    seq += text.length + 1; // 跨条目保持"先后"可比
  }

  // 排序：已知名单（主角 / 当前生成者）排最前 → 出现次数降序 → 首次出现位置
  const all = [...found.values()].sort((a, b) => {
    const knownDiff = (knownSet.has(a.name) ? 0 : 1) - (knownSet.has(b.name) ? 0 : 1);
    if (knownDiff) return knownDiff;
    if (b.count !== a.count) return b.count - a.count;
    return a.firstSeq - b.firstSeq;
  });

  const detected = all.slice(0, max).map((item) => ({
    name: item.name,
    count: item.count,
    known: knownSet.has(item.name),
    sources: [...item.sources.values()],
  }));

  return {
    detected,
    total: all.length,
    truncated: all.length > detected.length,
    scanned: list.length,
  };
}
