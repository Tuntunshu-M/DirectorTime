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

/** 加时间戳绕过缓存（不然改了版本号也可能拿到旧的 manifest） */
function withStamp(url) {
  if (!url) return url;
  const text = String(url);
  return text.includes('?') ? `${text}&t=${Date.now()}` : `${text}?t=${Date.now()}`;
}

/** 版本号比较：a > b 返回正数（按段比数字，缺的当 0） */
export function compareVersion(a, b) {
  const left = String(a ?? '').split('.').map((part) => Number(part) || 0);
  const right = String(b ?? '').split('.').map((part) => Number(part) || 0);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/**
 * 从扩展声明的 homepage 推出远程 manifest 地址（GitHub raw）。
 * 推不出来（不是 GitHub 地址）就返回空数组 —— 不猜、不编。
 */
export function remoteManifestUrls(homepage, { branch } = {}) {
  const url = String(homepage ?? '').trim();
  const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?\s]+)/i);
  if (!match) return [];

  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  const branches = branch ? [branch] : ['main', 'master'];
  return branches.map((name) => `https://raw.githubusercontent.com/${owner}/${repo}/${name}/manifest.json`);
}

/**
 * 「检查更新」：真去比本地与远程的版本号（用户反馈 13：以前没查就报"更新成功"）。
 *
 * - 本地版本：从扩展自己的 manifest.json 读（服务器上的文件，就是当前装着的这版）
 * - 远程版本：从 manifest 里声明的 homepage 推 GitHub raw 地址读
 * 任何一步失败都**如实返回失败原因**，不假装"已是最新"。
 */
export function createUpdateChecker({ manifestUrl, homepage, fetchImpl, branch } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;

  async function readManifest(url) {
    if (typeof doFetch !== 'function' || !url) return { ok: false, reason: 'no-fetch' };
    try {
      const response = await doFetch(withStamp(url), { cache: 'no-store' });
      if (!response?.ok) return { ok: false, reason: `http-${response?.status ?? 'error'}` };
      const data = await response.json();
      if (!data?.version) return { ok: false, reason: 'no-version' };
      return { ok: true, version: String(data.version), homepage: String(data.homepage ?? '') };
    } catch (error) {
      return { ok: false, reason: 'network', detail: error?.message ?? '' };
    }
  }

  const local = () => readManifest(manifestUrl);

  async function remote(remoteHomepage) {
    const urls = remoteManifestUrls(remoteHomepage, { branch });
    if (!urls.length) return { ok: false, reason: 'no-homepage' };

    let last = { ok: false, reason: 'unknown' };
    for (const url of urls) {
      // eslint-disable-next-line no-await-in-loop -- 逐个试 main / master
      const result = await readManifest(url);
      if (result.ok) return { ...result, url };
      last = result;
    }
    return last;
  }

  /** @returns {{ok:boolean, local?:string, remote?:string, hasUpdate?:boolean, message:string, reason?:string}} */
  async function check() {
    const here = await local();
    if (!here.ok) {
      return { ok: false, reason: here.reason, message: `读不到当前版本（${here.reason}）` };
    }

    // 远程地址从本地 manifest 声明的 homepage 推（不在代码里硬编码仓库地址）
    const there = await remote(here.homepage || homepage);
    if (!there.ok) {
      const why = there.reason === 'no-homepage'
        ? '这个扩展没声明仓库地址（manifest.homepage），查不了远程版本'
        : (there.reason === 'network' ? '连不上 GitHub，查不到有没有新版本' : `查不到远程版本（${there.reason}）`);
      return { ok: false, reason: there.reason, local: here.version, message: `${why} · 当前 v${here.version}` };
    }

    const hasUpdate = compareVersion(there.version, here.version) > 0;
    return {
      ok: true,
      local: here.version,
      remote: there.version,
      hasUpdate,
      message: hasUpdate
        ? `有新版本 v${there.version}（当前 v${here.version}）→ 点「更新插件」`
        : `已是最新版（v${here.version}）`,
    };
  }

  return { check, local, remote };
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
