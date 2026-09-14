// 导演时间 · SillyTavern 适配层
//
// T-102。全局禁则 G7：所有 getContext() 调用必须集中在本文件。
// 其它模块一律通过这里暴露的方法访问酒馆，禁止自己拿 context。
//
// 关键设计：
// 1. 能力探测 —— ST 版本差异大，不假设任何 API 存在
// 2. 注入参数封死 —— position/depth/scan/role 固定为实测正确值，调用方改不了

// 注入到聊天记录末尾、system 角色、不触发世界书扫描（见项目书 §4.3）
const INJECT_POSITION = 1;
const INJECT_DEPTH = 0;
const INJECT_SCAN = false;
const INJECT_ROLE = 0;

function defaultProvider() {
  try {
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
      return SillyTavern.getContext();
    }
  } catch {
    /* 忽略：未运行在酒馆中 */
  }
  return {};
}

function hasFunction(value) {
  return typeof value === 'function';
}

function normalizeEntries(entries) {
  const list = Array.isArray(entries)
    ? entries
    : Object.entries(entries ?? {}).map(([id, entry]) => ({ id, ...entry }));

  return list.map((entry, index) => ({
    id: String(entry.id ?? entry.uid ?? index),
    name: entry.name ?? entry.comment ?? entry.keys?.join(', ') ?? `条目 ${index + 1}`,
    content: entry.content ?? entry.text ?? '',
  }));
}

// ---------- T-418 酒馆预设（只读、探测式）----------
//
// 纪律：**不硬编码任何 API 形状**。不同酒馆版本暴露的预设接口名字不一样，
// 所以这里只做两件事：① 拿到 presetManager（拿不到就返回 null）② 在它身上找
// "名字里带 preset 且带 list/names" 的方法，试出来为止。试不出来就返回空，
// 绝不编一份假的预设列表（清单 T-418：「探测不到就停下报告」）。

function findPresetManager(host) {
  if (!hasFunction(host?.getPresetManager)) return null;
  try {
    const manager = host.getPresetManager();
    return manager && typeof manager === 'object' ? manager : null;
  } catch {
    return null;
  }
}

/** 管理器上所有方法名（含原型链），诊断与探测共用 */
function presetManagerMethods(manager) {
  if (!manager) return [];
  const names = new Set([
    ...Object.keys(manager ?? {}),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(manager) ?? {}),
  ]);
  return [...names].filter((name) => hasFunction(manager[name])).sort();
}

/** 把各种可能的形状收成名字数组 */
function normalizePresetNames(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : item?.name ?? item?.id ?? ''))
      .filter(Boolean);
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.presets)) return normalizePresetNames(value.presets);
    if (Array.isArray(value.preset_names)) return normalizePresetNames(value.preset_names);
    if (Array.isArray(value.names)) return normalizePresetNames(value.names);
  }
  return [];
}

function probePresetNames(manager) {
  if (!manager) return [];
  const candidates = presetManagerMethods(manager)
    .filter((name) => /preset/i.test(name) && /(list|names|all)/i.test(name));
  for (const method of candidates) {
    try {
      const found = normalizePresetNames(manager[method]());
      if (found.length) return found;
    } catch {
      /* 这个方法不是干这个的，试下一个 */
    }
  }
  return [];
}

/**
 * 按名字取预设对象。
 * 候选排序很讲究：**先 "byName"，再 "get"，但排除 "list/names/all"** ——
 * 否则 getPresetList 也会被当成"按名字取"，传个名字进去还会回一份列表。
 */
