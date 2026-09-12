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

/**
 * 从扩展自己的 URL 推出"酒馆认的扩展名"（T-420）。
 *
 * 例：`.../scripts/extensions/third-party/导演时间/src/bootstrap.js`
 *  → `{ name: 'third-party/导演时间', global: true }`（第三方扩展装在 public 下）
 * 例：`.../scripts/extensions/我的扩展/index.js`
 *  → `{ name: '我的扩展', global: false }`（本地扩展）
 *
 * 认不出来就返回 null —— 宁可不更新，也不猜一个名字去调酒馆的写接口。
 */
export function extensionFolderFromUrl(url) {
  const text = String(url ?? '');
  const marker = '/extensions/';
  const at = text.indexOf(marker);
  if (at === -1) return null;

  const rest = text.slice(at + marker.length).split(/[?#]/)[0];
  const parts = rest.split('/').filter(Boolean);
  if (!parts.length) return null;

  // 最后一段如果是文件（带扩展名）就去掉，只留目录
  const last = parts[parts.length - 1];
  const segments = /\.[a-z0-9]{1,8}$/i.test(last) ? parts.slice(0, -1) : parts;
  if (!segments.length) return null;

  const decode = (value) => {
    try { return decodeURIComponent(value); } catch { return value; }
  };

  if (segments[0] === 'third-party') {
    if (segments.length < 2) return null;
    return { name: `third-party/${decode(segments[1])}`, global: true };
  }
  return { name: decode(segments[0]), global: false };
}

/**
 * 酒馆各版本把扩展放在不同目录（public/scripts/extensions 与 data/<user>/extensions），
 * 所以**不猜一个名字**，而是按顺序试几个候选 —— 路径不对时酒馆直接返回错误，试错不改任何数据。
 */
export function extensionCandidates(folder) {
  if (!folder?.name) return [];
  const { name, global } = folder;
  const bare = name.includes('/') ? name.split('/').pop() : name;
  const thirdParty = name.startsWith('third-party/');

  const list = thirdParty
    ? [{ name, global: true }, { name, global: false }]
    : [{ name, global: false }, { name, global: true }];

  // 有些版本不带 third-party/ 前缀，兜底再试一次裸目录名
  if (thirdParty) list.push({ name: bare, global: true }, { name: bare, global: false });
  return list;
}

/**
 * 一键更新：调酒馆的接口把扩展更新到最新，成功后刷新页面（T-420）。
 *
 * 失败时**不刷新、不假装成功**，返回一句能照做的话（去扩展面板手动点更新）。
 * @param {{ ctx, folder, remembered, remember, refreshVersion, reload, delayMs }} options
 *   remembered / remember —— 上次试成功的那条路径，下次先试它（更快更稳）
 *   refreshVersion —— 更新成功后重新对一次版本号（走 checkForUpdate，它会负责刷新与防死循环）
 */
export function createExtensionUpdater({
  ctx,
  folder = null,
  remembered = null,
  remember = null,
  refreshVersion = null,
  reload = null,
  delayMs = RELOAD_DELAY_MS,
} = {}) {
  let busy = false;

  const manual = (reason, message) => ({ ok: false, reason, message, manual: true });

  /**
   * 候选顺序：上次试中的排最前（也就是"这个酒馆认哪种名字"的实测答案）。
   * 连目录都认不出来时，也允许用"记住的那条"兜底 —— 手动写一次 settings.updatePath 就能用。
   */
  function candidateList() {
    const known = remembered?.() ?? null;
    const base = folder?.name ? folder : (known?.name ? known : null);
    if (!base?.name) return [];

    const all = extensionCandidates(base);
    if (!known?.name) return all;

    const rest = all.filter((item) => !(item.name === known.name && Boolean(item.global) === Boolean(known.global)));
    return [{ name: known.name, global: Boolean(known.global) }, ...rest];
  }

  async function apply() {
    if (busy) return { ok: false, reason: 'busy', message: '正在更新，请稍候…' };
    if (!candidateList().length) {
      return manual('unknown-folder', '认不出插件目录，请到酒馆的「扩展」面板点更新（手动刷新一次页面）');
    }
    if (!ctx?.updateExtension) {
      return manual('unsupported', '这个酒馆版本没有更新接口，请到「扩展」面板点更新');
    }

    busy = true;
    try {
      const tried = [];
      let result = null;
      for (const candidate of candidateList()) {
        // 逐个试，命中就停（拿不到就换下一个候选路径）
        // eslint-disable-next-line no-await-in-loop
        result = await ctx.updateExtension(candidate);
        tried.push({ ...candidate, ok: Boolean(result?.ok), reason: result?.reason ?? '' });
        if (result?.ok) {
          remember?.(candidate);
          console.log('[导演时间] 更新成功', candidate);
          break;
        }
      }

      if (!result?.ok) {
        const detail = result?.reason ? `（${result.reason}）` : '';
        console.warn('[导演时间] 一键更新失败，试过的路径：', tried);
        return manual(result?.reason ?? 'failed', `更新失败${detail}，请到酒馆的「扩展」面板手动点更新`);
      }

      // 优先让"版本检查"去刷新：它会顺手记下新版本 + 打 sessionStorage 标记，
      // 避免刷新后再被轮询当成"又更新了一次"而重复刷新。
      if (typeof refreshVersion === 'function') {
        try {
          const decision = await refreshVersion();
          if (decision?.action === 'reload') return { ok: true, message: '更新完成，正在刷新页面…', reloading: true };
        } catch (error) {
          console.warn('[导演时间] 更新后对版本失败，直接刷新', error);
        }
      }

      ctx?.showSystemMessage?.('导演时间：更新完成，正在刷新页面…');
      const doReload = reload ?? (() => globalThis.location?.reload?.());
      setTimeout(() => {
        try { doReload(); } catch (error) { console.warn('[导演时间] 刷新失败', error); }
      }, delayMs);
      return { ok: true, message: '更新完成，正在刷新页面…', reloading: true };
    } finally {
      busy = false;
    }
  }

  return { apply, folder, candidates: candidateList };
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
