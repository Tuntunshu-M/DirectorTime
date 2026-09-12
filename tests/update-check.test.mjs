// T-420 测试：一键更新（在导演时间里点一下就更新 + 自动刷新）
// 顺带补上 update-check.js 一直缺的测试（版本检测此前无人覆盖）

import assert from 'node:assert/strict';
import {
  decideUpdate, extensionFolderFromUrl, extensionCandidates, createExtensionUpdater, checkForUpdate,
  createUpdateChecker, compareVersion, remoteManifestUrls,
} from '../src/core/update-check.js';
import { createSillyTavernContext } from '../src/core/context.js';

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

console.log('T-420 · 版本决策（纯函数）');

await check('首次运行只记录，不刷新', () => {
  assert.deepEqual(decideUpdate({ lastVersion: '', latestVersion: '0.3.1' }), { action: 'record', version: '0.3.1' });
});

await check('版本一致 → 什么都不做', () => {
  assert.equal(decideUpdate({ lastVersion: '0.3.1', latestVersion: '0.3.1' }).action, 'skip');
  assert.equal(decideUpdate({ lastVersion: '0.3.1' }).action, 'skip');
});

await check('版本变化 → 提示并刷新', () => {
  assert.deepEqual(
    decideUpdate({ lastVersion: '0.3.0', latestVersion: '0.3.1' }),
    { action: 'reload', version: '0.3.1' }
  );
});

await check('同一版本已经刷过一次 → 只记录（防死循环）', () => {
  const r = decideUpdate({ lastVersion: '0.3.0', latestVersion: '0.3.1', alreadyReloaded: true });
  assert.equal(r.action, 'record');
  assert.equal(r.reason, 'already-reloaded');
});

console.log('T-420 · 从 URL 推扩展名');

await check('第三方扩展：third-party/<目录> + global', () => {
  const url = 'https://host/scripts/extensions/third-party/导演时间/src/bootstrap.js';
  assert.deepEqual(extensionFolderFromUrl(url), { name: 'third-party/导演时间', global: true });
  assert.deepEqual(
    extensionFolderFromUrl('https://host/scripts/extensions/third-party/MyExt/index.js?v=2'),
    { name: 'third-party/MyExt', global: true }
  );
});

await check('本地扩展：<目录> + 非 global', () => {
  assert.deepEqual(
    extensionFolderFromUrl('https://host/scripts/extensions/my-ext/src/a.js'),
    { name: 'my-ext', global: false }
  );
});

await check('带转义的目录名要解回来', () => {
  assert.deepEqual(
    extensionFolderFromUrl('https://host/scripts/extensions/third-party/%E5%AF%BC%E6%BC%94%E6%97%B6%E9%97%B4/index.js'),
    { name: 'third-party/导演时间', global: true }
  );
});

await check('认不出来就返回 null（宁可不动，也不猜名字去调写接口）', () => {
  assert.equal(extensionFolderFromUrl('https://host/其它/路径/x.js'), null);
  assert.equal(extensionFolderFromUrl('https://host/scripts/extensions/'), null);
  assert.equal(extensionFolderFromUrl('https://host/scripts/extensions/third-party/'), null);
  assert.equal(extensionFolderFromUrl(''), null);
  assert.equal(extensionFolderFromUrl(null), null);
});

console.log('T-420 · 一键更新');

const FOLDER = { name: 'third-party/导演时间', global: true };

function makeUpdater({ updateExtension, refreshVersion, reload } = {}) {
  const calls = { system: [], reload: 0, refresh: 0 };
  const ctx = {
    updateExtension,
    showSystemMessage: (text) => calls.system.push(text),
  };
  const updater = createExtensionUpdater({
    ctx,
    folder: FOLDER,
    refreshVersion: refreshVersion
      ? async () => { calls.refresh += 1; return refreshVersion(); }
      : null,
    reload: () => { calls.reload += 1; },
    delayMs: 0,
  });
  return { updater, calls };
}

