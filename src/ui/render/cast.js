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
  const fields = state.profileFields ?? [];
  const values = state.profile?.fields ?? {};
  const locked = state.profile?.locked ?? {};
  const generated = state.profile?.generatedAtText ?? '';

  // ---------- T-437 / T-438：候选角色（本地识别 ∪ 侧写搭车 ∪ 已知名单）----------
  // 三条硬要求不变：**只扫已勾选条目 · 本地零调用 · 绝不自动设主角**。
  // T-438 增量三/四：候选区**合并多路来源并按名字（含别名）去重**，每行标来源标签；
  //   侧写那次调用顺带返回 cast（**零额外调用**），手填的名字喂进 {{knownCast}} 让模型也认。
  const worldCast = state.cast?.world ?? {};
  /** T-438 §2：用户忽略过的名字（下面有个折叠可以恢复） */
  const worldBlocklist = worldCast.blocklist ?? [];
  /** T-438 §3：侧写那次调用顺带回来的候选（零额外调用） */
  const aiCast = state.cast?.ai ?? { at: 0, list: [] };
  const groupOf = (key) => worldCast[key] ?? {};

  const inProtagonists = (name) => isProtagonist(list, { name });
  // 本地扫描认出来的名字：手填那一节要把它们排除掉，免得同一个名字出现两次
  const localNames = new Set(
    ['current', 'other'].flatMap((key) => (groupOf(key).detected ?? []).map((row) => String(row.name).toLowerCase())),
  );
  const manual = list.filter((item) => (item.manual || !item.id) && !localNames.has(String(item.name).toLowerCase()));
  const currentChecked = Boolean(current) && isProtagonist(list, { name: current });

  /**
   * 【T-438 §3-④】合并多路来源 → 一个去重后的清单。
   *
   * 去重按**名字 + 别名**（旧版 just-do-it-char 的 `aliases` 就是干这个的）：
   * `代号：Lobo` 抽出来的 `Lobo` 与侧写返回的 `{name:'裴玉', aliases:['Lobo']}` 会合成一行。
   * 来源标签：`本地·当前卡` / `本地·其它书` / `AI` / `已知`（手填的在下面「自选」那一节，标 `手填`）。
   */
  const mergeCandidates = () => {
    const map = new Map(); // 小写名 → entry
    const ensure = (rawName) => {
      const name = String(rawName ?? '').trim();
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { name, aliases: [], count: 0, local: [], ai: null, tags: [] });
      return map.get(key);
    };
    const byAlias = (rawName) => {
      const key = String(rawName ?? '').trim().toLowerCase();
      if (!key) return null;
      if (map.has(key)) return map.get(key);
      for (const entry of map.values()) {
        if (entry.aliases.some((alias) => alias.toLowerCase() === key)) return entry;
      }
      return null;
    };
    const tag = (entry, label) => { if (!entry.tags.includes(label)) entry.tags.push(label); };

    // ① 侧写返回的先放（它带 aliases，拿来当"同一个人"的锚点）
    for (const row of aiCast.list ?? []) {
      const entry = ensure(row?.name);
      if (!String(row?.name ?? '').trim()) continue;
      entry.ai = row;
      tag(entry, 'AI');
      entry.aliases = [...new Set([...entry.aliases, ...(row.aliases ?? [])])];
    }
    // ② 本地扫描（当前卡 / 其它世界书）—— 名字或别名命中已有条目就并进去，不单列
    for (const [key, label] of [['current', '本地·当前卡'], ['other', '本地·其它书']]) {
      for (const row of groupOf(key).detected ?? []) {
        const entry = byAlias(row.name) ?? ensure(row.name);
        tag(entry, label);
        entry.local.push(row);
        entry.count += Number(row.count ?? 0);
      }
    }
    // ③ 已知名单：当前生成者 + 已经加进主角的
    if (current && !byAlias(current)) tag(ensure(current), '已知');
    for (const item of list) {
      const hit = byAlias(item?.name);
      // 手填的：已经在候选里就补一个「手填」标签（用户点名的优先，见下面低置信度的豁免）；
      // 没进候选的不在这里重复列 —— 它们在「自选」那一节显示（那里也标了「手填」）
      if (item?.manual === true) {
        if (hit) tag(hit, '手填');
        continue;
      }
      if (hit) continue;
      tag(ensure(item.name), '已知');
    }
    return [...map.values()];
  };

  const candidatesAll = mergeCandidates();
  /**
   * T-438 §3-③：AI 自报 confidence < 0.65 → 进「低置信度」，不占主候选。
   * **豁免**：手填 / 已知（用户点名的、当前生成者）永远留在主候选 —— 用户说了有这个人，
   * 模型说"拿不准"不算数（规格 §5：手填的优先）。
   */
  const isHandPicked = (entry) => entry.tags.includes('手填') || entry.tags.includes('已知');
  const isLowConfidence = (entry) => !isHandPicked(entry)
    && entry.ai?.confidence != null && Number(entry.ai.confidence) < 0.65;
  const addedRows = candidatesAll.filter((entry) => inProtagonists(entry.name));
  const pendingRows = candidatesAll.filter((entry) => !inProtagonists(entry.name) && !isLowConfidence(entry));
  const lowRows = candidatesAll.filter((entry) => !inProtagonists(entry.name) && isLowConfidence(entry));
  const weakRows = (groupOf('current').weak ?? []).length || (groupOf('other').weak ?? []).length
    ? [...(groupOf('current').weak ?? []), ...(groupOf('other').weak ?? [])].filter((row) => !inProtagonists(row.name))
    : [];

  /** 扫描计数行：规格要求界面上直接显示"扫了 X 条 / 共勾选 Y 条"（别只打控制台） */
  const scanCountText = () => {
    const group = groupOf('current');
    const other = groupOf('other');
    const selected = Number(group.selectedCount ?? other.selectedCount ?? 0);
    if (!selected) return '还没有勾选世界书条目 —— 到「世界书」里勾几条再来（本地识别不花 API）';
    if (group.stale) return '正在识别当前已勾选的条目…';
    // 兜底：有些快照没带 scannedOnce，但确实扫出过条数 —— 那就当扫过
    if (!group.scannedOnce && !group.scannedCount) return '还没扫过 —— 点「重新识别」跑一遍（本地跑，不花 API）';
    const parts = [`扫了 ${Number(group.scannedCount ?? 0)} 条 / 共勾选 ${selected} 条`];
    if (Number(other.scannedCount ?? 0) > 0) parts.push(`（另有 ${other.scannedCount} 条来自其它世界书）`);
    if (group.unreadable) parts.push(`${group.unreadable} 条读不到内容`);
    return parts.join('');
  };

  /** 来源标签（本地·当前卡 / 本地·其它书 / AI / 已知） */
  const sourceChips = (entry) => entry.tags.map((label) => `<span class="dt-chip">${esc(label)}</span>`).join(' ');

  /**
   * 一个候选：勾选框 + 来源标签 + 别名 + 证据 + 出现次数/出处（展开能跳到世界书那一本）
   * + T-438 §2 的「忽略」（已加入主角的行不给忽略按钮 —— 主角永不被忽略）。
   */
  const candidateRow = (entry) => {
    const added = inProtagonists(entry.name);
    const sources = entry.local.flatMap((row) => row.sources ?? []);
    const aliasText = entry.aliases.length ? `别名：${entry.aliases.join('、')}` : '';
    const evidence = String(entry.ai?.evidence ?? '').trim();
    return `
    <div class="dt-pipe-row">
      <input class="chk" type="checkbox" data-act="cast.worldToggle" data-name="${esc(entry.name)}" ${added ? 'checked' : ''}>
      <span style="flex:1">${esc(entry.name)}
        ${sameName(entry.name, current) ? ' <span class="dt-chip">当前生成者</span>' : ''}
        ${sourceChips(entry)}
        ${aliasText ? `<br><span class="dt-note" style="margin:0">${esc(aliasText)}</span>` : ''}
        ${evidence ? `<br><span class="dt-note" style="margin:0">证据：${esc(evidence)}</span>` : ''}
      </span>
      ${added ? '' : `<button class="dt-mini" type="button" data-act="cast.worldIgnore" data-name="${esc(entry.name)}" title="这不是人名？点一下以后不再列出（可以在下面恢复）">忽略</button>`}
      ${entry.local.length ? `<details class="dt-fold" data-key="cast.world:${esc(entry.name)}">
        <summary>出现 ${Number(entry.count ?? 0)} 次 · 出自 ${sources.length} 条</summary>
        <div class="dt-pipe">
          ${sources.map((source) => `<div class="dt-pipe-row">
            <button class="dt-mini" type="button" data-act="cast.worldEntry" data-book="${esc(source.bookName ?? '')}" data-entry-key="${esc(source.entryKey ?? '')}" data-type="${esc(source.sourceType ?? '')}">${esc(source.entryName || source.bookName || '（未命名条目）')}</button>
            <span class="dt-note" style="margin:0">${esc(source.bookName ?? '')}</span>
          </div>`).join('')}
        </div>
      </details>` : ''}
    </div>`;
  };

  /** T-438 §2：已忽略的名字 —— 能恢复，所以不算"丢"，只算"藏起来" */
  const ignoredBlock = worldBlocklist.length ? `
    <details class="dt-fold" data-key="cast.ignored">
      <summary>已忽略的名字（${worldBlocklist.length}）</summary>
      <div class="dt-note" style="margin-top:0">这些名字不会再出现在候选里。忽略错了点「恢复」就行。</div>
      ${worldBlocklist.map((name) => `<div class="dt-pipe-row">
        <span style="flex:1">${esc(name)}</span>
        <button class="dt-mini" type="button" data-act="cast.worldUnignore" data-name="${esc(name)}">恢复</button>
      </div>`).join('')}
    </details>` : '';

  const worldBlock = `
    <div class="dt-lbl">候选角色（本地识别 + 侧写搭车，都不额外花钱）</div>
    <div class="dt-note" style="margin-top:0">
      只扫你在「世界书」里<b>勾选</b>的条目正文；识别结果只是候选，<b>勾了才算主角</b>（不会自动帮你勾任何一个）。<br>
      想要更准？去生成一次侧写，识别会跟着一起回来（<b>不额外花钱</b>，那次调用本来就要发）。<br>
      识别到不是人名的怪词？点它旁边的<b>「忽略」</b>，以后就不列了。
    </div>
    <div class="dt-note">${esc(scanCountText())}
      <button class="dt-mini" type="button" data-act="cast.rescan" data-scope="all">重新识别</button>
    </div>
    ${addedRows.length ? `<div class="dt-lbl">已添加（${addedRows.length}）</div>${addedRows.map(candidateRow).join('')}` : ''}
    ${pendingRows.length ? `<div class="dt-lbl">候选（${pendingRows.length}）</div>${pendingRows.map(candidateRow).join('')}` : ''}
    ${!addedRows.length && !pendingRows.length
      ? '<div class="dt-note">还没识别出角色 —— 没勾世界书条目，或条目里没写人名。识别漏了的用下面的手填框补。</div>'
      : ''}
    ${lowRows.length ? `<details class="dt-fold" data-key="cast.lowConfidence">
      <summary>低置信度（AI 拿不准的 ${lowRows.length}）</summary>
      <div class="dt-note" style="margin-top:0">侧写那次调用给的 confidence 低于 0.65，先不占候选位；确认是角色就勾上。</div>
      ${lowRows.map(candidateRow).join('')}
    </details>` : ''}
    ${weakRows.length ? `<details class="dt-fold" data-key="cast.weak">
      <summary>可能是人名（弱证据 ${weakRows.length}）</summary>
      <div class="dt-note" style="margin-top:0">只命中「XX的 / XX说」这类弱线索，可能是形容词或名词。真角色请用下面的手填框补。</div>
      ${weakRows.map((row) => candidateRow({ name: row.name, aliases: [], count: Number(row.count ?? 0), local: [row], ai: null, tags: ['弱证据'] })).join('')}
    </details>` : ''}
    ${ignoredBlock}`;

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

      <div class="dt-lbl">自选（手填名字，例：想攻略的 NPC）</div>
      <div style="display:flex;gap:6px">
        <input type="text" data-act="cast.add" placeholder="NPC 名字，回车或点「添加」">
        <button class="dt-mini" type="button" data-act="cast.add">添加</button>
      </div>
      ${manual.length ? `<div class="dt-pipe" style="margin-top:6px">
        ${manual.map((item) => `<div class="dt-pipe-row">
          <span style="flex:1">${esc(item.name || item.id)} <span class="dt-chip">手填</span>${sameName(item.name, current) ? ' <span class="dt-chip">当前生成者</span>' : ''}</span>
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
      /**
       * T-438 §2：忽略一个候选（规则再全也会有怪词，让用户自己划掉最省事）。
       * 只影响展示；主角 / 当前生成者的名字在 bootstrap 那边会被拒（这里也不给按钮）。
       */
      'cast.worldIgnore': (el, { api, ctx }) => {
        const name = String(el?.dataset?.name ?? '').trim();
        if (!name) return;
        api.cast?.ignoreWorldCast?.(name);
        ctx.flash('cast', `已忽略「${name}」：以后不再列出它（想找回就展开下面「已忽略的名字」）`);
        ctx.refresh();
      },
      /** T-438 §2：反悔，从忽略名单里恢复 */
      'cast.worldUnignore': (el, { api, ctx }) => {
        const name = String(el?.dataset?.name ?? '').trim();
        if (!name) return;
        api.cast?.unignoreWorldCast?.(name);
        ctx.flash('cast', `已恢复「${name}」`);
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
