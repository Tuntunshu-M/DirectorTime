// 导演时间 · 更新检测
//
// 方便测试：装进酒馆后，只要扩展文件被更新（manifest.version 变了），
// 打开/刷新页面时提示一次并自动刷新，省得手动 F5。
//
// 规则：
//   首次运行（没有记录）—— 只记录版本，不刷新
//   版本一致            —— 不动
//   版本变化            —— 提示 + 自动刷新；刷新前先记录新版本，且用 sessionStorage 打标记防死循环
//   任何失败            —— 静默跳过，绝不影响主流程
//
// 不碰任何 ST 生成函数，不写聊天记录（禁则 G1/G2/G3）。

const SESSION_KEY = 'dt_reloaded_for_version';
const RELOAD_DELAY_MS = 1200; // 给提示留 1.2 秒可见时间

/** 纯函数：决定这次要做什么。抽出来便于单独验证 */
export function decideUpdate({ lastVersion, latestVersion, alreadyReloaded = false } = {}) {
  if (!latestVersion) return { action: 'skip', reason: 'no-version' };
  if (!lastVersion) return { action: 'record', version: latestVersion };
  if (lastVersion === latestVersion) return { action: 'skip', reason: 'same-version' };
  if (alreadyReloaded) return { action: 'record', version: latestVersion, reason: 'already-reloaded' };
  return { action: 'reload', version: latestVersion };
}

export async function checkForUpdate({
  ctx,
  store,
  manifestUrl,
  fetchImpl,
  reload,
  sessionStore,
  delayMs = RELOAD_DELAY_MS,
} = {}) {
  try {
    const doFetch = fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function' || !manifestUrl) return { action: 'skip', reason: 'no-fetch' };

    const response = await doFetch(String(manifestUrl));
    if (!response?.ok) return { action: 'skip', reason: `http-${response?.status ?? 'error'}` };

    const manifest = await response.json();
    const latestVersion = manifest?.version;
    const lastVersion = store?.getSettings?.().loadedVersion;

    let alreadyReloaded = false;
    try { alreadyReloaded = sessionStore?.getItem?.(SESSION_KEY) === latestVersion; } catch { /* 隐私模式下可能抛错 */ }

    const decision = decideUpdate({ lastVersion, latestVersion, alreadyReloaded });

    if (decision.action === 'record' || decision.action === 'reload') {
      store?.saveSettings?.({ loadedVersion: latestVersion });
    }

    if (decision.action === 'reload') {
      try { sessionStore?.setItem?.(SESSION_KEY, latestVersion); } catch { /* 忽略 */ }
      ctx?.showSystemMessage?.(`导演时间 已更新到 v${latestVersion}，正在刷新页面…`);
      console.log(`[导演时间] 检测到更新 v${lastVersion} → v${latestVersion}，即将刷新`);
      const doReload = reload ?? (() => globalThis.location?.reload?.());
      setTimeout(() => {
        try { doReload(); } catch (error) { console.warn('[导演时间] 刷新失败', error); }
      }, delayMs);
    }

    return decision;
  } catch (error) {
    console.warn('[导演时间] 更新检测失败', error);
    return { action: 'skip', reason: 'error' };
  }
}