function probePresetByName(manager, name) {
  if (!manager || !name) return null;

  const withPreset = presetManagerMethods(manager).filter((method) => /preset/i.test(method));
  const candidates = [
    ...withPreset.filter((method) => /(byname|by_name)/i.test(method)),
    ...withPreset.filter((method) => (
      !/(byname|by_name)/i.test(method)
      && /(get|content|prompt)/i.test(method)
      && !/(list|names|all)/i.test(method)
    )),
  ];

  for (const method of candidates) {
    try {
      const value = manager[method](name);
      // 预设应该是对象（或整块文本）；数组说明这是"列预设"的方法，不是我们要的
      if (typeof value === 'string' ? value.trim() : (value && typeof value === 'object' && !Array.isArray(value))) {
        return value;
      }
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

function normalizeBook(name, book) {
  return {
    name,
    entries: normalizeEntries(book?.entries ?? book).map((entry) => ({ ...entry, bookName: name })),
  };
}

export function createSillyTavernContext(contextProvider = defaultProvider) {
  function getHost() {
    try {
      return contextProvider() ?? {};
    } catch {
      return {};
    }
  }

  const ctx = {
    // ---------- 能力探测 ----------
    get capabilities() {
      const host = getHost();
      return {
        context: typeof contextProvider === 'function',
        chat: host.chatId !== undefined || host.chatMetadata !== undefined,
        character: Array.isArray(host.characters) && host.characterId !== undefined,
        messages: Array.isArray(host.chat),
        setExtensionPrompt: hasFunction(host.setExtensionPrompt),
        saveSettings: hasFunction(host.saveSettingsDebounced),
        chatState: hasFunction(host.saveMetadataDebounced) || hasFunction(host.saveMetadata),
        confirmation: hasFunction(host.Popup?.show?.confirm) || hasFunction(host.popup?.confirm),
        events: hasFunction(host.eventSource?.on),
        worldInfo: hasFunction(host.loadWorldInfo) || hasFunction(host.getWorldInfoNames) || Array.isArray(host.world_names),
        // T-418：只声明"有取预设管理器的方法"，能不能真列出预设由 probe 的实测结果说话
        presets: hasFunction(host.getPresetManager),
        // 一键更新：拿得到 CSRF 头才能调酒馆的写接口（拿不到也试，失败会如实返回）
        requestHeaders: hasFunction(host.getRequestHeaders),
        // 主连接模式才需要；独立 API 模式禁用（禁则 G1）
        rawGeneration: hasFunction(host.generateRaw),
      };
    },

    getContext: getHost,

    // ---------- 酒馆预设（T-418，只读）----------

    /** 实测这个酒馆把预设暴露成什么样（诊断用，"探测不到"时靠它给证据） */
    probePresetInterface() {
      const host = getHost();
      const manager = findPresetManager(host);
      if (!manager) {
        return {
          hasGetter: hasFunction(host.getPresetManager),
          hasManager: false,
          methods: [],
          names: [],
        };
      }
      return {
        hasGetter: true,
        hasManager: true,
        methods: presetManagerMethods(manager),
        names: probePresetNames(manager),
      };
    },

    /** 列出预设名；拿不到返回空数组（绝不抛、绝不编） */
    listPresets() {
      return probePresetNames(findPresetManager(getHost()));
    },

    /** 按名字读一个预设对象；读不到返回 null */
    readPreset(name) {
      return probePresetByName(findPresetManager(getHost()), name);
    },

    // ---------- 一键更新（T-420：在导演时间里点一下就更新 + 刷新）----------

    /** 酒馆的 CSRF / 认证头；拿不到就返回空对象（更老版本可能不需要） */
    getRequestHeaders() {
      const host = getHost();
      if (!hasFunction(host.getRequestHeaders)) return {};
      try {
        return host.getRequestHeaders() ?? {};
      } catch {
        return {};
      }
    },

    /**
     * 让酒馆自己把扩展更新到最新（内部就是 git pull）。
     *
     * ⚠️ 走的是酒馆的 REST 接口 `/api/extensions/update`，**不保证每个版本都有这个接口**。
     * 所以这里的策略是"试了才知道"：拿不到成功响应就如实返回失败，
     * 由调用方提示用户去「扩展」面板手动更新 —— 绝不假装成功（清单：探测不到就停下报告）。
     *
     * @param {{ name: string, global?: boolean }} options 酒馆认的扩展名（如 third-party/导演时间）
     */
    async updateExtension({ name, global = false } = {}) {
      const label = String(name ?? '').trim();
      if (!label) return { ok: false, reason: 'no-name' };

      const host = getHost();
      const doFetch = hasFunction(host.fetch) ? host.fetch : globalThis.fetch;
      if (!hasFunction(doFetch)) return { ok: false, reason: 'no-fetch' };

      try {
        const response = await doFetch('/api/extensions/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...ctx.getRequestHeaders() },
          body: JSON.stringify({ extensionName: label, global: Boolean(global) }),
        });
        if (!response?.ok) {
          return { ok: false, reason: `http-${response?.status ?? 'error'}`, status: response?.status ?? 0 };
        }
        return { ok: true, name: label };
      } catch (error) {
        return { ok: false, reason: 'network', error: error?.message ?? '' };
      }
    },

    // ---------- 基础读取 ----------
    getMessages() {
      return getHost().chat ?? [];
    },

    getCharacterData() {
      const host = getHost();
      return host.characters?.[host.characterId] ?? null;
    },

    getCharacterId() {
      return getHost().characterId ?? null;
    },

    /**
     * 2026-09-14：酒馆里的**角色卡列表**（多人卡自选用）。
     * 只取 id + 名字（不读卡内容）—— 用户在人物页勾选"要攻略谁"。
     * id 用数组下标（与 getCharacterField / 侧写按角色分存的 id 口径一致）。
     */
    listCharacters() {
      const host = getHost();
      const list = Array.isArray(host.characters) ? host.characters : [];
      return list
        .map((card, index) => ({
          id: String(index),
          name: String(card?.name ?? card?.data?.name ?? '').trim(),
        }))
        .filter((item) => item.name);
    },

    /** 读角色卡扩展字段（T-402 侧写存在 characters[i].data.extensions[director_time]） */
    getCharacterField(key, charId = null) {
      const host = getHost();
      const id = charId ?? host.characterId;
      return host.characters?.[id]?.data?.extensions?.[key] ?? null;
    },

    /** 写角色卡扩展字段；优先用 ST 的 writeExtensionField（它会自己触发保存） */
    writeCharacterField(key, value, charId = null) {
      const host = getHost();
      const id = charId ?? host.characterId;
      if (hasFunction(host.writeExtensionField)) return host.writeExtensionField(id, key, value);

      const character = host.characters?.[id];
      if (!character) return null;
      character.data = { ...(character.data ?? {}) };
      character.data.extensions = { ...(character.data.extensions ?? {}), [key]: value };
      return value;
    },

    getCurrentChatKey() {
      const host = getHost();
      return host.chatId ?? host.chatMetadata?.chat_id ?? null;
    },

    // ---------- 注入（唯一入口）----------
    setExtensionPrompt(key, value) {
      return getHost().setExtensionPrompt?.(key, value, INJECT_POSITION, INJECT_DEPTH, INJECT_SCAN, INJECT_ROLE);
    },

    clearExtensionPrompt(key) {
      return ctx.setExtensionPrompt(key, '');
    },

    // ---------- 世界书 ----------
    /** 酒馆里**所有**世界书的书名（书名库） */
    getWorldInfoNames() {
      const host = getHost();
      const names = hasFunction(host.getWorldInfoNames) ? host.getWorldInfoNames() : host.world_names;
      return [...new Set((Array.isArray(names) ? names : []).filter(Boolean).map(String))];
    },

    /**
     * 2026-09-14 反馈 #3：**酒馆里"全局世界书"= 全局启用的那几本**（世界书面板里打了全局开关的），
     * 不是"酒馆里一共有多少本"。以前把全部书名塞进「全局世界书」分组，标签是假的。
     *
     * 酒馆没把这个列表暴露给扩展时**如实回报 readable:false**（不拿全部书名冒充全局）。
     * 探测多个可能的位置：不同版本放的地方不一样，认不出来就返回空 + readable:false。
     */
    getGlobalWorldInfoNames() {
      const host = getHost();
      const looksLikeList = (value) => Array.isArray(value) || typeof value === 'string';
      const candidates = [
        () => host.worldInfo?.globalSelect,
        () => host.world_info?.globalSelect,
        () => host.getWorldInfoGlobalSelect?.(),
        () => host.powerUserSettings?.world_info,
        () => host.power_user?.world_info,
        () => host.worldInfoGlobal,
      ];
      for (const read of candidates) {
        try {
          const value = read();
          if (!looksLikeList(value)) continue;
          const names = (Array.isArray(value) ? value : [value])
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => name.trim());
          return { names: [...new Set(names)], readable: true };
        } catch {
          // 探测下一个
        }
      }
      return { names: [], readable: false };
    },

    async loadWorldInfoBook(name) {
      const host = getHost();
      if (!hasFunction(host.loadWorldInfo)) {
        throw new Error('SillyTavern 世界书加载能力不可用');
      }
      return normalizeBook(name, await host.loadWorldInfo(name));
    },

    /** 角色卡内嵌世界书（character_book）—— 最容易被漏掉的一类来源 */
    getCharacterBookEntries() {
      const host = getHost();
      const entries = host.characters?.[host.characterId]?.data?.character_book?.entries;
      return Array.isArray(entries) ? normalizeEntries(entries) : [];
    },

    /**
     * 2026-09-14 反馈 #2：**user 的人设**（SillyTavern 的 persona）。
     *
     * 以前剧本 / 侧写生成完全看不到"用户是谁" —— 用户在 persona 里写了"讨厌薄荷"，
     * 模型还让 char 送薄荷。酒馆各版本把 persona 放在不同地方，这里逐个探测；
     * 认不出来就返回空（**不猜、不编**，也不拿角色卡去冒充用户）。
     * @returns {{name: string, description: string}}
     */
    getUserPersona() {
      const host = getHost();
      const avatar = host.user_avatar ?? host.userAvatar ?? null;
      const pick = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');
      const first = (candidates) => {
        for (const read of candidates) {
          try {
            const value = pick(read());
            if (value) return value;
          } catch {
            // 探测下一个
          }
        }
        return '';
      };

      const name = first([
        () => host.name1,
        () => host.personas?.[avatar],
        () => host.powerUserSettings?.personas?.[avatar],
        () => host.power_user?.personas?.[avatar],
      ]);
      const description = first([
        () => host.persona_descriptions?.[avatar]?.description,
        () => host.powerUserSettings?.persona_descriptions?.[avatar]?.description,
        () => host.power_user?.persona_descriptions?.[avatar]?.description,
        () => host.personas?.[avatar]?.description,
      ]);

      return { name, description };
    },

    /**
     * 世界书来源枚举（项目书 §F1）：全局 / 角色主 / 角色附加 / 人格 / 聊天（按名字加载）
     * + 角色卡内嵌（直接读条目）。ST 版本差异大，缺哪类就返回空数组，不报错。
     */
    getLorebookSources() {
      const host = getHost();
      const character = host.characters?.[host.characterId] ?? null;
      const persona = host.user_avatar ? host.personas?.[host.user_avatar] : null;
      const asNames = (value) => {
        if (!value) return [];
        return (Array.isArray(value) ? value : [value])
          .filter((name) => typeof name === 'string' && name.trim())
          .map((name) => name.trim());
      };

      // 2026-09-14 反馈 #3：拆成两组 —— 「全局世界书」只放酒馆里全局启用的那几本，
      // 其余的书仍在（放到「其它世界书」组里，默认折叠），不丢功能，只是标签不再骗人。
      const allNames = ctx.getWorldInfoNames();
      const global = ctx.getGlobalWorldInfoNames();
      const globalSet = new Set(global.names);
      const rest = allNames.filter((name) => !globalSet.has(name));

      return [
        {
          type: 'global',
          label: '全局世界书（酒馆里全局启用）',
          names: global.names,
          ...(global.readable ? {} : { hint: '这个酒馆版本没把"全局启用"列表给扩展，所以这组是空的；全部书在下面那组里' }),
        },
        {
          type: 'library',
          label: global.readable ? '其它世界书（未全局启用）' : '全部世界书（没能读到全局启用列表）',
          names: rest,
        },
        { type: 'character-primary', label: '角色主世界书', names: asNames(character?.world) },
        { type: 'character-extra', label: '角色附加世界书', names: asNames(character?.data?.extensions?.world ?? character?.extraBooks) },
        { type: 'persona', label: '人格世界书', names: asNames(persona?.world_info ?? persona?.world) },
        { type: 'chat', label: '聊天世界书', names: asNames(host.chatMetadata?.world_info) },
        { type: 'character-embedded', label: '角色卡内嵌', names: [], embedded: true },
      ];
    },

    // ---------- 存储 ----------
    getExtensionSettings() {
      return getHost().extensionSettings ?? {};
    },

    saveSettings() {
      return getHost().saveSettingsDebounced?.();
    },

    getChatState() {
      const host = getHost();
      return host.chatMetadata ?? null;
    },

    saveChatState() {
      const host = getHost();
      return (host.saveMetadataDebounced ?? host.saveMetadata)?.();
    },

    // ---------- 交互 ----------
    showSystemMessage(message) {
      const host = getHost();
      if (hasFunction(host.showSystemMessage)) return host.showSystemMessage(message);
      if (typeof globalThis.toastr?.info === 'function') return globalThis.toastr.info(message);
      return undefined;
    },

    async showConfirm(message) {
      const host = getHost();
      const confirm = host.Popup?.show?.confirm ?? host.popup?.confirm;
      if (!hasFunction(confirm)) return Promise.resolve(false);
      return confirm(message);
    },

    on(eventName, listener) {
      const eventSource = getHost().eventSource;
      if (!hasFunction(eventSource?.on)) return () => {};
      eventSource.on(eventName, listener);
      return () => eventSource.off?.(eventName, listener);
    },
  };

  return ctx;
}