await check('成功：调酒馆接口 → 交给版本检查刷新（不重复刷新）', async () => {
  const seen = [];
  const { updater, calls } = makeUpdater({
    updateExtension: async (arg) => { seen.push(arg); return { ok: true }; },
    refreshVersion: () => ({ action: 'reload' }),
  });
  const result = await updater.apply();
  assert.deepEqual(seen, [{ name: 'third-party/导演时间', global: true }], '要按酒馆认的扩展名去调');
  assert.equal(result.ok, true);
  assert.equal(result.reloading, true);
  assert.equal(calls.refresh, 1, '交给版本检查去刷新');
  assert.equal(calls.reload, 0, '版本检查已经负责刷新，这里不重复');
});

await check('候选路径：第三方先试 global，再试本地，最后试裸目录名', () => {
  const candidates = extensionCandidates({ name: 'third-party/导演时间', global: true });
  assert.deepEqual(candidates, [
    { name: 'third-party/导演时间', global: true },
    { name: 'third-party/导演时间', global: false },
    { name: '导演时间', global: true },
    { name: '导演时间', global: false },
  ]);
  assert.deepEqual(extensionCandidates({ name: 'my-ext', global: false }), [
    { name: 'my-ext', global: false },
    { name: 'my-ext', global: true },
  ]);
  assert.deepEqual(extensionCandidates(null), []);
});

await check('第一条路径不对 → 自动换下一条，成功后记住它', async () => {
  const seen = [];
  let remembered = null;
  const ctx = {
    updateExtension: async (arg) => {
      seen.push(arg);
      return arg.global === true ? { ok: false, reason: 'http-404' } : { ok: true };
    },
    showSystemMessage: () => {},
  };
  const updater = createExtensionUpdater({
    ctx,
    folder: FOLDER,
    remember: (candidate) => { remembered = candidate; },
    refreshVersion: () => ({ action: 'reload' }),
    delayMs: 0,
  });

  const result = await updater.apply();
  assert.equal(result.ok, true, '第二条候选成功了就不算失败');
  assert.equal(seen.length, 2);
  assert.deepEqual(remembered, { name: 'third-party/导演时间', global: false }, '要记住试中的那条');
});

await check('记住的那条排最前（下次一击即中）', async () => {
  const seen = [];
  const ctx = { updateExtension: async (arg) => { seen.push(arg); return { ok: true }; } };
  const updater = createExtensionUpdater({
    ctx,
    folder: FOLDER,
    remembered: () => ({ name: '导演时间', global: false }),
    refreshVersion: () => ({ action: 'reload' }),
  });
  await updater.apply();
  assert.deepEqual(seen, [{ name: '导演时间', global: false }], '先试记住的那条');
});

await check('成功但版本检查没触发刷新 → 自己兜底刷新', async () => {
  const { updater, calls } = makeUpdater({
    updateExtension: async () => ({ ok: true }),
    refreshVersion: () => ({ action: 'skip', reason: 'same-version' }),
  });
  const result = await updater.apply();
  assert.equal(result.ok, true);
  await tick();
  assert.equal(calls.reload, 1, '该刷新还是要刷新');
  assert.ok(calls.system.some((text) => text.includes('刷新')), '要提示用户正在刷新');
});

await check('失败：不刷新、不假装成功，给一句能照做的话', async () => {
  const { updater, calls } = makeUpdater({ updateExtension: async () => ({ ok: false, reason: 'http-404' }) });
  const result = await updater.apply();
  assert.equal(result.ok, false);
  assert.equal(result.manual, true);
  assert.ok(result.message.includes('扩展'), '要指引到「扩展」面板手动更新');
  assert.ok(result.message.includes('http-404'), '要带上失败原因，便于排查');
  await tick();
  assert.equal(calls.reload, 0, '失败绝不能刷新');
  assert.equal(calls.system.length, 0);
});

await check('认不出插件目录 → 不调接口，直接给手动路径', async () => {
  let called = 0;
  const updater = createExtensionUpdater({
    ctx: { updateExtension: async () => { called += 1; return { ok: true }; } },
    folder: null,
  });
  const result = await updater.apply();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown-folder');
  assert.equal(called, 0);
});

await check('酒馆没有更新接口 → manual，不崩', async () => {
  const updater = createExtensionUpdater({ ctx: {}, folder: FOLDER });
  const result = await updater.apply();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported');
  assert.ok(result.message.includes('扩展'));
});

