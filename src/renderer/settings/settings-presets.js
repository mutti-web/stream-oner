'use strict';

let slotsCache = { version: 3, activeId: null, slots: [], items: [] };
let dialogResolver = null;

const DEFAULT_EMPTY_SLOTS = [
  { slotIndex: 1, id: 'data-slot-1', occupied: false },
  { slotIndex: 2, id: 'data-slot-2', occupied: false },
  { slotIndex: 3, id: 'data-slot-3', occupied: false },
];

function formatSavedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function getSlotById(id) {
  return slotsCache.slots?.find((s) => s.id === id) || null;
}

async function flushLayoutStateToStore() {
  await api.saveSuiteFeatures({ suiteObsLayout: buildSuiteObsLayoutPayload() });
  if (typeof buildYtOverlayPayload === 'function') {
    await api.saveYtConfig(buildYtOverlayPayload());
  }
  if (typeof buildAvatarPayload === 'function' && typeof avatarFormsHydrated !== 'undefined' && avatarFormsHydrated) {
    await api.saveAvatarConfig(buildAvatarPayload());
  }
  if (typeof readObsEventRulesFromDom === 'function') {
    await api.saveObsEventActions(readObsEventRulesFromDom());
  }
  const cssPath = readMdValue(document.getElementById('css-path')).trim();
  if (document.getElementById('css-path')) {
    await api.saveSettings({ customCssPath: cssPath });
  }
}

function openDataSlotDialog({ title, defaultName }) {
  const dlg = document.getElementById('data-slot-dialog');
  const titleEl = document.getElementById('data-slot-dialog-title');
  const nameField = document.getElementById('data-slot-dialog-name');
  if (!dlg || !titleEl || !nameField) {
    return Promise.resolve(null);
  }
  titleEl.textContent = title;
  setMdFieldValue(nameField, defaultName || '');
  dlg.showModal();
  return new Promise((resolve) => {
    dialogResolver = resolve;
  });
}

function closeDataSlotDialog(value) {
  const dlg = document.getElementById('data-slot-dialog');
  if (dlg?.open) dlg.close();
  if (dialogResolver) {
    const fn = dialogResolver;
    dialogResolver = null;
    fn(value);
  }
}

function buildSlotCard(slot) {
  const card = document.createElement('article');
  card.className = `data-slot-card${slot.occupied ? '' : ' data-slot-card--empty'}`;
  card.setAttribute('role', 'listitem');
  card.dataset.slotId = slot.id;

  const header = document.createElement('header');
  header.className = 'data-slot-card-header';
  const num = document.createElement('span');
  num.className = 'data-slot-num';
  num.textContent = `スロット ${slot.slotIndex}`;
  header.appendChild(num);
  if (slot.occupied && slotsCache.activeId === slot.id) {
    const badge = document.createElement('span');
    badge.className = 'data-slot-active-badge';
    badge.textContent = '読み込み済み';
    header.appendChild(badge);
  }
  card.appendChild(header);

  if (slot.occupied) {
    const name = document.createElement('h4');
    name.className = 'data-slot-name';
    name.textContent = slot.name || '無題';
    card.appendChild(name);

    if (slot.summary) {
      const summary = document.createElement('p');
      summary.className = 'data-slot-summary';
      summary.textContent = slot.summary;
      card.appendChild(summary);
    }

    const meta = document.createElement('p');
    meta.className = 'data-slot-meta';
    meta.textContent = slot.savedAt
      ? `${formatSavedAt(slot.savedAt)} に保存`
      : '保存日時不明';
    card.appendChild(meta);
  } else {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'data-slot-empty-msg';
    emptyMsg.textContent = '空き';
    card.appendChild(emptyMsg);
  }

  const actions = document.createElement('div');
  actions.className = 'data-slot-actions';

  if (slot.occupied) {
    actions.innerHTML = `
      <md-filled-button type="button" data-action="apply">読み込む</md-filled-button>
      <md-outlined-button type="button" data-action="overwrite">上書き保存</md-outlined-button>
      <md-outlined-button type="button" data-action="rename">名前変更</md-outlined-button>
      <md-text-button type="button" data-action="clear" style="--md-text-button-label-text-color: var(--md-sys-color-error);">クリア</md-text-button>
    `;
  } else {
    actions.innerHTML = `
      <md-filled-button type="button" data-action="save">保存</md-filled-button>
    `;
  }
  card.appendChild(actions);
  return card;
}

