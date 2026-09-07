// 导演时间 · 状态版本迁移
//
// T-103。旧版本状态必须可读不崩；缺字段一律用默认值补齐。
// 新增字段时：SCHEMA_VERSION +1，并在这里补一个迁移函数。

import { SCHEMA_VERSION, createDefaultState } from './default-state.js';

/**
 * 迁移步骤表：键为「迁移前的版本号」。
 * 目前只有 v1，暂无迁移步骤；后续每个版本在此追加。
 *   export const MIGRATIONS = { 1: (state) => ({ ...state, newField: 'x', schemaVersion: 2 }) };
 */
export const MIGRATIONS = {};

/**
 * @param {unknown} raw 从 chatMetadata 读到的原始值
 * @returns {object} 一定是合法且补齐了默认字段的状态
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultState();

  let state = { ...raw };
  let version = Number.isInteger(state.schemaVersion) ? state.schemaVersion : 0;

  // 来自未来的版本：不猜，直接按当前默认结构兜底，但保留原数据副本便于排查
  if (version > SCHEMA_VERSION) {
    return { ...createDefaultState(), ...state, schemaVersion: SCHEMA_VERSION };
  }

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    state = step ? step(state) : state;
    version += 1;
    state.schemaVersion = version;
  }

  // 补齐所有缺失字段（新增字段后老数据也不会缺）
  return { ...createDefaultState(), ...state, schemaVersion: SCHEMA_VERSION };
}
