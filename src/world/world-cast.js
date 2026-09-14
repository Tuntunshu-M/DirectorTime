// 导演时间 · T-437 世界书角色识别（**本地规则抽取，零 API 调用**）
//
// 规格：`规格-T437-世界书角色识别.md`
//   只扫**当前已勾选**的世界书条目文本 → 本地抽出里面提到的角色
//   → 候选清单（带出现次数 + 出处）→ **交给用户勾选，绝不自动设为主角**。
//
// 为什么是"本地规则"而不是模型：用户按次计费，扫描必须零调用。
// 规则漏了有手填兜底（人物页那个输入框）；乱调 API 是实打实花钱。
// 所以这个文件只有正则 + 词表，**不 import client，不 fetch**。
//
// ============================================================================
// 2026-09-14 第二次实机修复（维护者："这些是它识别出来的全部'人名'……识别个人名就那么困难吗"）
//
// 现象：候选里全是 `名称 / 代号 / 性别 / 年龄 / 外貌 / 性格 / 关系描述 / 表达方式 / 角色阶段 …`
//       —— **全是设定卡的"栏目名"**，一个真名都没几个。
// 根因（已复现，见 `bugfix-0914-世界书人名误判.md`）：
//   世界书条目绝大多数是**设定卡写法**（每行 `字段名：值`），
//   而本文件原来的规则①把"行首 `XX：`"**无条件当人名**、还给了强证据 → 整片栏目名进候选。
// 修法（三条结构性的，不再靠"往停用词表里加词"打地鼠）：
//   ① **行首标签要先过"字段名"筛**：词表 + 统计（栏目名会跨条目/反复出现，人名不会）+ 设定卡块；
//   ② **删掉 `XX 的`**：`喜欢用黑色` / `陈旧血迹` 这种半句噪声全是它造的，真信号远小于噪声；
//   ③ **单破折号不再当分隔符**（`布满深浅不-的疤痕` 就是这么来的）—— 只认 `：` 与 `——`；
//   另外补上真信号：`【裴玉】` / `[裴玉]` / `### 裴玉` 这种"角色小标题"（以前完全不认）。
// ============================================================================

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
  // 人数词 / 群体词（有了 `盯着` 这类动词之后，`两人盯着` 会被误当主语）
  '两人', '三人', '几人', '众人', '旁人', '一人', '所有人', '大家', '双方',
  // 动作词本身不是名字（`艾拉低声说` 要剥成 `艾拉`）
  '低声', '低语', '沉默', '看着', '说道', '开口', '回答', '反问', '追问', '抬头',
  '低头', '转身', '点头', '摇头', '皱眉', '叹气', '冷笑', '笑了', '笑着',
]);

/**
 * 描写词 / 抽象名词：**任何情况下都不算角色**（强证据命中也不收）。
 *
 * 2026-09-14 实机：用户看到「温柔」「底色」出现在候选里。
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

/**
 * **设定卡的"栏目名"**（2026-09-14 第二次修复的主角）。
 *
 * 世界书条目绝大多数是"每行 `栏目名：值`"的设定卡 —— 这些栏目名**永远不可能是角色名**，
 * 但原来的规则①会把它们全部当成人名（维护者看到的那几十个假人名就是它们）。
 *
 * 维护者原话（2026-09-14）："这些是它识别出来的全部'人名'，实际上除了裴玉、伯伯、哥哥、
 * 父亲、母亲、Lobo 之外都不是人名"。左边那一串就是这张表要拦的东西。
 *
 * ⚠️ 只放**确定不会当人名**的栏目名。像 `管家` `长老` `主母` 这种"能当角色的称谓"**不放**；
 *    `希望` `光明` `阳光` 这类能当名字的也不放。
 */
