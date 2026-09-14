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

/**
 * 描写词 / 抽象名词：**任何情况下都不算角色**（强证据命中也不收）。
 *
 * 2026-09-14 实机：用户看到「温柔」「底色」出现在候选里。
 * 「温」本身是姓氏，「温柔」靠姓氏表拦不住 —— 只能显式点名。
 * 这里只放**几乎不会当人名**的词（「希望」「光明」这类能当名字的**不收**，
 * 万一真有同名角色还有手填框兜底）。
 */
export const ABSTRACT_NOUNS = new Set([
  '温柔', '底色', '冷漠', '冰冷', '温暖', '孤独', '悲伤', '愤怒', '恐惧', '痛苦',
  '尴尬', '平静', '神秘', '危险', '美丽', '优雅', '高贵', '丑陋', '真实', '虚假',
  '表面', '本质', '气氛', '氛围', '情绪', '状态', '情况', '变化', '过程', '意义',
  '价值', '力量', '能力', '存在', '距离', '关系', '内心', '外表', '命运', '灵魂',
  '阴影', '黑暗', '寒冷', '潮湿', '柔软', '坚硬', '明亮', '昏暗', '寂静', '绝望',
  '世界', '故事', '时间', '空间', '记忆', '过去', '未来', '现在', '命运', '规则',
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

/**
 * 常见中文姓氏（单姓取篇幅，够用即可）。
 *
 * 为什么需要它：2026-09-14 实机反馈 —— 界面上冒出了「温柔」「底色」这种词。
 * 根因是 `XX的` 这条弱规则：`温柔的底色` 会被当成候选 `温柔`。
 * **中文人名几乎必含姓氏字**，用姓氏表一拦，形容词/普通名词基本挡在外面。
 * 西式译名、日文名不一定有（例如「艾拉」），所以这里是**降级为弱证据**，
 * 不是直接丢掉 —— 宁漏勿噪，但也别把真角色扔了。
 */
export const CHINESE_SURNAMES = new Set([...(
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章'
  + '云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝安常乐于'
  + '时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒'
  + '屈项祝董梁杜阮蓝闵席季麻强贾路娄江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯'
  + '管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊惠甄曲家'
  + '封芮储靳邴松井段富巫乌焦巴弓牧山谷车侯全班仰秋仲伊宫宁仇栾甘厉戎祖武符刘景詹束龙'
  + '叶幸司韶黎薄印宿白怀蒲从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟贡劳姬申扶堵冉宰'
  + '郦雍桑桂濮牛寿通边燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居'
  + '衡步都耿满弘匡国文寇广禄阙东欧沃利蔚越隆师巩聂晁冷辛阚那简饶空曾沙养鞠须丰巢关蒯'
  + '相查后荆红游权盖益桓公上官令狐'
)].filter((ch) => ch));

/** 复姓（两个字）*/
const COMPOUND_SURNAMES = ['欧阳', '太史', '端木', '上官', '司马', '东方', '独孤', '南宫', '万俟', '闻人',
  '夏侯', '诸葛', '尉迟', '公孙', '赫连', '澹台', '皇甫', '宗政', '濮阳', '公冶', '太叔', '申屠',
  '慕容', '长孙', '宇文', '司徒', '司空', '轩辕', '钟离', '闾丘', '亓官', '鲜于'];

/**
 * 纯汉字名的"像不像人名"打分。
 * @returns {'likely'|'unlikely'} unlikely = 降级到弱证据（不是丢掉）
 */
function looksLikeChineseName(raw) {
  const name = normalizeCastName(raw).replace(/[\s·・]/g, '');
  if (!/^[\u4e00-\u9fff]{2,4}$/.test(name)) return 'likely'; // 含英文/日文/间隔号的不查姓，放过
  for (const prefix of COMPOUND_SURNAMES) {
    if (name.startsWith(prefix)) {
      return name.length >= 3 ? 'likely' : 'unlikely'; // 复姓后面至少还得有一个字
    }
  }
  return CHINESE_SURNAMES.has(name[0]) ? 'likely' : 'unlikely';
}

// ---------- 抽取规则（规格 §3.1，按优先级）----------
//
// 2026-09-14 改：**分级**。以前所有规则一视同仁 → 「温柔」「底色」混进候选。
// · 强证据（$STRONG）：行首标签式 / 引号前主语 / 已知名单 —— 直接进候选区
// · 弱证据（$WEAK）：`XX的` `XX说` —— 只进「可能是人名（弱证据）」，默认折叠
export const STRENGTH_STRONG = 'strong';
export const STRENGTH_WEAK = 'weak';

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
  if (ABSTRACT_NOUNS.has(name)) return false; // 「温柔」这种：姓氏表拦不住，显式点名
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

  // ① 行首标签式 —— 强证据
  for (const match of text.matchAll(LABEL_RE)) {
    const offset = match.index + match[0].search(/[^\s\u3000]/);
    out.push([stripTrailingVerb(match[1]), offset, STRENGTH_STRONG]);
  }

  // ② 引号前主语（`艾拉低声说：“…”`）—— 强证据
  QUOTE_OPEN_RE.lastIndex = 0;
  let quote;
  while ((quote = QUOTE_OPEN_RE.exec(text))) {
    const headStart = Math.max(0, quote.index - 12);
    const head = text.slice(headStart, quote.index).replace(TRAILING_PUNCT_RE, '');
    const run = head.match(new RegExp(`([${NAME_CHARS}·]{1,10})$`))?.[1];
    if (!run || !VERB_SUFFIX_RE.test(run)) continue;
    const name = stripTrailingVerb(run);
    if (!name || name === normalizeCastName(run)) continue; // 剥不掉动词 = 那不是"谁在说"
    out.push([name, headStart + head.length - run.length, STRENGTH_STRONG]);
  }

  // ③ 称谓模式：XX 说 / XX 问 / XX 笑了 / XX 看着 —— **强证据**
  //    只要后面真跟着说话/动作动词，主语是角色的把握很高（"温柔笑了"几乎不会出现在正文里）
  for (const match of text.matchAll(TITLE_VERB_RE)) {
    out.push([normalizeCastName(match[1]), match.index, STRENGTH_STRONG]);
  }
  // ③ 称谓模式：XX 的 —— **唯一的重灾区**（`温柔的底色` 就出自这条），永远只算弱证据
  for (const match of text.matchAll(TITLE_OF_RE)) {
    out.push([normalizeCastName(match[1]), match.index, STRENGTH_WEAK]);
  }

  return out;
}

/**
 * 一个名字该排在哪个档 —— 返回 `null` 表示该丢掉。
 *
 * | 命中的规则 | 像中文人名 | 结果 |
 * |---|---|---|
 * | 强（行首标签 / 引号主语） | 是 | strong |
 * | 强 | 不像（如西式译名） | weak（降级，不丢） |
 * | 弱（`XX的` / `XX说`） | 是 | weak |
 * | 弱 | 不像 | **丢弃** ← 「温柔」「底色」走这条 |
 */
function grade(name, strength) {
  if (!isCastNameCandidate(name)) return null;
  if (strength === STRENGTH_STRONG) return STRENGTH_STRONG;
  // 走到这里 = 只命中了 `XX的`。中文里"XX的"太常见（温柔的底色 / 成功的阈值），
  // 所以姓氏表过不了就丢掉 —— 用户看到的「温柔」「底色」全出自这条。
  // 反过来：动词 / 行首标签 / 引号主语命中的**一律不查姓氏**（西式译名如「莉泽」
  // 根本不在百家姓里，查了会把真角色误杀，试过一次，不能再来）。
  return looksLikeChineseName(name) === 'likely' ? STRENGTH_WEAK : null;
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

  // ① 第一遍：按规则找出"谁是角色"，并按证据强弱分档
  const nameSet = new Set();
  const strength = new Map(); // name → strong / weak
  for (const item of list) {
    for (const [name, , hitStrength] of ruleHits(String(item.content))) {
      const graded = grade(name, hitStrength);
      if (!graded) continue; // 「温柔」「底色」这类在这里被丢掉
      // 一条规则说 strong、另一条说 weak → 取 strong（宁可让用户看到）
      if (!strength.has(name) || strength.get(name) === STRENGTH_WEAK) strength.set(name, graded);
      nameSet.add(name);
    }
  }
  // 已知名单（主角 / 当前生成者）无条件进强证据区
  for (const name of knownSet) {
    nameSet.add(name);
    strength.set(name, STRENGTH_STRONG);
  }
  if (!nameSet.size) {
    return { detected: [], weak: [], total: 0, weakTotal: 0, truncated: false, weakTruncated: false, scanned: list.length };
  }

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

  const shape = (item) => ({
    name: item.name,
    count: item.count,
    known: knownSet.has(item.name),
    sources: [...item.sources.values()],
  });

  // 强证据 = 默认展示的候选；弱证据单独给一组，界面默认折叠（宁漏勿噪，但不丢）
  const strongAll = all.filter((item) => strength.get(item.name) === STRENGTH_STRONG);
  const weakAll = all.filter((item) => strength.get(item.name) !== STRENGTH_STRONG);
  const detected = strongAll.slice(0, max).map(shape);
  const weak = weakAll.slice(0, max).map(shape);

  return {
    detected,
    weak,
    total: strongAll.length,
    weakTotal: weakAll.length,
    truncated: strongAll.length > detected.length,
    weakTruncated: weakAll.length > weak.length,
    scanned: list.length,
  };
}
