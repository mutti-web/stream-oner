'use strict';

const suiteLayout = require('./suite-layout');
const superchatTiers = require('./superchat-tiers');
const slotCfg = require('./avatar-slot-config');
const { normalizeRules } = require('./obs-event-dispatcher');

const STORE_KEY = 'suite.presets';
const STORE_VERSION = 3;
const MAX_PRESETS = 3;

/** 固定3スロット（レイアウトスロット） */
const SLOT_IDS = ['data-slot-1', 'data-slot-2', 'data-slot-3'];

const AVATAR_K = {
  displayMode: 'avatar.displayMode',
  p1Label: 'avatar.p1Label',
  p2Label: 'avatar.p2Label',
  p1Slot: 'avatar.p1Slot',
  p2Slot: 'avatar.p2Slot',
};

const OBS_K = {
  eventActions: 'obs.eventActions',
};

const YT_OVERLAY_K = {
  maxComments: 'yt.maxComments',
  showDurationMs: 'yt.showDurationMs',
  animMode: 'yt.animMode',
  position: 'yt.position',
  width: 'yt.width',
  gap: 'yt.gap',
  badgeFirst: 'yt.badgeFirst',
  badgeRegular: 'yt.badgeRegular',
  badgeThreshold: 'yt.badgeThreshold',
  superChatTiers: 'yt.superChatTiers',
};

const CUSTOM_CSS_K = 'customCssPath';

const DISPLAY_MODES = new Set(['both', 'p1', 'p2']);

function isSlotId(id) {
  return SLOT_IDS.includes(String(id || ''));
}

function readSlot(store, key) {
  const raw = store.get(key, null);
  if (raw && typeof raw === 'object') {
    return slotCfg.deepMerge(slotCfg.defaultSlot(), raw);
  }
  return slotCfg.defaultSlot();
}

function captureYoutubeOverlay(store) {
  return {
    maxComments: Math.max(1, Math.min(20, Number(store.get(YT_OVERLAY_K.maxComments, 8)) || 8)),
    showDurationMs: Math.max(2000, Number(store.get(YT_OVERLAY_K.showDurationMs, 8000)) || 8000),
    animMode: store.get(YT_OVERLAY_K.animMode, 'slide-up') || 'slide-up',
    position: store.get(YT_OVERLAY_K.position, 'bottom-right') || 'bottom-right',
    width: Math.max(200, Math.min(1200, Number(store.get(YT_OVERLAY_K.width, 400)) || 400)),
    gap: Math.max(0, Math.min(48, Number(store.get(YT_OVERLAY_K.gap, 6)) || 6)),
    badgeFirst: String(store.get(YT_OVERLAY_K.badgeFirst, '🔰初見') || '🔰初見'),
    badgeRegular: String(store.get(YT_OVERLAY_K.badgeRegular, '⭐常連') || '⭐常連'),
    badgeThreshold: Math.max(2, Number(store.get(YT_OVERLAY_K.badgeThreshold, 10)) || 10),
    superChatTiers: superchatTiers.normalizeTiers(store.get(YT_OVERLAY_K.superChatTiers)),
  };
}

function captureAvatarVisual(store) {
  const dm = store.get(AVATAR_K.displayMode, 'both');
  return {
    displayMode: DISPLAY_MODES.has(dm) ? dm : 'both',
    p1Label: store.get(AVATAR_K.p1Label, '配信者A') || '配信者A',
    p2Label: store.get(AVATAR_K.p2Label, '配信者B') || '配信者B',
    p1Slot: readSlot(store, AVATAR_K.p1Slot),
    p2Slot: readSlot(store, AVATAR_K.p2Slot),
  };
}

function captureObsEventActions(store) {
  return normalizeRules(store.get(OBS_K.eventActions, []));
}

function captureCurrentSnapshot(store) {
  return {
    suiteObsLayout: suiteLayout.getLayout(store),
    youtubeOverlay: captureYoutubeOverlay(store),
    avatarVisual: captureAvatarVisual(store),
    obsEventActions: captureObsEventActions(store),
    customCssPath: String(store.get(CUSTOM_CSS_K, '') || ''),
  };
}

