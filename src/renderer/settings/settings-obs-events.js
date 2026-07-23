'use strict';

const OBS_EVENT_OPTIONS = [
  { value: 'superchat', label: 'スパチャ' },
  { value: 'membership', label: 'メンバーシップ' },
  { value: 'keyword', label: 'キーワード' },
];

let obsEventRulesCache = [];

function readObsEventRulesFromDom() {
  const rows = document.querySelectorAll('#obs-event-rules-list .obs-event-row');
  return Array.from(rows).map((row) => ({
    event: readMdValue(row.querySelector('[data-field="event"]')) || 'superchat',
    sourceName: readMdValue(row.querySelector('[data-field="sourceName"]')).trim(),
    action: readMdValue(row.querySelector('[data-field="action"]')) || 'show',
    durationMs: Number(readMdValue(row.querySelector('[data-field="durationMs"]'))) || 3000,
    keyword: readMdValue(row.querySelector('[data-field="keyword"]')).trim(),
  })).filter((r) => r.sourceName);
}

function renderObsEventRules(rules = []) {
  const list = document.getElementById('obs-event-rules-list');
  if (!list) return;
  obsEventRulesCache = Array.isArray(rules) ? rules : [];
  list.innerHTML = '';
  if (!obsEventRulesCache.length) {
    list.classList.add('empty');
    list.textContent = 'ルールがありません。「ルールを追加」から登録してください。';
    return;
  }
  list.classList.remove('empty');
  for (const rule of obsEventRulesCache) {
    list.appendChild(buildObsEventRow(rule));
  }
}

function buildObsEventRow(rule = {}) {
  const row = document.createElement('div');
  row.className = 'obs-event-row app-inset-block app-stack-sm';
  const eventOpts = OBS_EVENT_OPTIONS.map((o) =>
    `<md-select-option value="${o.value}"${rule.event === o.value ? ' selected' : ''}><div slot="headline">${o.label}</div></md-select-option>`,
  ).join('');
  row.innerHTML = `
    <div class="app-grid-2">
      <md-outlined-select data-field="event" label="イベント">
        ${eventOpts}
      </md-outlined-select>
      <md-outlined-text-field data-field="sourceName" label="OBS ソース名" value="${escapeAttr(rule.sourceName || '')}"></md-outlined-text-field>
    </div>
    <div class="app-grid-2">
      <md-outlined-select data-field="action" label="動作">
        <md-select-option value="show"${rule.action !== 'toggle' ? ' selected' : ''}><div slot="headline">表示（一時）</div></md-select-option>
        <md-select-option value="toggle"${rule.action === 'toggle' ? ' selected' : ''}><div slot="headline">切替（一時）</div></md-select-option>
      </md-outlined-select>
      <md-outlined-text-field data-field="durationMs" type="number" label="表示時間（ms）" min="0" max="120000" step="500" value="${Number(rule.durationMs) || 3000}"></md-outlined-text-field>
    </div>
    <md-outlined-text-field data-field="keyword" class="full-width obs-event-keyword" label="キーワード（キーワードイベント時）" value="${escapeAttr(rule.keyword || '')}"></md-outlined-text-field>
    <div class="app-row">
      <md-outlined-button type="button" class="btn-obs-event-test">テスト</md-outlined-button>
      <md-outlined-button type="button" class="btn-obs-event-remove">削除</md-outlined-button>
    </div>
  `;
  const eventSel = row.querySelector('[data-field="event"]');
  const keywordField = row.querySelector('.obs-event-keyword');
  const syncKeyword = () => {
    if (keywordField) keywordField.hidden = eventSel?.value !== 'keyword';
  };
  eventSel?.addEventListener('change', syncKeyword);
  syncKeyword();
  row.querySelectorAll('md-outlined-select, md-outlined-text-field').forEach((el) => {
    el.addEventListener('change', () => debouncedObsEvents());
    el.addEventListener('input', () => debouncedObsEvents());
  });
  row.querySelector('.btn-obs-event-remove')?.addEventListener('click', () => {
    row.remove();
    const listEl = document.getElementById('obs-event-rules-list');
    if (listEl && !listEl.querySelector('.obs-event-row')) renderObsEventRules([]);
    debouncedObsEvents();
  });
  row.querySelector('.btn-obs-event-test')?.addEventListener('click', async () => {
    const rules = readObsEventRulesFromDom();
    const idx = Array.from(document.querySelectorAll('#obs-event-rules-list .obs-event-row')).indexOf(row);
    const r = rules[idx];
    if (!r?.sourceName) {
      showFb('yt-fb', 'ソース名を入力してください', 'err');
      return;
    }
    const res = await api.testObsEventAction(r).catch((e) => ({ success: false, error: e.message }));
    if (res?.success) showFb('yt-fb', 'OBS にテスト送信しました。');
    else if (res?.skipped) showFb('yt-fb', 'OBS 未接続のためスキップしました。', 'err');
    else showFb('yt-fb', 'テスト失敗: ' + (res?.error || ''), 'err');
  });
  return row;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function initObsEventRules() {
  const cfg = typeof api.obsGetConfig === 'function'
    ? await api.obsGetConfig().catch(() => ({}))
    : {};
  renderObsEventRules(cfg.eventActions || []);
}

async function persistObsEventRules() {
  if (suppressAutoSave) return;
  const rules = readObsEventRulesFromDom();
  const r = await api.saveObsEventActions(rules).catch((e) => ({ success: false, error: e.message }));
  if (r?.success) {
    showFb('yt-fb', 'OBS イベント連動を保存しました。');
    obsEventRulesCache = rules;
  } else {
    showFb('yt-fb', '保存エラー: ' + (r?.error || ''), 'err');
  }
}

const debouncedObsEvents = debounce(persistObsEventRules, 700);

function refreshObsEventRulesIfNeeded() {
  if (!obsEventRulesCache?.length) return;
  if (readObsEventRulesFromDom().length) return;
  renderObsEventRules(obsEventRulesCache);
}

window.refreshObsEventRulesIfNeeded = refreshObsEventRulesIfNeeded;

function bindObsEventActions() {
  document.getElementById('btn-obs-event-add')?.addEventListener('click', () => {
    const list = document.getElementById('obs-event-rules-list');
    if (!list) return;
    if (list.classList.contains('empty')) {
      list.classList.remove('empty');
      list.textContent = '';
    }
    const row = buildObsEventRow({ event: 'superchat', action: 'show', durationMs: 3000 });
    list.appendChild(row);
    debouncedObsEvents();
  });
}