await check('连点两下：第二下拒绝，不会并发拉两份', async () => {
  let release = null;
  const { updater } = makeUpdater({
    updateExtension: () => new Promise((resolve) => { release = () => resolve({ ok: true }); }),
    refreshVersion: () => ({ action: 'reload' }),
  });
  const first = updater.apply();
  const second = await updater.apply();
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'busy');
  release();
  assert.equal((await first).ok, true);
});

console.log('T-420 · 版本检测（补上此前缺失的覆盖）');

function makeCheckEnv({ manifest, fetchImpl, loadedVersion = '', marker = null, reload } = {}) {
  const saved = [];
  const store = { getSettings: () => ({ loadedVersion }), saveSettings: (patch) => saved.push(patch) };
  const session = { getItem: () => marker, setItem: () => {} };
  const messages = [];
  const calls = { reload: 0 };
  return {
    saved,
    run: () => checkForUpdate({
      ctx: { showSystemMessage: (text) => messages.push(text) },
      store,
      manifestUrl: 'https://host/manifest.json',
      fetchImpl: fetchImpl ?? (async () => ({ ok: true, json: async () => manifest })),
      sessionStore: session,
      reload: () => { calls.reload += 1; },
      delayMs: 0,
    }),
    messages,
    calls,
  };
}

await check('首次运行：记录版本，不刷新', async () => {
  const env = makeCheckEnv({ manifest: { version: '0.3.1' } });
  assert.equal((await env.run()).action, 'record');
  assert.deepEqual(env.saved, [{ loadedVersion: '0.3.1' }]);
  assert.equal(env.calls.reload, 0);
});

await check('检测到新版本：提示 + 刷新一次 + 打防循环标记', async () => {
  const env = makeCheckEnv({ manifest: { version: '0.3.1' }, loadedVersion: '0.3.0' });
  const result = await env.run();
  assert.equal(result.action, 'reload');
  assert.ok(env.messages[0].includes('0.3.1'));
  await tick();
  assert.equal(env.calls.reload, 1);
});

await check('同一版本 / 已经刷过 → 不刷新', async () => {
  const same = makeCheckEnv({ manifest: { version: '0.3.1' }, loadedVersion: '0.3.1' });
  assert.equal((await same.run()).action, 'skip');
  assert.equal(same.calls.reload, 0);

  const loop = makeCheckEnv({ manifest: { version: '0.3.1' }, loadedVersion: '0.3.0', marker: '0.3.1' });
  assert.equal((await loop.run()).action, 'record');
  assert.equal(loop.calls.reload, 0);
});

await check('任何失败都静默跳过（绝不影响主流程）', async () => {
  const http = makeCheckEnv({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(await http.run(), { action: 'skip', reason: 'http-500' });

  const boom = makeCheckEnv({ fetchImpl: async () => { throw new Error('断网'); } });
  assert.equal((await boom.run()).action, 'skip');

  // 没有配置 manifest 地址 → 直接跳过（连 fetch 都不试）
  const noUrl = await checkForUpdate({ ctx: {}, store: { getSettings: () => ({}) } });
  assert.equal(noUrl.reason, 'no-fetch');

  // 地址不合法 → 静默 skip，不抛
  const badUrl = await checkForUpdate({ ctx: {}, store: { getSettings: () => ({}) }, manifestUrl: 'x' });
  assert.equal(badUrl.action, 'skip');
});

console.log('T-420 · 酒馆接口（context 层）');

await check('updateExtension：POST 到酒馆接口，带 CSRF 头', async () => {
  let captured = null;
  const host = {
    getRequestHeaders: () => ({ 'X-CSRF-Token': 'tok' }),
    fetch: async (url, options) => {
      captured = { url, options };
      return { ok: true };
    },
  };
  const ctx = createSillyTavernContext(() => host);
  const result = await ctx.updateExtension({ name: 'third-party/导演时间', global: true });

  assert.equal(result.ok, true);
  assert.equal(captured.url, '/api/extensions/update');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['X-CSRF-Token'], 'tok');
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body, { extensionName: 'third-party/导演时间', global: true });
  assert.equal(ctx.capabilities.requestHeaders, true);
});

