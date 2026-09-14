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
  const manual = list.filter((item) => item.manual || !item.id);
  const currentChecked = Boolean(current) && isProtagonist(list, { name: current });

  /**
   * 主角 / 攻略对象（T-412 多人卡 + T-436 自选）。
   *
   * 两种来源并存：**自动识别**酒馆里的角色卡（勾选）+ **手填名字**（NPC，自选）。
   * 勾了谁，导演就会把阶段写成"谁的戏"；没勾的角色拿不到注入（所以当前生成者没勾时要明确提醒）。
   */
  const leadBlock = `
    <details class="dt-fold" data-key="cast.lead">
      <summary>主角 / 攻略对象 · 已选 ${list.length}${current ? ` · 当前生成者：${esc(current)}` : ''}</summary>

      <div class="dt-note" style="margin-top:0">
        勾选 = 让导演把这一场写成他 / 她的戏（阶段会标上 actorId）。<br>
        <b>没勾的角色不会拿到注入</b>；想攻略<b>没有角色卡的 NPC</b>，用下面的手填框加名字。
      </div>

      <div class="dt-lbl">酒馆里的角色（自动识别）</div>
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
      'cast.add': (el, { api, ctx }) => {
        // 输入框与「添加」按钮共用这一个动作：点按钮时去读输入框，输入框回车/失焦时用它自己的值
        const fromInput = el?.tagName === 'INPUT' ? el.value : '';
        const input = ctx.root?.()?.querySelector?.('input[data-act="cast.add"]');
        const name = String(fromInput || input?.value || '').trim();
        if (!name) {
          ctx.flash('cast', '先在上面那个框里填个名字');
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
