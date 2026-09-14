// 导演时间 · 人物页（UI 定稿 §5.3 + §2 分类「人物」）
//
// 控件（定稿 §2.1）：主角单选 #16（默认折叠）· 八字段输入 #17（手改置 locked）· 重新生成侧写 #18 · 全部解锁 #19

import { esc } from '../dom.js';
import { isProtagonist } from '../../world/cast.js';

/** 两个名字是不是同一个人（只看名字，够界面用了） */
function sameName(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

export function render(state) {
  const list = state.cast?.list ?? [];
  const current = state.cast?.current ?? '';
  const candidates = state.cast?.candidates ?? [];
  const fields = state.profileFields ?? [];
  const values = state.profile?.fields ?? {};
  const locked = state.profile?.locked ?? {};
  const generated = state.profile?.generatedAtText ?? '';

  // ---------- T-437：世界书里提到的角色 ----------
  // 2026-09-14 实机反馈三条：①「温柔/底色」混进候选 ②别的卡的角色也混进来 ③几百本全摊开。
  // → 现在：**按来源分两档**（当前角色卡的书 / 其它世界书），**两档都默认折叠**，
  //  弱线索（`XX的` `XX说`）单独进「可能是人名」，默认折叠；默认只扫当前这张卡的书。
  const worldCast = state.cast?.world ?? {};
  const worldGroups = [
    { key: 'current', group: worldCast.current ?? {}, label: '当前角色卡的世界书',
      note: '这张卡的主世界书 / 附加书 / 卡内嵌 —— 多人卡的角色一般都写在这里' },
    { key: 'other', group: worldCast.other ?? {}, label: '其它世界书（全局书等）',
      note: '全局启用的书、人格书、聊天书 —— 默认不扫，展开后点「重新识别」才扫' },
  ];
  const inProtagonists = (name) => isProtagonist(list, { name });
  // 手填项 = 没卡 id 且**不是**世界书识别出来的（否则会在上面那节重复出现两次）
  const worldDetectedNames = new Set(worldGroups.flatMap(
    (item) => (item.group.detected ?? []).map((row) => String(row.name).toLowerCase()),
  ));
  const manual = list.filter((item) => (item.manual || !item.id) && !worldDetectedNames.has(String(item.name).toLowerCase()));
  const currentChecked = Boolean(current) && isProtagonist(list, { name: current });

  /** 扫描计数行：规格要求界面上直接显示"扫了 X 条 / 共勾选 Y 条"（别只打控制台） */
  const groupCountText = (group = {}) => {
    if (!group.selectedCount) return '还没有勾选世界书条目 —— 到「世界书」里勾几条再来';
    if (group.stale) return '正在识别当前已勾选的条目…';
    // 兜底：有些快照没带 scannedOnce，但确实扫出过条数 —— 那就当扫过
    if (!group.scannedOnce && !group.scannedCount) return '这一档还没扫描 —— 点「重新识别」跑一遍（本地跑，不花 API）';
    const parts = [`扫了 ${group.scannedCount} 条 / 共勾选 ${group.selectedCount} 条`];
    if (group.otherSelected > 0) parts.push(`（另有 ${group.otherSelected} 条属于另一档）`);
    if (group.unreadable) parts.push(`${group.unreadable} 条读不到内容`);
    return parts.join('');
  };

  /** 一个候选：勾选框 + 出现次数/出处（展开能看是哪几条，点条目名跳到世界书那一本） */
  const worldRow = (item) => `
    <div class="dt-pipe-row">
      <input class="chk" type="checkbox" data-act="cast.worldToggle" data-name="${esc(item.name)}" ${inProtagonists(item.name) ? 'checked' : ''}>
      <span style="flex:1">${esc(item.name)}${sameName(item.name, current) ? ' <span class="dt-chip">当前生成者</span>' : ''}</span>
      <details class="dt-fold" data-key="cast.world:${esc(item.name)}">
        <summary>出现 ${Number(item.count ?? 0)} 次 · 出自 ${(item.sources ?? []).length} 条</summary>
        <div class="dt-pipe">
          ${(item.sources ?? []).map((source) => `<div class="dt-pipe-row">
            <button class="dt-mini" type="button" data-act="cast.worldEntry" data-book="${esc(source.bookName ?? '')}" data-entry-key="${esc(source.entryKey ?? '')}" data-type="${esc(source.sourceType ?? '')}">${esc(source.entryName || source.bookName || '（未命名条目）')}</button>
            <span class="dt-note" style="margin:0">${esc(source.bookName ?? '')}</span>
          </div>`).join('')}
        </div>
      </details>
    </div>`;

  /**
   * T-437：世界书角色识别（**只扫已勾选条目 · 本地零调用 · 绝不自动设主角**）。
   *
   * 与下面「酒馆里的角色」不是一回事：那一节读的是酒馆的角色卡列表（T-436），
   * 这一节读的是**世界书条目的正文**里提到了谁（多人卡的角色描写都在世界书里）。
   *
   * 2026-09-14：**按来源分成两档**（当前卡 / 其它世界书），每档一个折叠；
   * 档内再按「已添加 / 候选 / 弱证据」分层，弱证据默认折叠 —— 用户有几百本书，不能全摊开。
   */
  const renderWorldGroup = ({ key, group = {}, label, note }) => {
    const detected = group.detected ?? [];
    const added = detected.filter((item) => inProtagonists(item.name));
    const pending = detected.filter((item) => !inProtagonists(item.name));
    const weakList = (group.weak ?? []).filter((item) => !inProtagonists(item.name));
    return `<details class="dt-fold" data-key="cast.world.${key}">
      <summary>${esc(label)} · 候选 ${detected.length}${pending.length ? ` · 未勾 ${pending.length}` : ''}</summary>
      <div class="dt-note" style="margin-top:0">${esc(note)}</div>
      <div class="dt-note">${esc(groupCountText(group))}
        <button class="dt-mini" type="button" data-act="cast.rescan" data-scope="${esc(key)}">重新识别</button>
      </div>
      ${added.length ? `<div class="dt-lbl">已添加（${added.length}）</div>${added.map(worldRow).join('')}` : ''}
      ${pending.length ? `<div class="dt-lbl">候选（${pending.length}）</div>${pending.map(worldRow).join('')}` : ''}
      ${!added.length && !pending.length
        ? '<div class="dt-note">这一档还没识别出角色 —— 没勾条目，或条目里没写人名。识别漏了的用下面的手填框补。</div>'
        : ''}
      ${group.truncated ? `<div class="dt-note">还有 ${Math.max(0, Number(group.total ?? 0) - detected.length)} 个出现次数较少的没列出来</div>` : ''}
      ${weakList.length ? `<details class="dt-fold" data-key="cast.world.${key}.weak">
        <summary>可能是人名（弱证据 ${weakList.length}）</summary>
        <div class="dt-note">只命中「XX的 / XX说」这类弱线索，可能是形容词或名词（例：<code>温柔的底色</code>）。真角色请用下面的手填框补。</div>
        ${weakList.map(worldRow).join('')}
      </details>` : ''}
    </details>`;
  };

  const worldBlock = `
    <div class="dt-lbl">世界书里提到的角色（本地识别，不花 API）</div>
    <div class="dt-note" style="margin-top:0">
      只扫你在「世界书」里<b>勾选</b>的条目正文；识别结果只是候选，<b>勾了才算主角</b>（不会自动帮你勾任何一个）。
    </div>
    ${worldGroups.map(renderWorldGroup).join('')}`;

  /**
   * 主角 / 攻略对象（T-412 多人卡 + T-436 自选 + T-437 世界书识别）。
   *
   * 三个来源并存：**世界书识别**（T-437）+ **酒馆角色卡**（T-436）+ **手填名字**（NPC）。
   * 勾了谁，导演就会把阶段写成"谁的戏"；没勾的角色拿不到注入（所以当前生成者没勾时要明确提醒）。
   */
  const leadBlock = `
    <details class="dt-fold" data-key="cast.lead">
      <summary>主角 / 攻略对象 · 已选 ${list.length}${current ? ` · 当前生成者：${esc(current)}` : ''}</summary>

      <div class="dt-note" style="margin-top:0">
        勾选 = 让导演把这一场写成他 / 她的戏（阶段会标上 actorId）。<br>
        <b>没勾的角色不会拿到注入</b>；想攻略<b>没有角色卡的 NPC</b>，用下面的手填框加名字。
      </div>

      ${worldBlock}

      <div class="dt-lbl">酒馆里的角色（自动识别，T-436）</div>
      ${candidates.length ? `<div class="dt-pipe">
        ${candidates.map((item) => `<div class="dt-pipe-row">
          <input class="chk" type="checkbox" data-act="cast.toggle" data-id="${esc(item.id)}" data-name="${esc(item.name)}" ${isProtagonist(list, item) ? 'checked' : ''}>
          <span>${esc(item.name)}${sameName(item.name, current) ? ' <span class="dt-chip">当前生成者</span>' : ''}</span>
        </div>`).join('')}
      </div>` : '<div class="dt-note">读不到酒馆角色列表（单卡环境 / 还没加载）</div>'}

      <div class="dt-lbl">自选（手填名字，例：想攻略的 NPC）</div>
      <div style="display:flex;gap:6px">
        <input type="text" data-act="cast.add" placeholder="NPC 名字，回车或点「添加」">
        <button class="dt-mini" type="button" data-act="cast.add">添加</button>
      </div>
      ${manual.length ? `<div class="dt-pipe" style="margin-top:6px">
        ${manual.map((item) => `<div class="dt-pipe-row">
          <span style="flex:1">${esc(item.name || item.id)}${sameName(item.name, current) ? ' <span class="dt-chip">当前生成者</span>' : ''}</span>
          <button class="dt-mini" type="button" data-act="cast.remove" data-id="${esc(item.id)}" data-name="${esc(item.name)}">移除</button>
        </div>`).join('')}
      </div>` : ''}

      ${current && !currentChecked ? '<div class="dt-note" style="color:var(--accent)">⚠ 当前生成者不在名单里 → 这一轮的注入会被清空（要正常演就把 ta 勾上）</div>' : ''}
      <div class="dt-note">侧写按角色分存，换角色自动带出对应侧写</div>
    </details>`;

  const profileBlock = fields.length
    ? fields.map(({ key, label }) => `
      <div class="dt-lbl">${esc(label)}${locked[key] ? ' <span class="dt-chip dt-chip-lock" role="button" tabindex="0" data-act="cast.unlock" data-key="' + esc(key) + '" title="点一下解锁，AI 就能重写这个字段">已锁定</span>' : ''}</div>
      <input type="text" data-act="cast.setField" data-key="${esc(key)}" value="${esc(values[key] ?? '')}" placeholder="未知">`).join('')
    : '<div class="dt-note">还没有侧写 —— 点下面「重新生成侧写」，或者先到设置里填好 API</div>';

  return {
    html: `
    <div data-page="cast" hidden>
      ${leadBlock}

      <div class="dt-sec" style="margin-top:13px">人物侧写 · ${esc(current || '—')}</div>
      ${profileBlock}
      <div class="dt-actions">
        <button class="dt-btn" type="button" data-act="cast.regenerate">重新生成侧写</button>
        <button class="dt-btn" type="button" data-act="cast.unlockAll">全部解锁</button>
      </div>
      <div class="dt-flash" data-flash="cast" hidden></div>
      <div class="dt-note">${generated ? `${esc(generated)} · ` : ''}手改过的字段会自动锁定，AI 不覆盖</div>
    </div>`,
    actions: {
      'cast.toggle': (el, { api, ctx }) => {
        const entry = { id: el.dataset.id ?? '', name: el.dataset.name ?? '' };
        const next = api.cast?.toggle?.(entry) ?? [];
        ctx.flash('cast', isProtagonist(next, entry)
          ? `已把「${entry.name}」加进主角（导演会把戏写成 ta 的）`
          : `已把「${entry.name}」移出主角（ta 不会再拿到注入）`);
        ctx.refresh();
      },
      /** T-437：勾选 / 取消勾选一个**世界书里识别出来的**角色（只存名字） */
      'cast.worldToggle': (el, { api, ctx }) => {
        const name = String(el?.dataset?.name ?? '').trim();
        if (!name) return;
        const next = api.cast?.toggleWorld?.(name) ?? [];
        ctx.flash('cast', isProtagonist(next, { name })
          ? `已把「${name}」加进主角（导演会把戏写成 ta 的）`
          : `已把「${name}」移出主角（ta 不会再拿到注入）`);
        ctx.refresh();
      },
      /**
       * T-437：「重新识别」= 重扫当前已勾选的世界书条目。
       * **零调用**（只是本地读文本 + 正则），所以可以放心点。
       * `force: true` —— 指纹没变也照扫（缓存是给"自动补扫"省事用的，手动点就得真重算）。
       */
      'cast.rescan': async (el, { api, ctx }) => {
        // 一次扫全量（本地正则，很便宜），结果由 bootstrap 按来源分档
        ctx.busy('cast', '正在扫已勾选的世界书条目…');
        const result = await api.scanWorldCast?.({ force: true, scope: 'all' });
        const count = (result?.detected ?? []).length;
        const weakCount = (result?.weak ?? []).length;
        ctx.flash('cast', result
          ? `识别完成：扫了 ${result.scannedCount} 条 / 共勾选 ${result.selectedCount} 条${count ? `，识别到 ${count} 个角色${weakCount ? `（另有 ${weakCount} 个弱证据，在折叠里）` : ''}` : '，还没识别到角色（可以用下面的手填框）'}`
          : '没扫到（世界书里可能一条都没勾选）');
        ctx.refresh();
      },
      /** T-437：点出处里的条目名 → 跳到世界书弹层那一本（顺手按书名过滤，免得在几百本里翻） */
      'cast.worldEntry': async (el, { api, ctx }) => {
        const book = String(el?.dataset?.book ?? '').trim();
        const type = String(el?.dataset?.type ?? '');
        if (!book) return;
        ctx.openKey?.(`book:${type}:${book}`);
        ctx.setState?.({ keyword: book });
        ctx.openLayer?.('world');
        try {
          // 没读过的书（T-434 懒加载）顺手读一下，不然跳过去只看到书名
          await api.loadWorldBook?.(book);
          const sources = await api.loadWorldSources?.(false) ?? [];
          ctx.setState?.({ worldSources: sources });
        } catch (error) {
          console.warn('[导演时间] 跳转到世界书条目失败（世界书弹层里会显示读取结果）', error);
        }
        ctx.refresh?.();
      },
      'cast.add': (el, { api, ctx }) => {
        // 输入框与「添加」按钮共用这一个动作：点按钮时去读输入框，输入框回车/失焦时用它自己的值
        const fromInput = el?.tagName === 'INPUT' ? el.value : '';
        const input = ctx.root?.()?.querySelector?.('input[data-act="cast.add"]');
        const name = String(fromInput || input?.value || '').trim();
        if (!name) {
          ctx.flash('cast', '还没填名字（在上面那个框里写，回车或点「添加」）');
          return;
        }
        const before = (api.cast?.get?.() ?? []).length;
        const next = api.cast?.add?.(name) ?? [];
        ctx.flash('cast', next.length > before
          ? `已加入「${name}」：导演会把它当成主角之一（NPC 也能攻略了）`
          : `「${name}」已经在名单里了`);
        ctx.refresh();
      },
      'cast.remove': (el, { api, ctx }) => {
        const entry = { id: el.dataset.id ?? '', name: el.dataset.name ?? '' };
        api.cast?.remove?.(entry);
        ctx.flash('cast', `已移除「${entry.name}」`);
        ctx.refresh();
      },
      'cast.setField': (el, { api, ctx }) => {
        const key = el.dataset.key;
        api.profileApi?.edit?.(key, el.value);
        ctx.flash('cast', '已保存并锁定这个字段（AI 不会覆盖）');
        ctx.refresh();
      },
      'cast.unlock': (el, { api, ctx }) => {
        api.profileApi?.unlock?.(el.dataset.key);
        ctx.flash('cast', '已解锁：这个字段可以被 AI 重写');
        ctx.refresh();
      },
      'cast.unlockAll': (el, { api, ctx }) => {
        for (const key of Object.keys(state.profile?.locked ?? {})) api.profileApi?.unlock?.(key);
        ctx.flash('cast', '已全部解锁');
        ctx.refresh();
      },
      'cast.regenerate': async (el, { api, ctx }) => {
        ctx.busy('cast', '生成侧写中…');
        const result = await api.profileApi?.regenerate?.();
        ctx.flash('cast', result?.ok === false
          ? `生成失败：${result.reason ?? result.error ?? '原因不明'} → 到设置里检查 API`
          : (result?.queued ? '已提交（L1 档位，去「场记」的待确认里采用）' : '侧写已更新（锁定的字段没动）'));
        ctx.refresh();
      },
    },
  };
}