await check('updateExtension：酒馆拒绝 / 断网 / 没名字，都如实返回失败', async () => {
  const ctx404 = createSillyTavernContext(() => ({ fetch: async () => ({ ok: false, status: 404 }) }));
  assert.deepEqual(await ctx404.updateExtension({ name: 'x' }), { ok: false, reason: 'http-404', status: 404 });

  const ctxBoom = createSillyTavernContext(() => ({ fetch: async () => { throw new Error('断网'); } }));
  const boom = await ctxBoom.updateExtension({ name: 'x' });
  assert.equal(boom.ok, false);
  assert.equal(boom.reason, 'network');

  const ctxAny = createSillyTavernContext(() => ({ fetch: async () => ({ ok: true }) }));
  assert.equal((await ctxAny.updateExtension({})).reason, 'no-name');
  assert.equal((await ctxAny.updateExtension({ name: '   ' })).reason, 'no-name');
});

console.log('检查更新（用户反馈 13：要真去比版本，不能没查就报成功）');

await check('版本比较：按段比数字，缺的当 0', () => {
  assert.ok(compareVersion('0.4.2', '0.4.1') > 0);
  assert.ok(compareVersion('0.4.1', '0.4.2') < 0);
  assert.equal(compareVersion('0.4.1', '0.4.1'), 0);
  assert.ok(compareVersion('1.0.0', '0.9.9') > 0);
  assert.ok(compareVersion('0.4.10', '0.4.9') > 0, '10 要比 9 大，不能按字符串比');
  assert.equal(compareVersion('0.4', '0.4.0'), 0);
});

await check('远程清单地址：从 manifest.homepage 推，非 GitHub 地址不猜', () => {
  assert.deepEqual(remoteManifestUrls('https://github.com/Tuntunshu-M/DirectorTime'), [
    'https://raw.githubusercontent.com/Tuntunshu-M/DirectorTime/main/manifest.json',
    'https://raw.githubusercontent.com/Tuntunshu-M/DirectorTime/master/manifest.json',
  ]);
  assert.deepEqual(remoteManifestUrls('https://github.com/a/b.git', { branch: 'dev' }), [
    'https://raw.githubusercontent.com/a/b/dev/manifest.json',
  ]);
  assert.deepEqual(remoteManifestUrls('https://example.com/x'), []);
  assert.deepEqual(remoteManifestUrls(''), []);
});

await check('有新版本：报 new + 给出两边版本号', async () => {
  const checker = createUpdateChecker({
    manifestUrl: 'https://host/ext/manifest.json',
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => (url.includes('raw.githubusercontent')
        ? { version: '0.5.0' }
        : { version: '0.4.2', homepage: 'https://github.com/a/b' }),
    }),
  });
  const result = await checker.check();
  assert.equal(result.ok, true);
  assert.equal(result.hasUpdate, true);
  assert.equal(result.local, '0.4.2');
  assert.equal(result.remote, '0.5.0');
  assert.ok(result.message.includes('有新版本'));
});

await check('没有新版本：明确说"已是最新版"', async () => {
  const checker = createUpdateChecker({
    manifestUrl: 'https://host/ext/manifest.json',
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => (url.includes('raw.githubusercontent')
        ? { version: '0.4.2' }
        : { version: '0.4.2', homepage: 'https://github.com/a/b' }),
    }),
  });
  const result = await checker.check();
  assert.equal(result.hasUpdate, false);
  assert.ok(result.message.includes('已是最新版'), result.message);
});

await check('查不到远程：如实说查不到，绝不假装"已是最新"', async () => {
  const offline = createUpdateChecker({
    manifestUrl: 'https://host/ext/manifest.json',
    fetchImpl: async (url) => {
      if (url.includes('raw.githubusercontent')) throw new Error('断网');
      return { ok: true, json: async () => ({ version: '0.4.2', homepage: 'https://github.com/a/b' }) };
    },
  });
  const result = await offline.check();
  assert.equal(result.ok, false);
  assert.equal(result.local, '0.4.2');
  assert.ok(result.message.includes('连不上'), result.message);
  assert.equal(result.message.includes('已是最新'), false, '查不到就不能说"已是最新"');
});

await check('没声明 homepage：明说查不了，不去猜地址', async () => {
  const checker = createUpdateChecker({
    manifestUrl: 'https://host/ext/manifest.json',
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.4.2' }) }),
  });
  const result = await checker.check();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-homepage');
  assert.ok(result.message.includes('没声明仓库地址'), result.message);
});

console.log(`\n通过 ${passed} 项`);
