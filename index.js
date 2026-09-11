// 导演时间 · 扩展入口
//
// T-101 脚手架：只做装配与生命周期注册，不含任何业务逻辑。
// 业务模块在后续任务中接入，通过事件总线通信（禁止跨层直接引用）。

import { createSillyTavernContext } from './src/core/context.js';
import { createEventBus } from './src/core/event-bus.js';
import { createStateStore } from './src/core/state.js';
import { bootstrap, lastTurnMessages } from './src/bootstrap.js';
import { checkForUpdate } from './src/core/update-check.js';

export const MODULE_NAME = 'director_time';

// ST 的就绪事件；不同版本常量名不同，这里用字符串兜底
const APP_READY = 'app_ready';

const ctx = createSillyTavernContext();
const bus = createEventBus();
const store = createStateStore(ctx, MODULE_NAME);

let booted = false;

function boot() {
  if (booted) return;
  booted = true;
  store.load();
  const api = bootstrap({ ctx, store });
  console.log('[导演时间] 已加载', ctx.capabilities);
  bus.emit('boot', { capabilities: ctx.capabilities, api });
  // 方便测试：检测到扩展更新就提示并刷新（失败静默，不影响主流程）
  checkForUpdate({
    ctx,
    store,
    manifestUrl: new URL('./manifest.json?t=' + Date.now(), import.meta.url).href,
    sessionStore: globalThis.sessionStorage,
  });
}

// 正常路径：等酒馆就绪
ctx.on(APP_READY, boot);

// 兜底 1：没有事件源的环境（非酒馆）直接启动
if (!ctx.capabilities.events) boot();

// 兜底 2：app_ready 可能在扩展模块执行前就已抛过（云酒馆 / 高 loading_order / 模块晚执行），
// 错过就永远不 boot —— 菜单入口和面板都不会出现。2 秒后仍未启动就强制启动。
setTimeout(() => { if (!booted) boot(); }, 2000);

window.DirectorTime = { ctx, bus, store, MODULE_NAME };

export { ctx, bus, store, lastTurnMessages };
