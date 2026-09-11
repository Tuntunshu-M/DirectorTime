# 导演时间 · 项目约定

任何 AI agent 打开本目录，请先读这一页。

## 输出风格（每轮必读）

来源：`github.com/ayghri/i-have-adhd`（规则全文见其 `skills/i-have-adhd/SKILL.md`）

1. 首行直接给下一个动作
2. 多步任务用编号
3. 结尾给一个具体可执行的下一步
4. 不引入当前问题之外的新话题
5. 每轮重述当前进度（做到第几步）
6. 时间用具体单位（分钟），不说"一会儿""稍后"
7. 让成果可见 —— 能跑、能看的直接展示
8. 报错就事论事：位置 + 原因 + 修复，不铺垫
9. 列表最多 5 项
10. 无开场白、无总结、无客套收尾

## 这是什么

SillyTavern **前端扩展**「导演时间」：挂载一个外置导演 API，在每次角色生成前把"这一场戏该怎么演"的指令注入 prompt，让 char 主动推进剧情、制造日常、引发危机。

**插件不扮演角色、不代替用户说话、不修改聊天记录。**

## 文档索引

设计文档目前放在项目工作区（本仓库的**上级目录** `daoyanshijian/`），不在仓库内。需要时去那里读：

| 文件 | 什么时候读 |
|---|---|
| `AI执行清单.md` | 接任务前，**只读本次任务那一段**（含全局禁则与完成定义） |
| `导演时间-项目书-v0.3.md` | 需要理解架构、数据模型、功能规格时 |
| `UI设计-完全版.md` | 做 UI 任务时，重点看 §10 视觉规范、§10.9 质感层 |
| `旧版复用分析.md` | 需要参考旧实现时（前身仓库 just-do-it-char） |
| `喂任务操作手册.md` | 了解人类如何派发任务与验收 |

**按需读，不要全读** —— 省 token。

## 全局禁则（违反即视为任务未完成）

- **G1** 独立 API 模式下**禁止**调用 `generateRaw` / `generate` / `generateQuietPrompt` 等 ST 生成函数，必须自己 `fetch()`
- **G2** 禁止以 user 身份发送任何消息（不调 `sendMessage`，不写 `is_user: true` 条目）
- **G3** 禁止修改 `chat` 数组 —— 注入只走 `setExtensionPrompt`
- **G4** 逻辑未通过验收前，禁止写 UI 美化代码
- **G5** JSON 解析失败必须降级为"本轮不动作"，**禁止注入任何内容**
- **G6** 禁止硬编码 API 地址、密钥、模型名
- **G7** 所有 `SillyTavern.getContext()` 调用集中在 `src/core/context.js`
- **G8** 禁止用 mock 数据冒充真实 API 返回

## 关键接口（已在真实仓库中验证，勿凭记忆改动）

```js
// 注入：唯一方式，注册式、key 幂等、不污染聊天记录
context.setExtensionPrompt(key, value, position=1, depth=0, scan=false, role=0)
//   position 1=in-chat   depth 0=追加到末尾（紧跟 user 消息，影响力最强）   role 0=system

// 世界书
host.getWorldInfoNames()                              // 或 host.world_names
await host.loadWorldInfo(name)                        // 返回 book.entries 或 book 本身
characters[i].data.character_book.entries             // 角色卡内嵌世界书
// 条目字段兼容三套命名：
//   id: entry.id ?? entry.uid ?? index
//   name: entry.name ?? entry.comment ?? entry.keys?.join(', ')
//   content: entry.content ?? entry.text ?? ''

// 其它
eventSource.on(name, fn)                              // 返回 () => eventSource.off?.(name, fn)
extensionSettings[MODULE_NAME] + saveSettingsDebounced()
chatMetadata + (saveMetadataDebounced ?? saveMetadata)
writeExtensionField(charId, key, val)
host.Popup?.show?.confirm ?? host.popup?.confirm
host.showSystemMessage ?? globalThis.toastr?.info
```

## 三条硬约束

1. **剧情生成不得走会触发注入的路径** —— 独立模式必须自己 fetch；主连接模式用 `generateRaw` 时注意它会附带 ST 的 post-processing，可能污染 JSON 输出，必须有解析兜底
2. **同步拦截 = 同步等待** —— 注入本身零成本（注册式），延迟只来自"注入前要不要先问一次导演 API"
3. **注册式注入必须清空** —— 四个时机：总开关关 / 注入开关关 / `CHAT_CHANGED` / 剧本清空。漏一个就会出现"关了开关还在注入"，且用户完全无感

## 架构现状（初版已完成）

```
src/
├── core/      context.js（ST 适配层，注入参数在此封死）
│              state.js / default-state.js / migrations.js / event-bus.js
├── llm/       client.js（导演 API）/ prompts.js / schemas.js
├── director/  outline.js / stage.js / checkpoint.js / review.js
├── inject/    prompt-registry.js（注入生命周期）/ instruction.js
├── ui/        debug.js（调试面板）/ settings.js（临时配置，非最终 UI）
└── bootstrap.js（装配层：把服务挂到 ST 事件上）
```

**已接线**：`bootstrap.js` 监听 `message_received`（回复结束→复盘）与 `chat_id_changed`（切聊天→重载+清空）。改事件逻辑前先看它，不要另起一套监听。

**`src/ui/settings.js` 是测试用临时界面，不是最终 UI。** 正式界面按《UI设计-完全版.md》做——六分类（事件/剧本/人物/世界书/偏好/副本）+ 牛皮纸工作台风格。别在 settings.js 上做美化。

## 验收纪律

1. 一次只做清单里的**一个**任务
2. 严格按该任务的验收判据实现，**不许自己改判据来迁就实现**
3. 改满 **3 轮**仍未通过 → 停下报告，不要继续死磕
4. 禁止"顺手优化"其它模块、禁止顺手做清单外的任务
5. 做完后逐条列出验收判据的满足情况：已满足 / 未满足 / 无法本地验证

## 完成定义

见 `AI执行清单.md` §1 的 F-1 ~ F-9，关键的九条：

- 发一句话，char 的回复明显遵循当前阶段指令
- 推进点达成后**自动**进入下一阶段，无需手动操作
- 用户表达违背意图时触发重生成，**不卡死**
- 连续 5 条无关消息，剧情仍推进
- 关掉总开关，char 完全不受影响，聊天记录无注入痕迹
- 切聊天 / 重开页面，剧本正确切换与持久化
- Debug 窗口能显示当前阶段、注入全文、API 原始返回、上次判定
- 三个自动化测试（注入清空 / 状态机不变量 / JSON 解析降级）通过
- 七条肉眼检查清单通过
