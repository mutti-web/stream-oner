/**
 * リモートダッシュボード用 YouTube 開始フロー UI（ボトムシート）
 */
(function initRemoteYtStartUi(global) {
  const overlay = () => document.getElementById('yt-start-sheet-overlay');
  const titleEl = () => document.getElementById('yt-start-sheet-title');
  const bodyEl = () => document.getElementById('yt-start-sheet-body');
  const actionsEl = () => document.getElementById('yt-start-sheet-actions');
  const pickListEl = () => document.getElementById('yt-start-pick-list');
  const nudgeDismissWrap = () => document.getElementById('yt-start-nudge-dismiss-wrap');
  const nudgeDismissChk = () => document.getElementById('yt-start-nudge-dismiss');

  function openSheet() {
    const el = overlay();
    if (el) el.hidden = false;
  }

  function closeSheet() {
    const el = overlay();
    if (el) el.hidden = true;
    if (pickListEl()) {
      pickListEl().hidden = true;
      pickListEl().replaceChildren();
    }
    if (nudgeDismissWrap()) nudgeDismissWrap().hidden = true;
    if (nudgeDismissChk()) nudgeDismissChk().checked = false;
    if (actionsEl()) actionsEl().replaceChildren();
  }

  function waitSheetAction(buildActions) {
    return new Promise((resolve) => {
      openSheet();
      if (actionsEl()) actionsEl().replaceChildren();
      buildActions(resolve);
    });
  }

  function createBtn(label, { primary, danger, onClick }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = primary ? 'btn hero-action primary' : 'btn sheet-action-btn';
    if (danger) btn.classList.add('sheet-action-danger');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function createRemoteYtStartUi(deps = {}) {
    const { dismissNudge } = deps;

    return {
      async error(message) {
        await waitSheetAction((resolve) => {
          if (titleEl()) titleEl().textContent = 'チャット取得';
          if (bodyEl()) bodyEl().textContent = message || 'エラーが発生しました';
          actionsEl()?.append(
            createBtn('閉じる', { onClick: () => { closeSheet(); resolve(false); } }),
          );
        });
      },

      async confirmSingle(broadcast) {
        return waitSheetAction((resolve) => {
          if (titleEl()) titleEl().textContent = 'この配信のチャットを取得';
          if (bodyEl()) {
            bodyEl().textContent = `「${broadcast?.title || '（タイトルなし）'}」のライブチャットを取得しますか？`;
          }
          actionsEl()?.append(
            createBtn('キャンセル', { onClick: () => { closeSheet(); resolve(false); } }),
            createBtn('開始', { primary: true, onClick: () => { closeSheet(); resolve(true); } }),
          );
        });
      },

      async confirmFallback(prep) {
        return waitSheetAction((resolve) => {
          if (titleEl()) titleEl().textContent = '配信を検出できませんでした';
          if (bodyEl()) {
            bodyEl().textContent = `${prep.detectError || ''}\n\n保存済みの動画 ID（${prep.videoId}）で開始しますか？`;
          }
          actionsEl()?.append(
            createBtn('キャンセル', { onClick: () => { closeSheet(); resolve(false); } }),
            createBtn('開始', { primary: true, onClick: () => { closeSheet(); resolve(true); } }),
          );
        });
      },

      async pickMultiple(broadcasts) {
        return waitSheetAction((resolve) => {
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
                closeSheet();
                resolve(b);
              });
              list.appendChild(btn);
            }
          }
          actionsEl()?.append(
            createBtn('キャンセル', { onClick: () => { closeSheet(); resolve(null); } }),
          );
        });
      },

      async nudge(prep) {
        return waitSheetAction((resolve) => {
          if (titleEl()) titleEl().textContent = 'YouTube 連携のおすすめ';
          if (bodyEl()) {
            bodyEl().textContent = prep.configured
              ? 'PC の設定 › 接続タブで YouTube と連携すると、配信の動画 ID を自動検出してチャット取得を始められます。'
              : '開発者向け OAuth 設定が未完了です。PC の設定で動画 ID を入力してください。';
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
              if (dismiss && dismissNudge) {
                await dismissNudge().catch(() => {});
              }
              closeSheet();
              resolve(dismiss ? 'dismiss' : 'cancel');
            } }),
            createBtn('PC で設定を開く', { primary: true, onClick: () => { closeSheet(); resolve('manual'); } }),
          );
        });
      },

      async onConnect() {
        await this.error('YouTube 連携は PC の設定 › 接続タブから行ってください。');
        return false;
      },

      onManual() {
        window.alert('動画 ID は PC のダッシュボードで入力してください。');
      },
    };
  }

  global.RemoteYtStartUi = { createRemoteYtStartUi, closeSheet };
}(window));
