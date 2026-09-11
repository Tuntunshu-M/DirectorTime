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
        // 主连接模式才需要；独立 API 模式禁用（禁则 G1）
        rawGeneration: hasFunction(host.generateRaw),
      };
    },

    getContext: getHost,

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
    getWorldInfoNames() {
      const host = getHost();
      const names = hasFunction(host.getWorldInfoNames) ? host.getWorldInfoNames() : host.world_names;
      return [...new Set((Array.isArray(names) ? names : []).filter(Boolean).map(String))];
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

      return [
        { type: 'global', label: '全局世界书', names: ctx.getWorldInfoNames() },
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
