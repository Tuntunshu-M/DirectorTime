// 导演时间 · 破限预设（T-418）
//
// 用户在酒馆里其实已经调好了一套能用的预设 —— 这里让他们直接选一个拿来当破限提示词，
// 而不是我们自己内置一套破限词（清单 T-418「不要做」第一条）。
//
// 三条纪律：
//   1. **只读**：不编辑、不保存酒馆预设（那是酒馆自己的事）
//   2. **不选 = 什么都不注入**（默认关闭，现有逻辑一点不受影响）
//   3. 读不到（接口探测失败 / 没有预设）→ 返回空串，**不报错也不伪造**

/** 从各种形状的预设对象里抠出内容文本；抠不出来就是 '' */
export function presetContentText(preset) {
  if (typeof preset === 'string') return preset.trim();
  if (!preset || typeof preset !== 'object') return '';

  // 形状一：prompts 列表（酒馆预设常见形态，条目带 enabled）
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : null;
  if (prompts) {
    return prompts
      .filter((item) => item && item.enabled !== false)
      .map((item) => String(item.content ?? item.prompt ?? '').trim())
      .filter(Boolean)
      .join('\n\n');
  }

  // 形状二：整块文本字段（不同版本叫法不同，能读到哪个用哪个）
  return String(preset.content ?? preset.prompt ?? preset.text ?? preset.instruct ?? '').trim();
}

export function createPresetService({ ctx, getSelected, setSelected } = {}) {
  const selected = () => String(getSelected?.() ?? '').trim();

  /** 酒馆里可选的预设名；读不到就是空数组 */
  function list() {
    try {
      return ctx?.listPresets?.() ?? [];
    } catch {
      return [];
    }
  }

  /** 选中预设的内容（没选 / 读不到 → ''） */
  function text(name = selected()) {
    if (!name) return '';
    try {
      return presetContentText(ctx?.readPreset?.(name));
    } catch {
      return '';
    }
  }

  function status() {
    const name = selected();
    const content = text(name);
    return {
      name,
      available: list().length,
      length: content.length,
      // 选了名字但读不到内容 → 不算生效（比如预设被删了）
      active: Boolean(name && content),
    };
  }

  function select(name) {
    setSelected?.(String(name ?? '').trim());
    return status();
  }

  function clear() {
    setSelected?.('');
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

  return { list, text, select, clear, status, probe };
}
