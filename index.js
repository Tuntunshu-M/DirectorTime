// 导演时间 · 扩展入口
//
// T-101 脚手架：只做装配与生命周期注册，不含任何业务逻辑。
// 业务模块在后续任务中接入，通过事件总线通信（禁止跨层直接引用）。

import { createSillyTavernContext } from './src/core/context.js';
import { createEventBus } from './src/core/event-bus.js';
import { createStateStore } from './src/core/state.js';

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
  console.log('[导演时间] 已加载', ctx.capabilities);
  bus.emit('boot', { capabilities: ctx.capabilities });
}

// 正常路径：等酒馆就绪
ctx.on(APP_READY, boot);

// 兜底：扩展晚加载时事件已错过，能力探测里没有事件源就直接跑
if (!ctx.capabilities.events) boot();

window.DirectorTime = { ctx, bus, store, MODULE_NAME };

export { ctx, bus, store };
