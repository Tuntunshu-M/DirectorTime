// 导演时间 · 人物页（UI 定稿 §5.3 + §2 分类「人物」）
//
// 控件（定稿 §2.1）：主角单选 #16（默认折叠）· 八字段输入 #17（手改置 locked）· 重新生成侧写 #18 · 全部解锁 #19

import { esc } from '../dom.js';

export function render(state) {
  const list = state.cast?.list ?? [];
  const current = state.cast?.current ?? '';
  const fields = state.profileFields ?? [];
  const values = state.profile?.fields ?? {};
  const locked = state.profile?.locked ?? {};
  const generated = state.profile?.generatedAtText ?? '';

  const leadBlock = list.length
    ? `<details class="dt-fold">
        <summary>主角（多人卡，多选一）· 当前：${esc(current || list[0] || '—')}</summary>
        <div class="dt-radio">
          ${list.map((name) => `<label><input type="radio" name="dt-lead" value="${esc(name)}" data-act="cast.setLead" ${name === (current || list[0]) ? 'checked' : ''}> ${esc(name)}${name === current ? ' <span class="dt-chip">当前生成者</span>' : ''}</label>`).join('')}
        </div>
        <div class="dt-note">侧写按角色分存，切换主角自动带出对应侧写；<br>注入前会判断「当前生成者是不是主角」，不是就清空注入</div>
      </details>`
    : `<details class="dt-fold">
        <summary>主角（还没设置）</summary>
        <div class="dt-note">这是一张单卡，或者还没选主角 —— 注入按当前说话人走，不需要额外设置</div>
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
      'cast.setLead': (el, { api, ctx }) => {
        api.cast?.set?.([el.value]);
        ctx.flash('cast', `已把主角设为「${el.value}」，侧写跟着切过去`);
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