function renderDataSlots(state) {
  slotsCache = state || { version: 2, activeId: null, slots: [], items: [] };
  const grid = document.getElementById('data-slots-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const slots = slotsCache.slots?.length ? slotsCache.slots : DEFAULT_EMPTY_SLOTS;
  slots.forEach((slot) => grid.appendChild(buildSlotCard(slot)));
}

async function initSuitePresets() {
  try {
    if (typeof api.getSuitePresets !== 'function') {
      renderDataSlots({ version: 2, activeId: null, slots: DEFAULT_EMPTY_SLOTS, items: [] });
      return;
    }
    const state = await api.getSuitePresets().catch(() => null);
    renderDataSlots(state || { version: 2, activeId: null, slots: DEFAULT_EMPTY_SLOTS, items: [] });
  } catch (e) {
    console.warn('[DataSlots] 読み込み失敗:', e);
    renderDataSlots({ version: 2, activeId: null, slots: DEFAULT_EMPTY_SLOTS, items: [] });
  }
}

async function reloadUiAfterPresetApply() {
  suppressAutoSave++;
  await syncSuiteFeaturesFromStore({ includeLayout: true, refreshBadges: true });
  if (typeof initYoutube === 'function') {
    await initYoutube();
  }
  if (typeof initAvatar === 'function') {
    await initAvatar();
  }
  if (typeof initObsEventRules === 'function') {
    await initObsEventRules();
  }
  if (typeof applyCustomCssSettings === 'function' && typeof loadSettingsSnapshot === 'function') {
    const snap = await loadSettingsSnapshot();
    applyCustomCssSettings(snap);
  }
  suppressAutoSave--;
}

async function saveToSlot(slotId, name) {
  await flushLayoutStateToStore();
  const r = await api.saveSuitePreset({ id: slotId, name }).catch((e) => ({ success: false, error: e.message }));
  if (!r.success) {
    showFb('integration-fb', r.error || '保存に失敗しました', 'err');
    return false;
  }
  renderDataSlots(r.presets);
  showFb('integration-fb', `レイアウトスロット「${name}」を保存しました。`);
  return true;
}

async function handleSlotAction(slotId, action) {
  const slot = getSlotById(slotId);
  if (!slot) return;

  if (action === 'apply') {
    if (!slot.occupied) return;
    if (!window.confirm(
      `「${slot.name}」を読み込みます。\nOBS 配置・チャット表示・アバター見た目・スパチャ段階・OBS イベント連動・カスタム CSS が置き換わります。`,
    )) return;
    const r = await api.applySuitePreset(slotId).catch((e) => ({ success: false, error: e.message }));
    if (!r.success) {
      showFb('integration-fb', r.error || '読み込みに失敗しました', 'err');
      return;
    }
    renderDataSlots(r.presets || slotsCache);
    await reloadUiAfterPresetApply();
    showFb('integration-fb', `レイアウトスロット「${slot.name}」を読み込みました。`);
    return;
  }

  if (action === 'save') {
    const defaultName = `スロット${slot.slotIndex}`;
    const name = await openDataSlotDialog({
      title: `スロット ${slot.slotIndex} に保存`,
      defaultName,
    });
    if (!name) return;
    const trimmed = String(name).trim();
    if (!trimmed) {
      showFb('integration-fb', 'スロット名を入力してください', 'err');
      return;
    }
    await saveToSlot(slotId, trimmed);
    return;
  }

  if (action === 'overwrite') {
    if (!slot.occupied) return;
    if (!window.confirm(`「${slot.name}」を、いまの設定で上書きしますか？`)) return;
    await saveToSlot(slotId, slot.name);
    return;
  }

  if (action === 'rename') {
    if (!slot.occupied) return;
    const name = await openDataSlotDialog({
      title: 'スロット名を変更',
      defaultName: slot.name,
    });
    if (!name) return;
    const trimmed = String(name).trim();
    if (!trimmed) {
      showFb('integration-fb', 'スロット名を入力してください', 'err');
      return;
    }
    if (trimmed === slot.name) {
      showFb('integration-fb', '名前が変わっていません', 'err');
      return;
    }
    const r = await api.renameSuitePreset(slotId, trimmed).catch((e) => ({ success: false, error: e.message }));
    if (!r.success) {
      showFb('integration-fb', r.error || '名前の変更に失敗しました', 'err');
      return;
    }
    renderDataSlots(r.presets);
    showFb('integration-fb', `名前を「${trimmed}」に変更しました。`);
    return;
  }

  if (action === 'clear') {
    if (!slot.occupied) return;
    if (!window.confirm(`スロット ${slot.slotIndex}「${slot.name}」を空にしますか？`)) return;
    const r = await api.deleteSuitePreset(slotId).catch((e) => ({ success: false, error: e.message }));
    if (!r.success) {
      showFb('integration-fb', r.error || 'クリアに失敗しました', 'err');
      return;
    }
    renderDataSlots(r.presets);
    showFb('integration-fb', 'スロットを空にしました。');
  }
}

function bindDataSlotDialog() {
  const dlg = document.getElementById('data-slot-dialog');
  const form = document.getElementById('data-slot-dialog-form');
  const cancelBtn = document.getElementById('data-slot-dialog-cancel');
  const nameField = document.getElementById('data-slot-dialog-name');

  cancelBtn?.addEventListener('click', () => {
    dlg?.close('cancel');
    closeDataSlotDialog(null);
  });
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = readMdValue(nameField);
    const name = String(raw).trim();
    dlg?.close('ok');
    closeDataSlotDialog(name || null);
  });
}

function bindSuitePresets() {
  bindDataSlotDialog();
  renderDataSlots({ version: 2, activeId: null, slots: DEFAULT_EMPTY_SLOTS, items: [] });

  document.getElementById('data-slots-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-slot-id]');
    const slotId = card?.dataset?.slotId;
    const action = btn.dataset.action;
    if (slotId && action) {
      handleSlotAction(slotId, action);
    }
  });

  api.on('suite-presets-changed', (state) => {
    renderDataSlots(state);
  });
}
