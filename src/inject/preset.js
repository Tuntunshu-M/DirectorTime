// 导演时间 · 破限预设（T-418）
//
// 用户在酒馆里其实已经调好了一套能用的预设 —— 这里让他们直接选一个拿来当破限提示词，
// 而不是我们自己内置一套破限词（清单 T-418「不要做」第一条）。
//
// 三条纪律：
//   1. **只读**：不编辑、不保存酒馆预设（那是酒馆自己的事）
//   2. **不选 = 什么都不注入**（默认关闭，现有逻辑一点不受影响）
//   3. 读不到（接口探测失败 / 没有预设）→ 返回空串，**不报错也不伪造**

/**
 * 把预设拆成条目（T-418 追加：用户可以**自选条目**，不是整份照搬）。
 * prompts 列表形状 → 逐条列出；整块文本 → 当成一条。
 */
export function presetEntries(preset) {
  if (!preset || typeof preset !== 'object') return [];

  const prompts = Array.isArray(preset.prompts) ? preset.prompts : null;
  if (prompts) {
    return prompts.map((item, index) => ({
      index,
      name: String(item?.name ?? item?.identifier ?? `条目 ${index + 1}`),
      content: String(item?.content ?? item?.prompt ?? '').trim(),
      enabled: item?.enabled !== false,
    }));
  }

  const content = String(preset.content ?? preset.prompt ?? preset.text ?? preset.instruct ?? '').trim();
  return content ? [{ index: 0, name: '内容', content, enabled: true }] : [];
}

/**
 * 从预设里抠出内容文本。
 * @param {object} preset 预设对象
 * @param {number[]|null} selected 只取这些条目（空 / 不传 = 全部启用的条目）
 *
 * T-432：**用户显式勾选优先于酒馆的启用状态**。
 * 勾了哪条就注入哪条，哪怕酒馆里把那条禁用了 —— 在本插件里勾选就是明确指令。
 * 只有"一个都没勾"时才回落到"全部启用条目"（老行为，零回归）。
 */
export function presetContentText(preset, selected = null) {
  if (typeof preset === 'string') return preset.trim();
  if (!preset || typeof preset !== 'object') return '';

  const all = presetEntries(preset).filter((entry) => entry.content);
  if (!all.length) return '';

  if (Array.isArray(selected) && selected.length) {
    return all
      .filter((entry) => selected.includes(entry.index))
      .map((entry) => entry.content)
      .join('\n\n');
  }
  return all.filter((entry) => entry.enabled).map((entry) => entry.content).join('\n\n');
}

export function createPresetService({ ctx, getPreset, setPreset } = {}) {
  const current = () => {
    const saved = getPreset?.() ?? {};
    return {
      name: String(saved.name ?? '').trim(),
      entries: Array.isArray(saved.entries) ? saved.entries : [],
    };
  };
  const save = (patch) => setPreset?.({ ...current(), ...patch });

  /** T-432：让"刷新到底生效没有"看得见 —— 每次真去读酒馆就打一个时间戳 */
  let lastReadAt = 0;
  const stamp = () => { lastReadAt = Date.now(); return lastReadAt; };

  /** 酒馆里可选的预设名；读不到就是空数组 */
  function list() {
    try {
      const names = ctx?.listPresets?.() ?? [];
      stamp();
      return names;
    } catch {
      return [];
    }
  }

  /** 选中预设的条目（带 selected 标记，供界面勾选） */
  function entries(name = current().name) {
    if (!name) return [];
    let raw = null;
    try {
      raw = ctx?.readPreset?.(name);
    } catch {
      raw = null;
    }
    const picked = current().entries;
    if (raw) stamp();
    return presetEntries(raw).map((entry) => ({
      ...entry,
      // 一条都没勾 = 用全部启用的条目（默认行为，与 T-418 一致）
      selected: picked.length ? picked.includes(entry.index) : entry.enabled,
    }));
  }

  /** 选中预设的内容（没选 / 读不到 → ''） */
  function text(name = current().name, selected = current().entries) {
    if (!name) return '';
    try {
      return presetContentText(ctx?.readPreset?.(name), selected);
    } catch {
      return '';
    }
  }

  function status() {
    const { name, entries: picked } = current();
    const content = text(name);
    return {
      name,
      available: list().length,
      entries: picked.length,
      length: content.length,
      // 选了名字但读不到内容 → 不算生效（比如预设被删了）
      active: Boolean(name && content),
      lastReadAt,
    };
  }

  function select(name) {
    save({ name: String(name ?? '').trim(), entries: [] });
    return status();
  }

  /** 自选条目：传条目下标数组；空数组 = 全部启用 */
  function selectEntries(indices) {
    save({ entries: (Array.isArray(indices) ? indices : []).map(Number) });
    return status();
  }

  function clear() {
    save({ name: '', entries: [] });
    return status();
  }

  /** 实测诊断：这个酒馆到底暴露了什么（探测不到时把它贴给我） */
  function probe() {
    try {
      return ctx?.probePresetInterface?.() ?? { hasGetter: false, hasManager: false, methods: [], names: [] };
    } catch {
      return { hasGetter: false, hasManager: false, methods: [], names: [] };
    }
  }

  return { list, entries, text, select, selectEntries, clear, status, probe };
}
