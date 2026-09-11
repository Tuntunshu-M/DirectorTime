// 导演时间 · 酒馆菜单栏入口
//
// 参考前身仓库 just-do-it-char 的 mountWandEntry：
//   SillyTavern 的扩展菜单容器是 #extensionsMenu，往里塞一个 .extension_container 即可出现在菜单里。
//
// 两个必须的细节（旧仓库踩过的坑）：
//   1. 酒馆会重绘菜单 DOM —— 用 MutationObserver 兜底重挂，否则入口会消失
//   2. 点菜单后酒馆要先收起菜单 —— 延后一帧再开面板，否则会被收起动画吞掉

const CONTAINER_ID = 'dt-menu-container';
const ENTRY_ID = 'dt-menu-entry';

export function mountMenuEntry({ onOpen, document: doc = globalThis.document } = {}) {
  if (!doc) return () => {};

  function openSoon(entry) {
    let opened = false;
    const run = () => {
      if (opened) return;
      opened = true;
      entry.__dtOpen?.();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(run));
    }
    setTimeout(run, 80);
  }

  let warnedMissingMenu = false;

  function ensure() {
    const menu = doc.querySelector('#extensionsMenu');
    if (!menu) {
      if (!warnedMissingMenu) {
        warnedMissingMenu = true;
        console.warn('[导演时间] 暂未找到 #extensionsMenu，入口等酒馆渲染后自动挂载');
      }
      return;
    }

    const existing = doc.getElementById(ENTRY_ID);
    if (existing) {
      existing.__dtOpen = onOpen;
      const container = doc.getElementById(CONTAINER_ID);
      if (container && container.parentElement !== menu) menu.append(container);
      return;
    }

    const container = doc.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'extension_container interactable';
    container.tabIndex = 0;

    const entry = doc.createElement('div');
    entry.id = ENTRY_ID;
    entry.className = 'dt-menu-entry list-group-item flex-container flexGap5 interactable';
    entry.title = '打开导演时间';
    entry.setAttribute('aria-label', '打开导演时间');
    entry.setAttribute('role', 'button');
    entry.tabIndex = 0;
    entry.__dtOpen = onOpen;

    const icon = doc.createElement('span');
    icon.className = 'dt-menu-icon fa-solid fa-clapperboard extensionsMenuExtensionButton';
    icon.setAttribute('aria-hidden', 'true');

    const label = doc.createElement('span');
    label.className = 'dt-menu-label';
    label.textContent = '导演时间';

    entry.append(icon, label);
    entry.addEventListener('click', (event) => {
      event.preventDefault();
      openSoon(entry);
    });
    entry.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openSoon(entry);
      }
    });

    container.append(entry);
    menu.append(container);
    console.log('[导演时间] 菜单入口已挂载（名称：导演时间）');
  }

  ensure();

  let observer = null;
  if (typeof MutationObserver === 'function' && doc.body) {
    observer = new MutationObserver(() => ensure());
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  return () => {
    observer?.disconnect();
    doc.getElementById(CONTAINER_ID)?.remove();
  };
}
