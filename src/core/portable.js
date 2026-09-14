// 导演时间 · 副本迁移（T-413）
//
// 把整个副本（剧本 / 阶段 / 剧情占比 / 设置 / 侧写 / 世界书选择）打包成一份 JSON，
// 换台机器、换个聊天都能搬过去。
//
// 两条纪律：
//   1. **往返无损**：导出 → 导入 → 再导出，必须一模一样（id 都不许换）
//   2. **密钥不搬家**：导演 API 的端点 / 密钥 / 模型不进副本 —— 分享副本不该泄露密钥，
//      导入时也不覆盖你本机的连接配置

export const COPY_FORMAT = 'director-time-copy';
export const COPY_VERSION = 1;

/** 允许搬家的设置项（显式白名单：多一项都可能带出隐私） */
export const PORTABLE_SETTINGS = [
  'enabled', 'injectEnabled', 'will', 'forceAffection',
  'objective', 'pacing', 'stuckThreshold', 'confidenceThreshold', 'maxRounds',
  'consistencyCheck', 'hardLimits', 'protagonists', 'breakFilter', 'rules',
  'worldSelection', 'worldLimit', 'automation',
];

function pickSettings(settings = {}) {
  const out = {};
  for (const key of PORTABLE_SETTINGS) {
    if (settings?.[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

/** 导出：打包成可搬运的普通对象（调用方自己 JSON.stringify） */
export function exportCopy({ state, settings, profile, now = Date.now } = {}) {
  return {
    format: COPY_FORMAT,
    version: COPY_VERSION,
    exportedAt: now(),
    outline: state?.outline ?? null,
    stages: state?.stages ?? [],
    activeStageId: state?.activeStageId ?? null,
    tone: state?.tone ?? null,
    // 剧情占比释义的用户改动（2026-09-14）：不带的话，副本搬过去释义会悄悄变回内置
    toneHints: state?.toneHints ?? null,
    settings: pickSettings(settings),
    profile: profile ?? null,
  };
}

/** 概览 + 警告：导入前给用户看的（判据 2） */
export function previewCopy(copy) {
  if (!copy || typeof copy !== 'object') {
    return { ok: false, error: '这不是一份副本文件（JSON 解析失败或内容为空）', warnings: [], summary: null };
  }
  if (copy.format !== COPY_FORMAT) {
    return { ok: false, error: '这不是「导演时间」的副本文件', warnings: [], summary: null };
  }

  const warnings = [];
  if (Number(copy.version) > COPY_VERSION) {
    warnings.push(`副本版本（v${copy.version}）比当前插件（v${COPY_VERSION}）新，可能有字段读不出来`);
  }
  const stages = Array.isArray(copy.stages) ? copy.stages : [];
  if (!stages.length) warnings.push('这份副本没有阶段（导入后需要重新生成剧本）');
  if (!copy.profile) warnings.push('这份副本没有人物侧写（导入后按本机角色卡重新生成）');

  const settings = copy.settings ?? {};
  return {
    ok: true,
    warnings,
    summary: {
      format: copy.format,
      version: copy.version,
      title: copy.outline?.title ?? '',
      objective: copy.outline?.objective ?? '',
      stages: stages.length,
      foreshadows: (copy.outline?.foreshadows ?? []).length,
      hasProfile: Boolean(copy.profile),
      protagonists: Array.isArray(settings.protagonists) ? settings.protagonists.length : 0,
      worldSelection: Object.keys(settings.worldSelection ?? {}).length,
      settings: Object.keys(settings).length,
      exportedAt: copy.exportedAt ?? 0,
    },
  };
}

/**
 * 应用副本。只动"副本语义"里的东西：
 * 剧本 + 设置白名单 + 侧写；runtime / cost / 连接配置一律保持本机现状。
 */
export function applyCopy(copy, { store, writeProfile } = {}) {
  const preview = previewCopy(copy);
  if (!preview.ok) return { ok: false, error: preview.error, warnings: preview.warnings };

  const settings = pickSettings(copy.settings ?? {});
  const stages = Array.isArray(copy.stages) ? copy.stages : [];
  store?.update?.((draft) => ({
    ...draft,
    outline: copy.outline ?? null,
    stages,
    activeStageId: copy.activeStageId ?? stages[0]?.id ?? null,
    tone: copy.tone ?? draft.tone,
    // 老副本没有 toneHints 字段 → 保留本机现有的（别把用户改过的释义清掉）
    toneHints: copy.toneHints ?? draft.toneHints,
    // 换了一份副本 = 重新起一局：轮数与注入状态归零，连接配置与本机花费不动
    runtime: { ...draft.runtime, rounds: 0, promptRegistered: false, speculation: null, lastReviewAt: 0 },
  }), { label: '导入副本' });

  if (settings && Object.keys(settings).length) store?.saveSettings?.(settings);
  if (copy.profile && typeof writeProfile === 'function') writeProfile(copy.profile);

  return { ok: true, warnings: preview.warnings, summary: preview.summary };
}