export const WORLD_FIELD_LABELS = new Set([
  // —— 身份 / 档案
  '名称', '姓名', '代号', '别名', '昵称', '真名', '头衔', '身份', '核心身份', '角色档案',
  '角色设定', '角色定位', '角色阶段', '角色关系', '人物档案', '人物设定', '基本信息',
  '基础信息', '个人资料', '档案', '设定', '总览', '概览',
  // —— 生理 / 外貌
  '性别', '年龄', '生日', '身高', '体重', '体型', '身材', '种族', '物种', '职业',
  '外貌', '面部', '五官', '脸型', '脸部', '发型', '发色', '瞳色', '眼睛', '眼神',
  '肤色', '遮面', '特征', '主要特征', '标志', '特殊', '气质', '印象', '形态', '模式',
  '气味', '体味', '香味', '味道', '气息', '香型', '嗓音', '口音', '语速', '音色',
  '睫毛', '眉毛', '胡须', '疤痕', '伤痕', '纹身', '体格', '肩宽', '体态', '步态',
  // —— 穿着
  '服饰', '服装', '穿着', '衣装', '上衣', '上身', '下身', '下装', '鞋履', '鞋子',
  '配饰', '饰品', '主色调', '配色', '色调', '风格',
  // —— 性格 / 心理
  '性格', '性格调色盘', '性格特点', '个性', '心理', '内心', '三观', '价值观', '世界观',
  '优点', '缺点', '长处', '短处', '喜好', '偏好', '厌恶', '爱好', '兴趣', '癖好',
  '习惯', '小习惯', '作息', '日程', '日常', '生活', '知识盲区', '盲区', '弱点',
  '软肋', '秘密', '禁忌', '底线', '原则', '信条',
  // —— 能力 / 关系 / 经历
  '能力', '技能', '特长', '擅长', '武器', '道具', '语言', '语调', '声音', '口头禅',
  '说话方式', '表达方式', '对话示例', '示例对话', '台词', '语气', '称谓',
  '关系', '关系描述', '人际关系', '人物关系', '亲属', '家人', '家庭成员', '朋友',
  '敌人', '阵营', '立场', '归属', '出身', '来历', '背景', '经历', '过往', '履历',
  '目标', '动机', '动机与目标', '欲望', '执念', '变化倾向', '倾向', '阶段',
  // —— 世界观 / 剧情 / 杂项
  '世界', '世界观', '设定集', '规则', '势力', '组织', '团体', '家族', '地点', '场景',
  '时间线', '剧情', '事件', '简介', '概述', '概括', '总结', '重点', '提要', '描述',
  '描写', '细节', '补充', '补充说明', '扩展', '二次解释', '备注', '注释', '说明',
  '提示', '注意', '属性', '数据', '参数', '标签',
]);

/**
 * **亲属 / 角色称谓**（`关系描述：与伯伯、哥哥、父亲、母亲`）—— 直接命中就是角色。
 *
 * 为什么单独列：设定卡里"关系"那一行往往是**配角唯一出现的地方**，
 * 而角色卡里这些人常常**没有名字**（就叫"伯伯""管家"），用户恰恰可能想攻略他们。
 * 这些词不可能是栏目名，所以是白名单式的高置信信号（维护者的清单里就认了
 * 裴玉 / 伯伯 / 哥哥 / 父亲 / 母亲 这五个，这一条把后四个捞回来）。
 */
export const KINSHIP_TERMS = new Set([
  '父亲', '母亲', '爸爸', '妈妈', '哥哥', '弟弟', '姐姐', '妹妹', '兄长', '长姐',
  '伯伯', '叔叔', '舅舅', '姑姑', '姨妈', '爷爷', '奶奶', '外公', '外婆', '祖父', '祖母',
  '继父', '继母', '养父', '养母', '继兄', '继妹', '表哥', '表姐', '堂哥', '堂妹',
  '管家', '女仆', '男仆', '仆人', '侍女', '佣人', '司机', '秘书', '助理', '保镖',
  '家主', '族长', '主公', '上司', '老板', '老板娘', '老师', '同学', '室友',
]);

/**
 * **身份字段**：命中这些栏目名时，**冒号后面那截"值"本身就是角色名**（T-438 增量一）。
 *
 * 为什么单独处理：设定卡的写法就是 `代号：Lobo` —— 栏目名 `代号` 该被拦掉（对），
 * 但**值 `Lobo` 是角色**（用户原话："lobo 还是个花名"，意思是它是角色，只是花名）。
 * 2026-09-14 的修复把整行丢掉了 → `Lobo` 漏检。这张表就是把它捞回来的通道。
 *
 * ⚠️ **只对这张表里的标签生效** —— 其它字段的值一律不捞（`性格：冷酷` 不能产出"冷酷"）。
 */