function captureYoutubeOverlayFromPartial(raw) {
  const yt = raw.youtubeOverlay || raw.youtube || {};
  return {
    maxComments: yt.maxComments,
    showDurationMs: yt.showDurationMs,
    animMode: yt.animMode,
    position: yt.position,
    width: yt.width,
    gap: yt.gap,
    badgeFirst: yt.badgeFirst,
    badgeRegular: yt.badgeRegular,
    badgeThreshold: yt.badgeThreshold,
    superChatTiers: yt.superChatTiers,
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;

  let s = raw;
  if (raw.suiteFeatures) {
    const avatar = raw.avatar || {};
    s = {
      suiteObsLayout: raw.suiteObsLayout,
      youtubeOverlay: captureYoutubeOverlayFromPartial(raw),
      avatarVisual: {
        displayMode: avatar.displayMode,
        p1Label: avatar.p1Label,
        p2Label: avatar.p2Label,
        p1Slot: avatar.p1Slot,
        p2Slot: avatar.p2Slot,
      },
      obsEventActions: raw.obsEventActions,
      customCssPath: raw.customCssPath || '',
    };
  } else if (raw.avatar && !raw.avatarVisual) {
    s = { ...raw, avatarVisual: raw.avatar };
  }

  const yo = s.youtubeOverlay || {};
  const av = s.avatarVisual || {};

  return {
    suiteObsLayout: suiteLayout.normalizeLayout(s.suiteObsLayout || {}),
    youtubeOverlay: {
      maxComments: Math.max(1, Math.min(20, Number(yo.maxComments) || 8)),
      showDurationMs: Math.max(2000, Number(yo.showDurationMs) || 8000),
      animMode: yo.animMode === 'fade-in' ? 'fade-in' : 'slide-up',
      position: yo.position || 'bottom-right',
      width: Math.max(200, Math.min(1200, Number(yo.width) || 400)),
      gap: Math.max(0, Math.min(48, Number(yo.gap) || 6)),
      badgeFirst: String(yo.badgeFirst || '🔰初見'),
      badgeRegular: String(yo.badgeRegular || '⭐常連'),
      badgeThreshold: Math.max(2, Number(yo.badgeThreshold) || 10),
      superChatTiers: superchatTiers.normalizeTiers(yo.superChatTiers),
    },
    avatarVisual: {
      displayMode: DISPLAY_MODES.has(av.displayMode) ? av.displayMode : 'both',
      p1Label: String(av.p1Label || '配信者A'),
      p2Label: String(av.p2Label || '配信者B'),
      p1Slot: slotCfg.deepMerge(slotCfg.defaultSlot(), av.p1Slot || {}),
      p2Slot: slotCfg.deepMerge(slotCfg.defaultSlot(), av.p2Slot || {}),
    },
    obsEventActions: normalizeRules(s.obsEventActions),
    customCssPath: String(s.customCssPath || ''),
  };
}

function buildSlotSummary(snapshot) {
  const s = normalizeState(snapshot);
  if (!s) return '';
  const parts = ['OBSレイアウト'];
  const av = s.avatarVisual;
  if (av.displayMode === 'both') parts.push('アバター2人');
  else if (av.displayMode === 'p1') parts.push('1人目のみ');
  else parts.push('2人目のみ');
  const n = s.obsEventActions.length;
  if (n > 0) parts.push(`OBS連動 ${n}件`);
  if (s.customCssPath) parts.push('CSS');
  return parts.join(' · ');
}

function emptySlot(id) {
  return { id, empty: true, name: '', savedAt: null, snapshot: null, summary: '' };
}

function occupiedSlot(id, data) {
  const snapshot = normalizeState(data.snapshot);
  return {
    id,
    empty: false,
    name: String(data.name || '無題').slice(0, 32),
    savedAt: data.savedAt || null,
    snapshot,
    summary: buildSlotSummary(snapshot),
  };
}

function slotsToPublic(slots, activeId) {
  return slots.map((slot, idx) => ({
    slotIndex: idx + 1,
    id: slot.id,
    occupied: !slot.empty,
    name: slot.empty ? '' : slot.name,
    savedAt: slot.empty ? null : slot.savedAt,
    summary: slot.empty ? '' : (slot.summary || buildSlotSummary(slot.snapshot)),
  }));
}

function normalizeSlotsArray(slots) {
  const byId = new Map();
  (slots || []).forEach((s) => {
    if (s?.id && isSlotId(s.id)) byId.set(s.id, s);
  });
  return SLOT_IDS.map((id) => {
    const raw = byId.get(id);
    if (raw && !raw.empty && raw.snapshot) {
      return occupiedSlot(id, raw);
    }
    return emptySlot(id);
  });
}

function migrateLegacyItems(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return SLOT_IDS.map((id, idx) => {
    const old = items[idx];
    if (old?.snapshot) {
      return occupiedSlot(id, {
        name: old.name || `スロット${idx + 1}`,
        savedAt: old.savedAt || null,
        snapshot: old.snapshot,
      });
    }
    return emptySlot(id);
  });
}

function migrateStoredSlots(raw) {
  if (!raw || !Array.isArray(raw.slots)) return null;
  const slots = raw.slots.map((slot) => {
    if (slot.empty || !slot.snapshot) return emptySlot(slot.id);
    const snapshot = normalizeState(slot.snapshot);
    return occupiedSlot(slot.id, {
      name: slot.name,
      savedAt: slot.savedAt,
      snapshot,
    });
  });
  const activeId = raw.activeId && slots.some((s) => !s.empty && s.id === raw.activeId)
    ? raw.activeId
    : null;
  return { activeId, slots };
}

function getPresetsState(store) {
  const raw = store.get(STORE_KEY, null);
  let slots;
  let activeId = null;

  if (raw?.version === STORE_VERSION && Array.isArray(raw.slots)) {
    const migrated = migrateStoredSlots(raw);
    slots = migrated.slots;
    activeId = migrated.activeId;
  } else if (raw && (raw.version === 2 || Array.isArray(raw.slots) || Array.isArray(raw.items))) {
    if (Array.isArray(raw.slots)) {
      const migrated = migrateStoredSlots({ ...raw, slots: raw.slots });
      slots = migrated.slots;
      activeId = migrated.activeId;
    } else {
      slots = migrateLegacyItems(raw);
      activeId = raw.activeId && slots.some((s) => !s.empty && s.id === raw.activeId)
        ? raw.activeId
        : (slots.find((s) => !s.empty)?.id || null);
    }
    writePresetsState(store, { activeId, slots });
  } else {
    slots = SLOT_IDS.map((id) => emptySlot(id));
  }

  const publicSlots = slotsToPublic(slots, activeId);
  const items = slots.filter((s) => !s.empty).map((s) => ({
    id: s.id,
    name: s.name,
    savedAt: s.savedAt,
    summary: s.summary,
    snapshot: s.snapshot,
  }));

  return {
    version: STORE_VERSION,
    activeId,
    slots: publicSlots,
    items,
  };
}

function writePresetsState(store, state) {
  const slots = normalizeSlotsArray(state.slots);
  const activeId = state.activeId && slots.some((s) => !s.empty && s.id === state.activeId)
    ? state.activeId
    : null;
  store.set(STORE_KEY, { version: STORE_VERSION, activeId, slots });
  return getPresetsState(store);
}

function listPresets(store) {
  return getPresetsState(store);
}

function migratePresets(store) {
  return listPresets(store);
}

function findSlot(slots, id) {
  return slots.find((s) => s.id === id) || null;
}

/**
 * @param {object} store
 * @param {{ id: string, name: string }} opts — id は data-slot-1〜3 必須
 */
function saveCurrentAsPreset(store, opts) {
  const slotId = String(opts?.id || '');
  if (!isSlotId(slotId)) {
    return { success: false, error: 'スロット ID が不正です' };
  }
  const name = String(opts?.name || '').trim();
  if (!name) return { success: false, error: 'スロット名を入力してください' };

  const slots = normalizeSlotsArray(store.get(STORE_KEY, {})?.slots || SLOT_IDS.map((id) => emptySlot(id)));
  const snapshot = captureCurrentSnapshot(store);
  const now = new Date().toISOString();

  const nextSlots = slots.map((slot) => (
    slot.id === slotId
      ? occupiedSlot(slotId, { name, savedAt: now, snapshot })
      : slot
  ));

  const next = writePresetsState(store, { activeId: slotId, slots: nextSlots });
  return { success: true, presets: next, appliedId: slotId };
}

function clearSlot(store, id) {
  if (!isSlotId(id)) return { success: false, error: 'スロットが見つかりません' };
  const slots = normalizeSlotsArray(store.get(STORE_KEY, {})?.slots || []);
  if (!findSlot(slots, id) || findSlot(slots, id).empty) {
    return { success: false, error: 'スロットはすでに空です' };
  }
  const nextSlots = slots.map((slot) => (slot.id === id ? emptySlot(id) : slot));
  const raw = store.get(STORE_KEY, {});
  const activeId = raw.activeId === id ? null : raw.activeId;
  const next = writePresetsState(store, { activeId, slots: nextSlots });
  return { success: true, presets: next };
}

/** @deprecated clearSlot のエイリアス（IPC 互換） */
function deletePreset(store, id) {
  return clearSlot(store, id);
}

function renamePreset(store, id, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { success: false, error: '名前を入力してください' };
  if (!isSlotId(id)) return { success: false, error: 'スロットが見つかりません' };

  const slots = normalizeSlotsArray(store.get(STORE_KEY, {})?.slots || []);
  const slot = findSlot(slots, id);
  if (!slot || slot.empty) return { success: false, error: '空のスロットは名前変更できません' };

  const nextSlots = slots.map((s) => (
    s.id === id ? { ...s, name: trimmed.slice(0, 32) } : s
  ));
  const raw = store.get(STORE_KEY, {});
  const next = writePresetsState(store, { activeId: raw.activeId || null, slots: nextSlots });
  return { success: true, presets: next };
}

function writeYoutubeOverlayToStore(store, yo) {
  store.set(YT_OVERLAY_K.maxComments, yo.maxComments);
  store.set(YT_OVERLAY_K.showDurationMs, yo.showDurationMs);
  store.set(YT_OVERLAY_K.animMode, yo.animMode);
  store.set(YT_OVERLAY_K.position, yo.position);
  store.set(YT_OVERLAY_K.width, yo.width);
  store.set(YT_OVERLAY_K.gap, yo.gap);
  store.set(YT_OVERLAY_K.badgeFirst, yo.badgeFirst);
  store.set(YT_OVERLAY_K.badgeRegular, yo.badgeRegular);
  store.set(YT_OVERLAY_K.badgeThreshold, yo.badgeThreshold);
  store.set(YT_OVERLAY_K.superChatTiers, yo.superChatTiers);
}

function writeSnapshotToStore(store, snapshot) {
  const s = normalizeState(snapshot);
  if (!s) return { success: false, error: '不正なスナップショットです' };

  suiteLayout.saveLayout(store, s.suiteObsLayout);
  writeYoutubeOverlayToStore(store, s.youtubeOverlay);
  store.set(OBS_K.eventActions, s.obsEventActions);
  store.set(CUSTOM_CSS_K, s.customCssPath || '');

  const av = s.avatarVisual;
  store.set(AVATAR_K.displayMode, av.displayMode);
  store.set(AVATAR_K.p1Label, av.p1Label);
  store.set(AVATAR_K.p2Label, av.p2Label);
  slotCfg.saveSlot(store, AVATAR_K.p1Slot, av.p1Slot);
  slotCfg.saveSlot(store, AVATAR_K.p2Slot, av.p2Slot);

  return { success: true, snapshot: s };
}

function applyPreset(store, id) {
  if (!isSlotId(id)) return { success: false, error: 'スロットが見つかりません' };
  const slots = normalizeSlotsArray(store.get(STORE_KEY, {})?.slots || []);
  const slot = findSlot(slots, id);
  if (!slot || slot.empty || !slot.snapshot) {
    return { success: false, error: '空のスロットは読み込めません' };
  }
  const wr = writeSnapshotToStore(store, slot.snapshot);
  if (!wr.success) return wr;
  const next = writePresetsState(store, { activeId: id, slots });
  return { success: true, presets: next, snapshot: wr.snapshot };
}

module.exports = {
  STORE_KEY,
  STORE_VERSION,
  SLOT_IDS,
  MAX_PRESETS,
  captureCurrentSnapshot,
  normalizeState,
  listPresets,
  migratePresets,
  saveCurrentAsPreset,
  applyPreset,
  deletePreset,
  clearSlot,
  renamePreset,
  writeSnapshotToStore,
};
