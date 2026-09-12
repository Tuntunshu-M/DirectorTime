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

// 更新检测：酒馆点 Update 只替换磁盘文件、**不会重载页面**，所以只在 boot 时查一次等于没查
// （boot 早就跑完了）。改为每 15 秒查一次，外加"回到前台"时查一次。
const UPDATE_POLL_MS = 15000;
const MANIFEST_URL = new URL('./manifest.json', import.meta.url).href;

const ctx = createSillyTavernContext();
const bus = createEventBus();
const store = createStateStore(ctx, MODULE_NAME);

let booted = false;
let updateTimer = null;

/** 查一次更新。log=true 时把结果打进控制台，便于排查 */
function pollUpdate({ log = false } = {}) {
  return checkForUpdate({
    ctx,
    store,
    // 带时间戳绕过缓存，否则改了版本号也可能拿到旧的 manifest
    manifestUrl: `${MANIFEST_URL}?t=${Date.now()}`,
    sessionStore: globalThis.sessionStorage,
  }).then((result) => {
    if (log) console.log('[导演时间] 更新检测', result);
    return result;
  }).catch((error) => {
    console.warn('[导演时间] 更新检测异常', error);
    return { action: 'skip', reason: 'error' };
  });
}

// T-430：远程（GitHub）检查要**节流** —— 15 秒一次去打 raw.githubusercontent 会被限流，
// 也没必要时时查；10 分钟一次足够。手动点「检查更新」和打开面板都不受这个限制。
const REMOTE_CHECK_MS = 10 * 60 * 1000;
let remoteCheckedAt = 0;

/**
 * T-430：自动查一次 GitHub，有新版本会**提示一次**（每个版本只提示一次，见 bootstrap）。
 * 这是用户要的"GitHub 更新了 → 酒馆里自己冒出来说一句"。
 */
function checkRemote({ notify = false, force = false } = {}) {
  const api = globalThis.window?.DirectorTime;
  if (!booted || typeof api?.checkRemoteUpdate !== 'function') return Promise.resolve(null);
  if (!force && Date.now() - remoteCheckedAt < REMOTE_CHECK_MS) return Promise.resolve(null);
  remoteCheckedAt = Date.now();
  return Promise.resolve(api.checkRemoteUpdate({ notify })).catch((error) => {
    console.warn('[导演时间] 远程更新检查异常', error);
    return null;
  });
}

/** 轮询 + 回到前台时各查一次，覆盖"点了 Update 但页面没刷新"的情况 */
function startUpdatePolling() {
  if (updateTimer || typeof setInterval !== 'function') return;
  updateTimer = setInterval(() => {
    pollUpdate();
    checkRemote({ notify: true }); // 内部有 10 分钟节流，这里可以放心每 15 秒叫一次
  }, UPDATE_POLL_MS);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        pollUpdate();
        checkRemote({ notify: true });
      }
    });
  }
}

function boot() {
  if (booted) return;
  booted = true;
  store.load();
  const api = bootstrap({ ctx, store });
  // 挂到 window —— README 里那些控制台命令（DirectorTime.debug / .automation / .tone / .cast …）
  // 全靠这一步才够得着；只挂 api 的话它们全是 undefined。这里摊平 + 保留 api 两种写法都行。
  // 注意用合并式赋值：boot 可能在模块末尾那行之前就跑起来，整体覆盖会把这里挂的东西冲掉（冒烟抓到过）。
  window.DirectorTime = { ...(window.DirectorTime ?? {}), ...api, api };
  console.log('[导演时间] 已加载', ctx.capabilities);
  bus.emit('boot', { capabilities: ctx.capabilities, api });
  pollUpdate({ log: true });
  startUpdatePolling();
  // T-430：启动后 3 秒自动查一次 GitHub（错开启动高峰），有新版本提示一次
  setTimeout(() => { checkRemote({ notify: true, force: true }); }, 3000);
}

// 正常路径：等酒馆就绪
ctx.on(APP_READY, boot);

// 兜底 1：没有事件源的环境（非酒馆）直接启动
if (!ctx.capabilities.events) boot();

// 兜底 2：app_ready 可能在扩展模块执行前就已抛过（云酒馆 / 高 loading_order / 模块晚执行），
// 错过就永远不 boot —— 菜单入口和面板都不会出现。2 秒后仍未启动就强制启动。
setTimeout(() => { if (!booted) boot(); }, 2000);

window.DirectorTime = { ...(window.DirectorTime ?? {}), ctx, bus, store, MODULE_NAME };

export { ctx, bus, store, lastTurnMessages };