export const IDENTITY_FIELD_LABELS = new Set([
  '名称', '名字', '姓名', '真名', '本名', '原名', '全名',
  '代号', '花名', '化名', '别名', '昵称', '外号', '绰号',
  '英文名', '英文', 'ID', 'id',
]);

/** 身份字段那一行：`名称：裴玉` / `别名：夜莺 / 老K` */
const IDENTITY_LINE_RE = new RegExp(
  `^[\\t\\u3000 ]*(${[...IDENTITY_FIELD_LABELS].sort((a, b) => b.length - a.length).join('|')})[\\t\\u3000 ]*[：:][\\t\\u3000 ]*(.+)$`,
  'gmi',
);
/** 身份字段的值里，这些是"多人分隔符"（`别名：夜莺 / 老K` / `与伯伯、哥哥`） */
const IDENTITY_SPLIT_RE = /[、，,；;/｜|]|与|和|及/;

/** 名字里带这些字一定不是人名（的/了/着/是/在/和/与/为 都是纯虚词） */
const FUNCTION_CHARS = /[\u7684\u4e86\u7740\u662f\u5728\u548c\u4e0e\u4e3a]/;
/** 组织 / 地点不是"可攻略的角色"（`裴氏集团` `洛佩兹的庄园` 这类） */
const NON_PERSON_SUFFIX = /(集团|公司|家族|世家|学院|学校|组织|协会|商会|教会|门派|帮派|军队|部队|王国|帝国|联邦|庄园|城堡|公馆|别墅|宅邸|城镇|村庄|城市|基地|中心)$/;
/** 以代词 / 指示词 / 副词开头的不是名字（他…… / 这…… / 谁也…… / 不知……） */
const PRONOUN_START = /^[\u4ed6\u5979\u5b83\u6211\u4f60\u60a8\u54b1\u8fd9\u90a3\u54ea\u8c01\u4e0d\u6ca1\u522b\u65e0\u5f88\u592a\u66f4\u6700\u90fd\u4e5f\u8fd8\u5c31\u624d\u53c8\u518d\u5df2\u7ad9\u751a\u81f3\u5219\u800c\u5374]/;
/** 章节标题不是角色名：第一章 / 第三幕 / 第二场 */
const CHAPTER_TITLE = /^第[0-9一二三四五六七八九十百千]+[章节回幕场次篇讲]$/;
/** 名字里至少得有中日文 / 假名 / 英文字母（纯数字、纯符号丢掉） */
const HAS_NAME_CHAR = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afA-Za-z]/;
/** 名字允许出现的字符（捕获用） */
const NAME_CHARS = '\u4e00-\u9fff\u3040-\u30ffA-Za-z';

/**
 * 常见中文姓氏（单姓取篇幅，够用即可）。
 * 只在**弱证据**通道上用作降级判据（见 `grade`）。
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
 * 纯汉字名的"像不像人名"打分（只服务弱证据通道）。
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

// ---------- 抽取规则（规格 §3.1；2026-09-14 按实机反馈重做）----------
export const STRENGTH_STRONG = 'strong';
export const STRENGTH_WEAK = 'weak';

/**
 * 说话/动作词。**长词必须排前面**，否则 `笑了笑` 会被 `笑` 抢先匹配。
 * 规则②（引号前主语）与规则③（称谓模式）共用同一份。
 */
const VERB_ALT = [
  '低声说', '笑了笑', '点着头', '低声', '低语', '看着', '沉默', '说道', '笑了', '笑着',
  '嘱咐', '提醒', '冷笑', '叹气', '皱眉', '点头', '摇头', '回答', '开口',
  // 2026-09-14 补：`艾拉盯着他很久` 这种"名字 + 动作"也该算（原来只有 `看着`，`盯着` 漏了）
  '盯着', '望着', '看向', '凝视', '打量', '瞥了一眼',
  '说', '道', '问', '答', '笑', '喊',
].join('|');

/**
 * ① 行首标签式：`名字：` / `名字——`。
 *
 * 2026-09-14 修：**不再认行内单破折号**（`-` / `—` / `－`）。原来把 `-` 当分隔符，
 * 于是 `布满深浅不-的疤痕` 这种句子被切成 `布满深浅不-` 当人名 —— 维护者的清单里就有它。
 * 现在只认 `：` 与 `——`（双破折号是明确的"标签 → 释义"写法）。
 */
