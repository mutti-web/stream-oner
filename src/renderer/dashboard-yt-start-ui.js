/**
 * ダッシュボード用 YouTube 開始フロー UI（モーダル）
 */
(function initDashboardYtStartUi(global) {
  const modal = () => document.getElementById('yt-start-modal');
  const titleEl = () => document.getElementById('yt-start-modal-title');
  const bodyEl = () => document.getElementById('yt-start-modal-body');
  const actionsEl = () => document.getElementById('yt-start-modal-actions');
  const pickListEl = () => document.getElementById('yt-start-pick-list');
  const nudgeDismissWrap = () => document.getElementById('yt-start-nudge-dismiss-wrap');
  const nudgeDismissChk = () => document.getElementById('yt-start-nudge-dismiss');

  function openModal() {
    const m = modal();
    if (m) m.classList.remove('hidden');
  }

  function closeModal() {
    const m = modal();
    if (m) m.classList.add('hidden');
    if (pickListEl()) {
      pickListEl().hidden = true;
      pickListEl().replaceChildren();
    }
    if (nudgeDismissWrap()) nudgeDismissWrap().hidden = true;
    if (nudgeDismissChk()) nudgeDismissChk().checked = false;
    if (actionsEl()) actionsEl().replaceChildren();
  }

  function waitModalAction(buildActions) {
    return new Promise((resolve) => {
      openModal();
      if (actionsEl()) actionsEl().replaceChildren();
      buildActions(resolve);
    });
  }

  function createBtn(label, { primary, danger, onClick }) {
    const btn = document.createElement(primary ? 'md-filled-button' : 'md-outlined-button');
    btn.type = 'button';
    btn.textContent = label;
    if (danger) {
      btn.style.setProperty('--md-outlined-button-label-text-color', 'var(--md-sys-color-error)');
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  function createDashboardYtStartUi(api) {
    return {
      async error(message) {
        await waitModalAction((resolve) => {
          if (titleEl()) titleEl().textContent = 'チャット取得';
          if (bodyEl()) bodyEl().textContent = message || 'エラーが発生しました';
          actionsEl()?.append(
            createBtn('閉じる', { onClick: () => { closeModal(); resolve(false); } }),
          );
        });
      },

      async confirmSingle(broadcast) {
        return waitModalAction((resolve) => {
          if (titleEl()) titleEl().textContent = 'この配信のチャットを取得';
          if (bodyEl()) {
            bodyEl().textContent = `「${broadcast?.title || '（タイトルなし）'}」のライブチャットを取得しますか？`;
          }
          actionsEl()?.append(
            createBtn('キャンセル', { onClick: () => { closeModal(); resolve(false); } }),
            createBtn('開始', { primary: true, onClick: () => { closeModal(); resolve(true); } }),
          );
        });
      },

      async confirmFallback(prep) {
        return waitModalAction((resolve) => {
          if (titleEl()) titleEl().textContent = '配信を検出できませんでした';
          if (bodyEl()) {
            bodyEl().textContent = `${prep.detectError || ''}\n\n保存済みの動画 ID（${prep.videoId}）で開始しますか？`;
          }
          actionsEl()?.append(
            createBtn('キャンセル', { onClick: () => { closeModal(); resolve(false); } }),
            createBtn('開始', { primary: true, onClick: () => { closeModal(); resolve(true); } }),
          );
        });
      },

      async pickMultiple(broadcasts) {
        return waitModalAction((resolve) => {
          if (titleEl()) titleEl().textContent = '配信を選択';
          if (bodyEl()) bodyEl().textContent = '同時に配信中のライブが複数あります。取得する配信を選んでください。';
          const list = pickListEl();
          if (list) {
            list.hidden = false;
            list.replaceChildren();
            for (const b of broadcasts || []) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'yt-start-pick-item';
              btn.textContent = b.title || b.videoId;
              btn.addEventListener('click', () => {
                closeModal();
                resolve(b);
              });
              list.appendChild(btn);
            }
          }
          actionsEl()?.append(
            createBtn('キャンセル', { onClick: () => { closeModal(); resolve(null); } }),
          );
        });
      },

      async nudge(prep) {
        return waitModalAction((resolve) => {
          if (titleEl()) titleEl().textContent = 'YouTube 連携のおすすめ';
          if (bodyEl()) {
            bodyEl().textContent = prep.configured
              ? '接続タブで YouTube と連携すると、配信の動画 ID を自動検出してチャット取得を始められます。'
              : '開発者向け OAuth 設定が未完了のため、手動で動画 ID を設定してください。';
          }
          const wrap = nudgeDismissWrap();
          const chk = nudgeDismissChk();
          if (wrap && chk) {
            wrap.hidden = false;
            chk.checked = false;
          }
          actionsEl()?.append(
            createBtn('あとで', { onClick: async () => {
              const dismiss = !!chk?.checked;
              if (dismiss) {
                await api.setYoutubeOAuthNudgeDismissed(true).catch(() => {});
              }
              closeModal();
              resolve(dismiss ? 'dismiss' : 'cancel');
            } }),
            createBtn('手動で動画 ID', { onClick: () => { closeModal(); resolve('manual'); } }),
            createBtn('YouTube と連携', { primary: true, onClick: () => { closeModal(); resolve('connect'); } }),
          );
        });
      },

      async onConnect() {
        const r = await api.startYoutubeOAuth().catch((e) => ({ success: false, error: e.message }));
        if (!r.success) {
          await this.error(r.error || '連携に失敗しました');
          return false;
        }
        return true;
      },

      onManual() {
        document.getElementById('dash-yt-video-details')?.setAttribute('open', '');
        document.getElementById('dash-yt-video-id')?.focus();
      },

      async onDismiss() {
        const chk = nudgeDismissChk();
        if (chk?.checked) {
          await api.setYoutubeOAuthNudgeDismissed(true).catch(() => {});
        }
      },
    };
  }

  global.DashboardYtStartUi = { createDashboardYtStartUi, closeModal };
}(window));
