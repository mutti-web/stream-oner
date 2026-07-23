/**
 * OBS ブラウザソース（/overlay）向け — 同一オリジンの /custom-css を注入
 */
(function () {
  const el = document.getElementById('custom-user-css');
  if (!el) return;

  const POLL_NORMAL_MS = 10000;
  const POLL_FAST_MS = 2000;
  const FAST_POLL_WINDOW_MS = 30000;

  let lastCss = null;
  let lastRevision = null;
  let fastPollUntil = 0;
  let pollTimer = null;

  function armFastPoll() {
    fastPollUntil = Date.now() + FAST_POLL_WINDOW_MS;
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    const delay = Date.now() < fastPollUntil ? POLL_FAST_MS : POLL_NORMAL_MS;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await refresh();
      schedulePoll();
    }, delay);
  }

  async function refresh() {
    try {
      const res = await fetch(`/custom-css?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        if (lastCss !== '') {
          el.textContent = '';
          lastCss = '';
          lastRevision = null;
        }
        return;
      }
      const rev = res.headers.get('X-Css-Revision') || '';
      const css = await res.text();
      if (css === lastCss && rev === lastRevision) return;
      if (rev !== lastRevision) armFastPoll();
      lastCss = css;
      lastRevision = rev;
      el.textContent = css;
    } catch (_) {
      /* 次の周期で再試行 */
    }
  }

  refresh().then(schedulePoll);
})();