const LABEL_RE = new RegExp(
  `^[\\t\\u3000 ]*([^\\n\\r：:，。！？；、（）()\\[\\]【】“”"'「」『』]{2,10}?)[\\t\\u3000 ]*(?:[：:]|——)`,
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
/** ①b 角色小标题：`【裴玉】` / `[裴玉]`（世界书里标"这是谁"的写法，比栏目名可靠） */
// `[]` 那个分支要求后面不是 `(` / `[`，免得把 markdown 链接 `[文字](url)` 认成角色
const TITLE_BRACKET_RE = /【([^】\n]{2,12})】|\[([^\]\n]{2,12})\](?![(\[])/g;
/** ①c 角色小标题：markdown 标题 `### 裴玉` */
const TITLE_HEADING_RE = /^#{2,4}[ \t\u3000]*([^\n]{2,12})$/gm;

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
 * 这个名字收不收（长度 / 字符 / 停用词 / 虚词 / 章节标题 / 栏目名）。
 * 已知名单不走这里（见 acceptKnown）——主角名哪怕 1 个字也得认出来。
 */
export function isCastNameCandidate(raw) {
  const name = normalizeCastName(raw);
  if (!name) return false;
  const len = coreLength(name);
  if (len < WORLD_CAST_MIN_LEN || len > WORLD_CAST_MAX_LEN) return false;
  if (!HAS_NAME_CHAR.test(name)) return false;
  if (WORLD_CAST_STOPWORDS.has(name)) return false;
  if (ABSTRACT_NOUNS.has(name)) return false;
  if (WORLD_FIELD_LABELS.has(name)) return false;
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

/**
 * 身份字段的**值**怎么清洗成名字：去引号 / 去括号注释 / 去尾标点。
 * `Lobo（花名）` → `Lobo`；`"夜莺"` → `夜莺`。
 */
function cleanIdentityValue(raw) {
  let text = normalizeCastName(raw);
  text = text.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ''); // 括号里的注释不算名字
  text = text
    .replace(/^[\s"'“”‘’「」『』【】\[\]]+/, '')
    .replace(/[\s"'“”‘’「」『』【】\[\]。．，,；;：:！!？?]+$/, '');
  return normalizeCastName(text);
}

/**
 * 身份字段的值收不收（T-438 增量一）。
 * **豁免名字长度上限**（`Lobo Wolf` 9 字也要收），但其它噪声判据照用。
 */
export function isIdentityCastValue(raw) {
  const name = cleanIdentityValue(raw);
  if (!name) return false;
  const len = [...name].length;
  if (len < 1 || len > 12) return false;
  if (!HAS_NAME_CHAR.test(name)) return false;
  if (WORLD_CAST_STOPWORDS.has(name)) return false;
  if (ABSTRACT_NOUNS.has(name)) return false;
  if (WORLD_FIELD_LABELS.has(name)) return false;
  if (CHAPTER_TITLE.test(name)) return false;
  if (FUNCTION_CHARS.test(name)) return false;
  if (PRONOUN_START.test(name)) return false;
  if (NON_PERSON_SUFFIX.test(name)) return false;
  return true;
}

/** 正则里的字面量转义（已知名单要按原样搜正文） */
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 一行开头的"标签"（`性格：xxx` → `性格`）；不是标签行返回空串 */
function lineStartLabel(line) {
  return labelLineInfo(line)?.label ?? '';
}

/**
 * 拆一行：`标签` + 后面那截"值"有多长。
 *
 * 值的长度是**区分"设定卡"和"角色列表"的关键**：
 *   设定卡的 `性别：男` `年龄：25` 值很短；`艾拉：宅子里最安静的那个` 值是描述句（长）。
 */
function labelLineInfo(line) {
  LABEL_RE.lastIndex = 0; // LABEL_RE 带 g，复用前必须复位（不然第二次从中间开始找）
  const text = String(line);
  const match = LABEL_RE.exec(text);
  LABEL_RE.lastIndex = 0;
  if (!match) return null;
  const label = stripTrailingVerb(match[1]);
  if (!label) return null;
  return { label, valueLength: text.slice(match.index + match[0].length).trim().length };
}

/**
 * 把整篇文本里的"行首标签"统计出来 —— **这是识别栏目名的关键信号**：
 * 栏目名（`性格` / `外貌` / `年龄`）在一份卡里会**反复出现**（每个角色一套），人名不会。
 *
 * @returns {{ count: Map<string, number>, inEntries: Map<string, Set<number>>, schema: Set<string> }}
 */
function collectLabelStats(entries) {
  const count = new Map();
  const inEntries = new Map();
  /** 落在"设定卡块"里的标签：连续 ≥3 行都是 `标签：值`，且块内**有标签重复**（= 结构化 schema） */
  const schema = new Set();

  entries.forEach((item, index) => {
    const text = String(item?.content ?? '');
    if (!text) return;
    for (const match of text.matchAll(LABEL_RE)) {
      const label = stripTrailingVerb(match[1]);
      if (!label) continue;
      count.set(label, (count.get(label) ?? 0) + 1);
      if (!inEntries.has(label)) inEntries.set(label, new Set());
      inEntries.get(label).add(index);
    }

    // 设定卡块：解决"整张卡就一条条目、栏目名还都是自定义的"场景（词表兜不住这种）
    const lines = text.split(/\r?\n/);
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const labels = run.map((item) => item.label);

      // 判据 1：块内**有标签重复** → 是"栏目 × 多个角色"的 schema，整块标签全算栏目名
      //        （`艾拉：…` / `莉泽：…` 这种角色列表没有重复标签，不会被误杀）
      const repeated = labels.some((label, i) => labels.indexOf(label) !== i);

      // 判据 2：块够长（≥5 行）且**值的中位长度 ≤ 8 字** → 这是"栏目：短值"的设定卡。
      //        角色列表的值是描述句（长），设定卡的值是栏目值（男 / 25 / 无 / 皮鞋…）。
      //        这条专治"栏目名是作者自定义的"（`变化倾向` `二次解释` `柔软衍生三` 这种）。
      const values = run.map((item) => item.valueLength).filter((n) => n > 0).sort((a, b) => a - b);
      const median = values.length ? values[Math.floor(values.length / 2)] : 0;
      const schematic = run.length >= 5 && median <= 8;

      if ((run.length >= 3 && repeated) || schematic) for (const label of labels) schema.add(label);
      run = [];
    };
    for (const line of lines) {
      if (!line.trim()) continue; // 空行不切断块
      const info = labelLineInfo(line);
      if (info) run.push(info);
      else flush();
    }
    flush();
  });

  return { count, inEntries, schema };
}

/**
 * 这个行首标签是不是"设定卡的栏目名"（栏目名一律不当人名）。
 *
 * 三条判据（任一命中即栏目名）：
 *   ① 在 `WORLD_FIELD_LABELS` 词表里（`性格` `外貌` `年龄` …）
 *   ② 在整批条目里出现 ≥3 次，或出现在 ≥2 条不同条目里（栏目会跨角色/跨条目复用）
 *   ③ 落在"设定卡块"里（见 collectLabelStats）
 * 例外：**已知名单（当前主角 / 当前生成者）永远不算栏目名** —— 用户自己配的人必须认得出。
 */
function isFieldLabel(label, context) {
  if (!label) return true;
  if (context.known.has(label)) return false;
  if (WORLD_FIELD_LABELS.has(label)) return true;
  const { count, inEntries, schema } = context.labelStats;
  if ((count.get(label) ?? 0) >= 3) return true;
  if ((inEntries.get(label)?.size ?? 0) >= 2) return true;
  if (schema.has(label)) return true;
  return false;
}

/**
 * 从**一段文本**里挖出候选（名字 + 下标 + 证据强弱）。
 * 同一位置被多条规则命中时由调用方用 Set 去重。
 */
function ruleHits(text, context) {
  const out = [];

  // ① 行首标签式 —— 强证据，但**必须先过"栏目名"筛**（2026-09-14 修复的主战场）
  for (const match of text.matchAll(LABEL_RE)) {
    const label = stripTrailingVerb(match[1]);
    if (isFieldLabel(label, context)) continue; // `性格：` `外貌：` 属栏目名，不是人
    const offset = match.index + match[0].search(/[^\s\u3000]/);
    out.push([label, offset, STRENGTH_STRONG]);
  }

  // ①a 【T-438 增量一】身份字段的**值**就是角色名：`代号：Lobo` → `Lobo`
  //     只对 IDENTITY_FIELD_LABELS 里的标签生效；值里遇到分隔符按多个名字切。
  //     第 4 位 `true` = **已经校验过**（isIdentityCastValue 已按 1~12 字判过），
  //     别再让 grade() 拿"2~6 字"的通用上限砍它一刀（`Lobo Wolf` 就是这么被砍掉的）。
  for (const match of text.matchAll(IDENTITY_LINE_RE)) {
    const valueText = String(match[2] ?? '');
    for (const part of valueText.split(IDENTITY_SPLIT_RE)) {
      if (!isIdentityCastValue(part)) continue;
      out.push([cleanIdentityValue(part), match.index + match[0].indexOf(valueText), STRENGTH_STRONG, true]);
    }
  }

  // ①b 角色小标题：`【裴玉】` / `[裴玉]` —— 世界书里最直白的"这是谁"
  for (const match of text.matchAll(TITLE_BRACKET_RE)) {
    const inner = normalizeCastName(match[1] ?? match[2] ?? '');
    if (!inner || isFieldLabel(inner, context)) continue;
    out.push([inner, match.index + 1, STRENGTH_STRONG]);
  }

  // ①c 角色小标题：`### 裴玉`
  for (const match of text.matchAll(TITLE_HEADING_RE)) {
    const inner = normalizeCastName(match[1]);
    if (!inner || isFieldLabel(inner, context)) continue;
    out.push([inner, match.index, STRENGTH_STRONG]);
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

  // ③ 称谓模式：XX 说 / XX 问 / XX 笑了 / XX 看着 —— 强证据
  //    2026-09-14 修：**删掉了 `XX 的`**。`喜欢用黑色` `陈旧血迹` `弟间存有一份` 这类
  //    半句噪声全是它造的（它只要求"2~6 字 + 的"，还会把长句贪心截成 6 字），
  //    而它带来的真信号（`管家的手` = 管家）远小于噪声 —— 删掉，漏了有手填兜底。
  for (const match of text.matchAll(TITLE_VERB_RE)) {
    out.push([normalizeCastName(match[1]), match.index, STRENGTH_STRONG]);
  }

  // ④ 亲属 / 角色称谓白名单 —— 强证据。设定卡里"关系"那一行是配角唯一出现的地方，
  //    `与伯伯、哥哥、父亲、母亲` 里的这四个人就是角色（白名单词不可能是栏目名）
  for (const term of KINSHIP_TERMS) {
    const at = text.indexOf(term);
    if (at >= 0) out.push([term, at, STRENGTH_STRONG]);
  }

  return out;
}

/**
 * 一个名字该排在哪个档 —— 返回 `null` 表示该丢掉。
 *
 * | 命中的规则 | 像中文人名 | 结果 |
 * |---|---|---|
 * | 强（行首标签 / 小标题 / 引号主语 / 称谓动词） | 是 | strong |
 * | 强 | 不像（如西式译名） | weak（降级，不丢） |
 * | 弱 | 是 | weak |
 * | 弱 | 不像 | 丢弃 |
 *
 * 注：2026-09-14 删掉 `XX 的` 之后**已经没有规则再产出弱证据**了（weak 通道保留着，
 * 以后要加"低把握线索"时用；界面那一组会自动不显示）。**动词 / 行首标签命中的一律不查姓氏**
 * （西式译名如「莉泽」根本不在百家姓里，查了会误杀真角色）。
 */
function grade(name, strength) {
  if (!isCastNameCandidate(name)) return null;
  if (strength === STRENGTH_STRONG) return STRENGTH_STRONG;
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

  // ⓪ 先统计"栏目名"：栏目会跨角色/跨条目反复出现，人名不会（这是本次修复的关键信号）
  const context = { known: knownSet, labelStats: collectLabelStats(list) };

  // ① 第一遍：按规则找出"谁是角色"，并按证据强弱分档
  const nameSet = new Set();
  const strength = new Map(); // name → strong / weak
  for (const item of list) {
    // 第 4 位 = 该规则已经自己校验过名字（身份字段的值豁免通用长度上限），不用再走 grade 的形状检查
    for (const [name, , hitStrength, prevalidated] of ruleHits(String(item.content), context)) {
      const graded = prevalidated ? hitStrength : grade(name, hitStrength);
      if (!graded) continue; // 噪声在这里被丢掉
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
