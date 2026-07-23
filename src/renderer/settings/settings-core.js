'use strict';

const api = window.electronAPI;
const { linesToArray, arrayToLines, debounce, showFb, copyTextToClipboard, wireAutoSavePanel } = window.AppUtils;

let suppressAutoSave = 0;
let ytConfigCache = {};
let avConfigCache = {};

/** ui-helpers のレイアウトガード経由で value / label を適用 */
function setMdFieldValue(el, value) {
  if (!el) return;
  el.value = value == null ? '' : String(value);
}

function setMdFieldLabel(el, label) {
  if (!el) return;
  el.label = label == null ? '' : String(label);
}

/** Material Web の保留値（__suitePending）も含めて読む */
function readMdValue(el) {
  return window.appUI?.readMdFieldValue?.(el) ?? el?.value ?? '';
}

function readMdNum(el, fallback) {
  const raw = readMdValue(el);
  if (raw === '' || raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function flushPendingMdFields(scope) {
  const root = typeof scope === 'string'
    ? (document.getElementById(`panel-${scope}`) || scope)
    : (scope || document);
  window.appUI?.flushDeferredMdFields?.(root);
}

// ===== タブ切り替え =====
const SETTINGS_TAB_ALIASES = {
  discord: 'accounts',
  youtube: 'chat',
  integration: 'overlay',
};

function switchSettingsTab(tabName) {
  tabName = SETTINGS_TAB_ALIASES[tabName] || tabName;
  const panelId = `panel-${tabName}`;
  const panel = document.getElementById(panelId);
  if (!panel) {
    console.warn('[Settings] 不明なタブ:', tabName);
    return;
  }

  const tabs = document.getElementById('tabs-main');
  const tabEl = tabs?.querySelector(`md-primary-tab[data-tab="${tabName}"]`);
  if (tabs && tabEl) tabs.activeTab = tabEl;
  document.querySelectorAll('#tabs-main md-primary-tab').forEach((b) => {
    b.active = (b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === panelId);
  });

  // レイアウトタブで下までスクロールしたあと他タブへ行くと「開けない」ように見えるため先頭へ
  window.scrollTo(0, 0);

  try {
    if (tabName === 'avatar') {
      window.avatarSettingsUI?.ensureBuilt?.();
      if (window.avatarSettingsUI?.fillAll && avConfigCache) {
        window.avatarSettingsUI.fillAll(avConfigCache);
      }
      syncAvSubtabPanels();
    }
    if (tabName === 'chat' && ytConfigCache) {
      const ngW = document.getElementById('yt-ng-words');
      const ngU = document.getElementById('yt-ng-users');
      const readV = (el) => window.appUI?.readMdFieldValue?.(el) ?? el?.value ?? '';
      if (ngW && !readV(ngW).trim() && ytConfigCache.ngWords?.length) {
        setMdFieldValue(ngW, arrayToLines(ytConfigCache.ngWords));
      }
      if (ngU && !readV(ngU).trim() && ytConfigCache.ngUserIds?.length) {
        setMdFieldValue(ngU, arrayToLines(ytConfigCache.ngUserIds));
      }
    }
    if (tabName === 'chat') window.refreshObsEventRulesIfNeeded?.();
    requestAnimationFrame(() => {
      try {
        flushPendingMdFields(tabName);
      } catch (e) {
        console.warn('[Settings] タブ表示後のフィールド反映:', e);
      }
    });
  } catch (e) {
    console.error('[Settings] タブ切替エラー:', e);
  }
}

function flashSetupSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.classList.add('setup-flash');
  setTimeout(() => el.classList.remove('setup-flash'), 2200);
}

function activeSettingsFbId() {
  const active = document.querySelector('.tab-panel.active');
  if (active?.id === 'panel-accounts') return 'yt-conn-fb';
  if (active?.id === 'panel-overlay') return 'integration-fb';
  if (active?.id === 'panel-chat') return 'yt-fb';
  return 'general-fb';
}

function scrollToSettingsSection(tabName, sectionId) {
  switchSettingsTab(tabName);
  requestAnimationFrame(() => {
    const el = document.getElementById(sectionId);
    if (el) {
      if (el.tagName === 'DETAILS') el.open = true;
      let p = el.parentElement;
      while (p) {
        if (p.tagName === 'DETAILS') {
          p.open = true;
          break;
        }
        p = p.parentElement;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      flashSetupSection(sectionId);
    }
  });
}

/** 初回セットアップの「次へ」操作 */
function runSetupStepAction(step) {
  if (step.action === 'scroll' && step.sectionId) {
    scrollToSettingsSection(step.tab || 'general', step.sectionId);
    return;
  }
  if (step.action === 'dashboard') {
    api.openDashboard();
    return;
  }
  if (step.tab) switchSettingsTab(step.tab);
}

function bindMainTabs() {
  const tabs = document.getElementById('tabs-main');
  if (!tabs) return;

  function tabNameFromEvent(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    for (const node of path) {
      if (node instanceof HTMLElement && node.dataset?.tab) return node.dataset.tab;
    }
    return null;
  }

  tabs.addEventListener('change', () => {
    const name = tabs.activeTab?.dataset?.tab;
    if (name) switchSettingsTab(name);
  });

  // Shadow DOM 内のクリックでも確実に切り替える
  tabs.addEventListener('click', (e) => {
    const name = tabNameFromEvent(e) || tabs.activeTab?.dataset?.tab;
    if (name) switchSettingsTab(name);
  });
}

document.getElementById('btn-open-dashboard')?.addEventListener('click', () => api.openDashboard());
document.getElementById('btn-setup-open-dashboard')?.addEventListener('click', () => api.openDashboard());
api.on('navigate-settings-tab', (tab) => { if (tab) switchSettingsTab(tab); });

api.on('focus-suite-layout-panel', (payload) => {
  const sectionId = payload?.sectionId
    || ({ discord: 'suite-layout-discord', youtube: 'suite-layout-youtube', avatar: 'suite-layout-avatar' }[payload?.panel]);
  scrollToSettingsSection('overlay', sectionId || 'suite-layout-editor');
});

api.on('suite-layout-changed', (layout) => {
  if (!layout || typeof layout !== 'object') return;
  suppressAutoSave++;
  fillSuiteLayoutPanel('discord', layout.discord);
  fillSuiteLayoutPanel('youtube', layout.youtube);
  fillSuiteLayoutPanel('avatar', layout.avatar);
  suppressAutoSave--;
});

// ===== アバター A/B サブタブ =====
/** 表示モード「2人」のとき、選択中の配信者パネルだけ表示する */
function syncAvSubtabPanels() {
  const mode = getAvDisplayMode();
  if (mode !== 'both') return;

  const tabs = document.getElementById('av-adv-tabs');
  const panelP1 = document.querySelector('[data-avpanel="p1"]');
  const panelP2 = document.querySelector('[data-avpanel="p2"]');
  if (!panelP1 || !panelP2) return;

  const key = tabs?.activeTab?.dataset?.avtab || 'p1';
  panelP1.style.display = key === 'p1' ? '' : 'none';
  panelP2.style.display = key === 'p2' ? '' : 'none';
  flushPendingMdFields('avatar');
}

function bindAvSubtabs() {
  const tabs = document.getElementById('av-adv-tabs');
  if (!tabs) return;
  tabs.addEventListener('change', () => syncAvSubtabPanels());
  syncAvSubtabPanels();
}

// ===== 設定スナップショット（起動時1回） =====
let settingsSnapshot = null;

async function loadSettingsSnapshot() {
  if (!settingsSnapshot) {
    settingsSnapshot = await api.getSettings().catch(() => ({}));
  }
  return settingsSnapshot;
}

function patchSettingsSnapshot(partial) {
  if (!settingsSnapshot) settingsSnapshot = {};
  Object.assign(settingsSnapshot, partial);
}

function isAvatarFeatureEnabled() {
  return !!document.getElementById('suite-avatar-enabled')?.checked;
}
function syncAvatarEnableToggles(checked) {
  const g = document.getElementById('suite-avatar-enabled');
  if (g) g.checked = checked;
}

function getAvatarDisplayNames() {
  const p1 = readMdValue(document.getElementById('av-p1-label')).trim() || '配信者A';
  const p2 = readMdValue(document.getElementById('av-p2-label')).trim() || '配信者B';
  return { p1, p2 };
}

function updateAvatarLabelUi() {
  const { p1, p2 } = getAvatarDisplayNames();
  const micA = document.getElementById('av-mic-a');
  const micB = document.getElementById('av-mic-b');
  setMdFieldLabel(micA, `${p1}（1人目）のマイク`);
  setMdFieldLabel(micB, `${p2}（2人目）のマイク`);

  const optBoth = document.getElementById('av-mode-opt-both');
  const optP1 = document.getElementById('av-mode-opt-p1');
  const optP2 = document.getElementById('av-mode-opt-p2');
  if (optBoth) optBoth.textContent = `2人（${p1}・${p2}）`;
  if (optP1) optP1.textContent = `${p1} のみ（1人目）`;
  if (optP2) optP2.textContent = `${p2} のみ（2人目）`;

  const tabP1 = document.getElementById('av-adv-tab-p1');
  const tabP2 = document.getElementById('av-adv-tab-p2');
  if (tabP1) tabP1.textContent = `${p1} の設定`;
  if (tabP2) tabP2.textContent = `${p2} の設定`;

  const tuneP1 = document.getElementById('av-mic-tune-label-p1');
  const tuneP2 = document.getElementById('av-mic-tune-label-p2');
  if (tuneP1) tuneP1.textContent = `${p1}（1人目）`;
  if (tuneP2) tuneP2.textContent = `${p2}（2人目）`;

  if (window.avatarSettingsUI?.rebuildLayerTitles) {
    window.avatarSettingsUI.rebuildLayerTitles(p1, p2);
  }
}

function getAvDisplayMode() {
  return readMdValue(document.getElementById('av-display-mode')) || 'both';
}

function setElHidden(el, hidden) {
  if (!el) return;
  el.hidden = !!hidden;
}

function applyAvDisplayModeUi() {
  const mode = getAvDisplayMode();
  const showP1 = mode === 'both' || mode === 'p1';
  const showP2 = mode === 'both' || mode === 'p2';
  const tabs = document.getElementById('av-adv-tabs');
  const panelP1 = document.querySelector('[data-avpanel="p1"]');
  const panelP2 = document.querySelector('[data-avpanel="p2"]');

  setElHidden(document.getElementById('av-p1-label'), !showP1);
  setElHidden(document.getElementById('av-p2-label'), !showP2);
  setElHidden(document.getElementById('av-mic-a'), !showP1);
  setElHidden(document.getElementById('av-mic-b'), !showP2);
  setElHidden(document.getElementById('av-mic-tune-p1'), !showP1);
  setElHidden(document.getElementById('av-mic-tune-p2'), !showP2);
  document.getElementById('av-label-grid')?.classList.toggle('is-single-slot', mode !== 'both');
  document.getElementById('av-mic-tune-grid')?.classList.toggle('is-single-slot', mode !== 'both');

  if (tabs) tabs.style.display = mode === 'both' ? '' : 'none';

  if (mode === 'both') {
    syncAvSubtabPanels();
    flushPendingMdFields('avatar');
    return;
  }

  if (panelP1) panelP1.style.display = showP1 ? '' : 'none';
  if (panelP2) panelP2.style.display = showP2 ? '' : 'none';
  flushPendingMdFields('avatar');

  if (mode === 'p1' && tabs) {
    tabs.activeTab = tabs.querySelector('[data-avtab="p1"]');
  } else if (mode === 'p2' && tabs) {
    tabs.activeTab = tabs.querySelector('[data-avtab="p2"]');
  }
}
