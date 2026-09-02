let avatarFormsHydrated = false;

function isAvatarPathKey(key) {
  return key.startsWith('p1_path_') || key.startsWith('p2_path_');
}

/** 非表示タブで DOM が空でも、キャッシュ済みの画像パスを保存 payload に復元する */
function mergeAvatarPathsFromCache(payload, opts = {}) {
  const cleared = new Set(opts.clearedPathKeys || []);
  if (!avConfigCache || typeof avConfigCache !== 'object') return payload;
  for (const key of Object.keys(avConfigCache)) {
    if (!isAvatarPathKey(key)) continue;
    const domVal = String(payload[key] ?? '').trim();
    if (!domVal && !cleared.has(key) && avConfigCache[key]) {
      payload[key] = avConfigCache[key];
    }
  }
  if (cleared.size) payload.__clearedPathKeys = [...cleared];
  return payload;
}

/** collect されなかったスロットキーはキャッシュから復元（巻き戻し防止） */
function mergeAbsentSlotFieldsFromCache(payload) {
  if (!avConfigCache || typeof avConfigCache !== 'object') return payload;
  for (const key of Object.keys(avConfigCache)) {
    if (!key.startsWith('p1_') && !key.startsWith('p2_')) continue;
    if (!(key in payload) && avConfigCache[key] !== undefined) {
      payload[key] = avConfigCache[key];
    }
  }
  if (!('p1Reactions' in payload) && avConfigCache.p1Reactions) {
    payload.p1Reactions = avConfigCache.p1Reactions;
  }
  if (!('p2Reactions' in payload) && avConfigCache.p2Reactions) {
    payload.p2Reactions = avConfigCache.p2Reactions;
  }
  return payload;
}

const REACTION_DEFAULT_MS = 4000;
const REACTION_MAX = 8;

function newReactionId() {
  return `react-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function reactionsHiddenInput(prefix) {
  return document.querySelector('[data-av-reactions-json="' + prefix + '"]');
}

function reactionsListEl(prefix) {
  return document.querySelector('[data-av-reactions-list="' + prefix + '"]');
}

function pathToFileUrl(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return '';
  if (p.startsWith('file://')) return p;
  const normalized = p.replace(/\\/g, '/');
  const encoded = normalized.split('/').map((seg, i) => {
    if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg;
    return encodeURIComponent(seg);
  }).join('/');
  if (normalized.startsWith('/')) return 'file://' + encoded;
  return 'file:///' + encoded;
}

function updateReactionThumb(row) {
  const img = row.querySelector('.av-reaction-thumb');
  const path = String(row.querySelector('[data-reaction-k="path"]')?.value || '').trim();
  if (!img) return;
  if (!path) {
    img.hidden = true;
    img.removeAttribute('src');
    return;
  }
  img.onerror = () => { img.hidden = true; };
  img.onload = () => { img.hidden = false; };
  img.src = pathToFileUrl(path);
}

function syncReactionsJson(prefix) {
  const hidden = reactionsHiddenInput(prefix);
  const list = reactionsListEl(prefix);
  if (!hidden || !list) return;
  const rows = list.querySelectorAll('[data-reaction-row]');
  const items = [];
  rows.forEach((row) => {
    const label = String(row.querySelector('[data-reaction-k="label"]')?.value || '').trim();
    const path = String(row.querySelector('[data-reaction-k="path"]')?.value || '').trim();
    const durationSec = Number(row.querySelector('[data-reaction-k="durationMs"]')?.value);
    const flipX = !!row.querySelector('[data-reaction-k="flipX"]')?.checked;
    const id = row.dataset.reactionId || newReactionId();
    if (!label || !path) return;
    items.push({
      id,
      label,
      path,
      durationMs: Number.isFinite(durationSec) && durationSec >= 1
        ? Math.round(Math.min(30, durationSec) * 1000)
        : REACTION_DEFAULT_MS,
      flipX,
    });
  });
  hidden.value = JSON.stringify(items);
  if (avConfigCache) {
    avConfigCache[prefix === 'p2' ? 'p2Reactions' : 'p1Reactions'] = items;
  }
}

function readReactionsList(prefix) {
  syncReactionsJson(prefix);
  try {
    const hidden = reactionsHiddenInput(prefix);
    const parsed = JSON.parse(hidden?.value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function createReactionRow(prefix, reaction = {}) {
  const row = document.createElement('div');
  row.className = 'av-reaction-row';
  row.dataset.reactionRow = '1';
  row.dataset.reactionId = reaction.id || newReactionId();
  const dur = Number(reaction.durationMs) || REACTION_DEFAULT_MS;
  row.innerHTML =
    '<div class="av-reaction-row-main">' +
      '<img class="av-reaction-thumb" alt="" hidden />' +
      '<div class="av-reaction-row-fields">' +
        '<md-outlined-text-field data-reaction-k="label" label="ボタン名（スマホ表示）" maxlength="32"></md-outlined-text-field>' +
        '<div class="url-row">' +
          '<md-outlined-text-field data-reaction-k="path" label="PNG パス" readonly class="app-grow"></md-outlined-text-field>' +
          '<md-outlined-button type="button" class="av-reaction-browse" data-reaction-prefix="' + prefix + '">参照</md-outlined-button>' +
        '</div>' +
        '<div class="av-reaction-row-meta">' +
          '<md-outlined-text-field data-reaction-k="durationMs" label="表示秒数" type="number" min="1" max="30" step="1"></md-outlined-text-field>' +
          '<label class="app-row app-row-compact app-toggle-inline">' +
            '<span class="app-toggle-name">水平反転</span>' +
            '<md-switch data-reaction-k="flipX" icons show-only-selected-icon></md-switch>' +
          '</label>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="av-reaction-row-actions">' +
      '<md-outlined-button type="button" class="av-reaction-remove">削除</md-outlined-button>' +
    '</div>';
  row.querySelector('[data-reaction-k="label"]').value = reaction.label || '';
  row.querySelector('[data-reaction-k="path"]').value = reaction.path || '';
  row.querySelector('[data-reaction-k="durationMs"]').value = String(Math.round(dur / 1000));
  const flipEl = row.querySelector('[data-reaction-k="flipX"]');
  if (flipEl) flipEl.checked = !!reaction.flipX;
  updateReactionThumb(row);
  return row;
}

function renderReactionsList(prefix, reactions) {
  const list = reactionsListEl(prefix);
  if (!list) return;
  list.replaceChildren();
  const items = Array.isArray(reactions) ? reactions.slice(0, REACTION_MAX) : [];
  for (const r of items) {
    list.appendChild(createReactionRow(prefix, r));
  }
  syncReactionsJson(prefix);
  window.appUI?.patchAllSwitches?.();
}

function buildAvatarPayload(opts = {}) {
  const payload = {
    enabled: isAvatarFeatureEnabled(),
    displayMode: readMdValue(document.getElementById('av-display-mode')) || 'both',
    micADeviceId: readMdValue(document.getElementById('av-mic-a')),
    micBDeviceId: readMdValue(document.getElementById('av-mic-b')),
    p1Label: readMdValue(document.getElementById('av-p1-label')).trim() || '配信者A',
    p2Label: readMdValue(document.getElementById('av-p2-label')).trim() || '配信者B',
    smileDetectEnabled: document.getElementById('av-smile-detect').checked,
    smileSensitivity: readMdNum(document.getElementById('av-smile-sensitivity'), 50),
    faceTrackEnabled: !!document.getElementById('av-face-track')?.checked,
    faceAssignSwap: !!document.getElementById('av-face-assign-swap')?.checked,
    cameraDeviceId: readMdValue(document.getElementById('av-camera')) || '',
  };
  if (window.avatarSettingsUI) {
    Object.assign(payload, window.avatarSettingsUI.collectAll());
  }
  payload.p1Reactions = readReactionsList('p1');
  payload.p2Reactions = readReactionsList('p2');
  mergeAbsentSlotFieldsFromCache(payload);
  return mergeAvatarPathsFromCache(payload, opts);
}

async function persistAvatar(opts = {}) {
  if (suppressAutoSave > 0 || (!avatarFormsHydrated && !opts.force)) return;
  const r = await api.saveAvatarConfig(buildAvatarPayload(opts)).catch((e) => ({ success: false, error: e.message }));
  if (r.success) {
    showFb('av-fb', '保存しました。');
    avConfigCache = { ...avConfigCache, ...buildAvatarPayload() };
    if (window.avatarSettingsUI) {
      Object.assign(avConfigCache, window.avatarSettingsUI.collectAll());
    }
    const st = await api.getAvatarStatus();
    setAvBadge(st);
    refreshSetupChecklist({
      immediate: true,
      patch: { av: { ...avConfigCache }, avSt: st },
    });
  } else {
    showFb('av-fb', '保存エラー: ' + r.error, 'err');
  }
}

const debouncedAvatar = debounce(persistAvatar, 700);

// ===== アバターマイク =====
function fillMicSelect(selectEl, devices, selectedId) {
  if (!selectEl) return;
  const prev = selectedId || selectEl.value;
  selectEl.innerHTML = '';
  const empty = document.createElement('md-select-option');
  empty.value = '';
  empty.innerHTML = '<div slot="headline">— 未選択 —</div>';
  selectEl.appendChild(empty);
  devices.forEach((d) => {
    const opt = document.createElement('md-select-option');
    opt.value = d.deviceId;
    const label = d.label || `マイク (${d.deviceId.slice(0, 8)}…)`;
    const head = document.createElement('div');
    head.setAttribute('slot', 'headline');
    head.textContent = label;
    opt.appendChild(head);
    selectEl.appendChild(opt);
  });
  // 直後に value を設定して候補と合わせる
  if (prev) {
    queueMicrotask(() => { try { setMdFieldValue(selectEl, prev); } catch (_) {} });
  }
}

function fillCameraSelect(selectEl, devices, selectedId) {
  if (!selectEl) return;
  const prev = selectedId !== undefined ? selectedId : selectEl.value;
  selectEl.innerHTML = '';
  const empty = document.createElement('md-select-option');
  empty.value = '';
  empty.innerHTML = '<div slot="headline">— 既定カメラ —</div>';
  selectEl.appendChild(empty);
  devices.forEach((d) => {
    const opt = document.createElement('md-select-option');
    opt.value = d.deviceId;
    const label = d.label || `カメラ (${d.deviceId.slice(0, 8)}…)`;
    const head = document.createElement('div');
    head.setAttribute('slot', 'headline');
    head.textContent = label;
    opt.appendChild(head);
    selectEl.appendChild(opt);
  });
  queueMicrotask(() => {
    try { setMdFieldValue(selectEl, prev || ''); } catch (_) {}
  });
}

function updateFaceTrackStatus(st) {
  const el = document.getElementById('av-face-status');
  if (!el) return;
  const on = !!document.getElementById('av-face-track')?.checked;
  if (!on) {
    el.textContent = '顔トラッキング: オフ';
    if (facePreviewVisible) setFacePreviewVisible(false, { silent: true });
    else drawFacePreviewIdle();
    return;
  }
  if (st?.faceError) {
    el.textContent = `顔トラッキング: エラー — ${st.faceError}`;
    return;
  }
  if (facePreviewVisible && lastFacePreview?.calibrating) {
    el.textContent = '顔トラッキング: 正面を記憶中… 正面をキープ';
    return;
  }
  el.textContent = st?.faceRunning ? '顔トラッキング: 稼働中' : '顔トラッキング: 待機中';
}

/** @type {object|null} */
let lastFacePreview = null;
/** 設定プレビュー表示中か（既定 OFF・配信向け） */
let facePreviewVisible = false;
/** 設定ウィンドウ hide/minimize で capture 側だけ止めたとき（UI の表示意図は保持） */
let facePreviewPausedByWindow = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let facePreviewAutoOffTimer = null;
const FACE_PREVIEW_AUTO_OFF_MS = 5 * 60 * 1000;

function clearFacePreviewAutoOff() {
  if (facePreviewAutoOffTimer) {
    clearTimeout(facePreviewAutoOffTimer);
    facePreviewAutoOffTimer = null;
  }
}

function syncFacePreviewToggleUi() {
  const btn = document.getElementById('av-face-preview-toggle');
  const wrap = document.getElementById('av-face-preview-wrap');
  const hint = document.getElementById('av-face-preview-hint');
  if (wrap) wrap.hidden = !facePreviewVisible;
  if (btn) btn.textContent = facePreviewVisible ? 'プレビューを隠す' : 'プレビューを表示';
  if (hint) {
    hint.textContent = facePreviewVisible
      ? 'プレビュー表示中。5分で自動OFF（または「隠す」）。配信中は隠した方が軽いです。'
      : '配信中は非表示推奨。表示すると表情・向きの確認用に負荷が増えます（5分で自動OFF）。';
  }
}

/**
 * @param {boolean} on
 * @param {{ silent?: boolean, reason?: string }} [opts]
 */
async function setFacePreviewVisible(on, opts = {}) {
  const next = !!on;
  clearFacePreviewAutoOff();
  facePreviewVisible = next;
  facePreviewPausedByWindow = false;
  if (!next) lastFacePreview = null;
  syncFacePreviewToggleUi();

  try {
    await api.setAvatarFacePreview?.(next);
  } catch (_) { /* */ }

  if (next) {
    drawFacePreviewIdle();
    facePreviewAutoOffTimer = setTimeout(() => {
      setFacePreviewVisible(false, { reason: 'timeout' });
    }, FACE_PREVIEW_AUTO_OFF_MS);
    if (!opts.silent) {
      showFb('av-fb', 'プレビューを表示しました（5分で自動OFF）。');
    }
  } else {
    drawFacePreviewIdle();
    if (!opts.silent) {
      if (opts.reason === 'timeout') {
        showFb('av-fb', 'プレビューを5分経過のため自動で非表示にしました。');
      }
    }
  }
}

/**
 * 設定ウィンドウ hide/show と capture プレビューのずれを解消する。
 * hide 時 main は capture だけ止めるため、UI を一時停止表示にし、show で再開する。
 * @param {{ reason?: string }} [msg]
 */
function onFacePreviewWindowSync(msg) {
  const reason = msg?.reason || '';
  if (reason === 'window-hidden' || reason === 'window-minimized') {
    if (!facePreviewVisible) return;
    facePreviewPausedByWindow = true;
    drawFacePreviewPaused();
    return;
  }
  if (reason === 'window-shown') {
    if (!facePreviewVisible) return;
    facePreviewPausedByWindow = false;
    api.setAvatarFacePreview?.(true).catch(() => { /* */ });
    if (lastFacePreview) drawFacePreview(lastFacePreview);
    else drawFacePreviewIdle();
  }
}

/** face-capture の PREVIEW_LANDMARK_IDX と同じ並び */
const PREVIEW_OVAL_LEN = 36;
const PREVIEW_LEYE_LEN = 6;
const PREVIEW_REYE_LEN = 6;

function getFacePreviewCanvas() {
  return document.getElementById('av-face-preview');
}

function readFacePreviewLabels() {
  const p1 = (readMdValue(document.getElementById('av-p1-label')) || avConfigCache?.p1Label || '配信者A').trim() || '配信者A';
  const p2 = (readMdValue(document.getElementById('av-p2-label')) || avConfigCache?.p2Label || '配信者B').trim() || '配信者B';
  return { p1, p2 };
}

/** ラジアン or 相対 pose → 描画用の傾き（おおよそ ±0.7rad をフル） */
function resolveHeadAngles(slot) {
  const e = slot?.euler;
  if (e && Number.isFinite(e.yaw)) {
    return {
      yaw: Number(e.yaw) || 0,
      pitch: Number(e.pitch) || 0,
      roll: Number(e.roll) || 0,
    };
  }
  // フォールバック: 既存の相対 yaw/pitch（約 ±1）
  return {
    yaw: (Number(slot?.yaw) || 0) * 0.55,
    pitch: (Number(slot?.pitch) || 0) * 0.45,
    roll: 0,
  };
}

function blendVal(blend, key, fallback = 0) {
  const v = blend?.[key];
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/**
 * 肩＋3D回転する頭部シルエット（実写なし）。
 * 表情は blendshapes で目・口・眉を変化。
 */
function drawPersonSilhouette(ctx, box, slot, opts) {
  const { x, y, w, h } = box;
  const active = !!slot?.tracking;
  const label = opts.label || '';
  const color = opts.color || 'rgba(56, 189, 248, 0.95)';
  const { yaw, pitch, roll } = resolveHeadAngles(slot);
  const blend = slot?.blend || null;

  const blinkL = Math.max(blendVal(blend, 'eyeBlinkLeft'), blendVal(blend, 'eyeBlinkRight') * 0.35);
  const blinkR = Math.max(blendVal(blend, 'eyeBlinkRight'), blendVal(blend, 'eyeBlinkLeft') * 0.35);
  const jaw = blendVal(blend, 'jawOpen');
  const smile = (blendVal(blend, 'mouthSmileLeft') + blendVal(blend, 'mouthSmileRight')) * 0.5;
  const browUp = blendVal(blend, 'browInnerUp');
  const browDn = (blendVal(blend, 'browDownLeft') + blendVal(blend, 'browDownRight')) * 0.5;

  const cx = x + w * 0.5;
  const cy = y + h * 0.38;
  const headR = Math.min(w, h) * 0.22;

  ctx.save();

  // ラベル
  if (label) {
    ctx.fillStyle = active ? color : 'rgba(148, 163, 184, 0.85)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxW = w - 8;
    let text = label;
    if (ctx.measureText(text).width > maxW) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxW) text = text.slice(0, -1);
      text = `${text}…`;
    }
    ctx.fillText(text, cx, y + 6);
  }

  // 肩〜胴（カメラ左右反転に合わせ、yaw は見た目用に反転）
  const viewYaw = -yaw;
  const shoulderShift = viewYaw * headR * 0.35;
  ctx.fillStyle = active ? 'rgba(100, 130, 160, 0.5)' : 'rgba(100, 116, 139, 0.28)';
  ctx.beginPath();
  ctx.moveTo(cx - headR * 1.7 + shoulderShift * 0.3, cy + headR * 1.45);
  ctx.quadraticCurveTo(cx - headR * 2.3, cy + headR * 2.6, cx - headR * 2.1, y + h + 2);
  ctx.lineTo(cx + headR * 2.1, y + h + 2);
  ctx.quadraticCurveTo(cx + headR * 2.3, cy + headR * 2.6, cx + headR * 1.7 + shoulderShift * 0.3, cy + headR * 1.45);
  ctx.closePath();
  ctx.fill();

  // 首
  ctx.fillRect(cx - headR * 0.22 + shoulderShift * 0.15, cy + headR * 0.7, headR * 0.44, headR * 0.8);

  // 頭部（行列由来の yaw/pitch/roll）
  ctx.save();
  ctx.translate(cx + shoulderShift * 0.2, cy + pitch * headR * 0.25);
  ctx.rotate(roll * 0.85);
  const sx = 0.92 + Math.cos(viewYaw) * 0.08;
  const sy = 1.05 - Math.abs(pitch) * 0.08;
  ctx.scale(sx, sy);
  // 顔の奥行き感: yaw で左右の幅をわずかに変える楕円
  ctx.beginPath();
  ctx.ellipse(0, 0, headR * (0.88 + Math.abs(Math.sin(viewYaw)) * 0.06), headR, viewYaw * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = active ? 'rgba(120, 150, 180, 0.72)' : 'rgba(100, 116, 139, 0.38)';
  ctx.fill();

  // 向きガイド（鼻方向の短い線）
  if (active) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, headR * 0.05);
    ctx.lineTo(Math.sin(viewYaw) * headR * 0.55, Math.sin(pitch) * headR * 0.35 + headR * 0.15);
    ctx.stroke();
  }

  // 眉
  const browY = -headR * (0.28 - browUp * 0.08 + browDn * 0.06);
  ctx.strokeStyle = active ? 'rgba(226, 232, 240, 0.9)' : 'rgba(148, 163, 184, 0.55)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const bx = side * headR * 0.32 + Math.sin(viewYaw) * headR * 0.08;
    ctx.beginPath();
    ctx.moveTo(bx - headR * 0.14, browY + side * browDn * headR * 0.02);
    ctx.quadraticCurveTo(bx, browY - headR * 0.02, bx + headR * 0.14, browY - side * browDn * headR * 0.02);
    ctx.stroke();
  }

  // 目（まばたきで縦につぶれる）
  const eyeY = -headR * 0.08;
  for (const [side, blink] of [[-1, blinkL], [1, blinkR]]) {
    const ex = side * headR * 0.32 + Math.sin(viewYaw) * headR * 0.1;
    const ew = headR * 0.12;
    const eh = headR * 0.08 * (1 - blink * 0.92);
    ctx.fillStyle = active ? 'rgba(241, 245, 249, 0.95)' : 'rgba(203, 213, 225, 0.55)';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, ew, Math.max(1.2, eh), 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 口（jawOpen / smile）
  const mouthY = headR * (0.32 + jaw * 0.06);
  const mouthW = headR * (0.22 + smile * 0.1);
  const mouthH = headR * (0.04 + jaw * 0.18 + smile * 0.02);
  ctx.strokeStyle = active ? color : 'rgba(148, 163, 184, 0.7)';
  ctx.fillStyle = active ? 'rgba(15, 23, 42, 0.55)' : 'rgba(51, 65, 85, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (jaw > 0.12) {
    ctx.ellipse(Math.sin(viewYaw) * headR * 0.05, mouthY, mouthW, mouthH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.moveTo(-mouthW + Math.sin(viewYaw) * headR * 0.05, mouthY);
    ctx.quadraticCurveTo(
      Math.sin(viewYaw) * headR * 0.05,
      mouthY + headR * (0.06 + smile * 0.1),
      mouthW + Math.sin(viewYaw) * headR * 0.05,
      mouthY,
    );
    ctx.stroke();
  }

  ctx.restore(); // head transform

  // 未検出時の薄表示
  if (!active) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('未検出', cx, cy + headR * 1.9);
  }

  ctx.restore();
}

function strokePolyline(ctx, pts, close) {
  if (!pts?.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  ctx.stroke();
}

function mapPreviewPoints(points, w, h) {
  if (!points?.length) return null;
  // セルフィー感のため左右反転（実写は出さない）
  return points.map(([x, y]) => [(1 - Number(x)) * w, Number(y) * h]);
}

function drawLandmarkMarks(ctx, points, color) {
  if (!points?.length) return;
  const oval = points.slice(0, PREVIEW_OVAL_LEN);
  const lEye = points.slice(PREVIEW_OVAL_LEN, PREVIEW_OVAL_LEN + PREVIEW_LEYE_LEN);
  const rEye = points.slice(
    PREVIEW_OVAL_LEN + PREVIEW_LEYE_LEN,
    PREVIEW_OVAL_LEN + PREVIEW_LEYE_LEN + PREVIEW_REYE_LEN,
  );
  const lips = points.slice(PREVIEW_OVAL_LEN + PREVIEW_LEYE_LEN + PREVIEW_REYE_LEN);

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.15;
  ctx.lineJoin = 'round';
  strokePolyline(ctx, oval, true);
  strokePolyline(ctx, lEye, true);
  strokePolyline(ctx, rEye, true);
  strokePolyline(ctx, lips, true);
  ctx.globalAlpha = 1;
}

function drawFacePreviewIdle() {
  const canvas = getFacePreviewCanvas();
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const labels = readFacePreviewLabels();
  const mode = readMdValue(document.getElementById('av-display-mode')) || 'both';
  if (mode === 'both') {
    drawPersonSilhouette(ctx, { x: 0, y: 0, w: w / 2, h }, null, { label: labels.p1, color: 'rgba(56, 189, 248, 0.7)' });
    drawPersonSilhouette(ctx, { x: w / 2, y: 0, w: w / 2, h }, null, { label: labels.p2, color: 'rgba(251, 146, 60, 0.7)' });
    // 中央の区切り
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.beginPath();
    ctx.moveTo(w / 2, 8);
    ctx.lineTo(w / 2, h - 8);
    ctx.stroke();
  } else if (mode === 'p2') {
    drawPersonSilhouette(ctx, { x: 0, y: 0, w, h }, null, { label: labels.p2, color: 'rgba(251, 146, 60, 0.7)' });
  } else {
    drawPersonSilhouette(ctx, { x: 0, y: 0, w, h }, null, { label: labels.p1, color: 'rgba(56, 189, 248, 0.7)' });
  }
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('トラッキング OFF / 待機', w / 2, h - 14);
  const cap = document.getElementById('av-face-preview-caption');
  if (cap) cap.textContent = 'プレビュー待機中。';
}

/** ウィンドウ非表示中の一時停止表示（古いフレームを「生きている」と誤認させない） */
function drawFacePreviewPaused() {
  const canvas = getFacePreviewCanvas();
  if (!canvas || !facePreviewVisible) return;
  if (lastFacePreview) {
    // 下地として最後のフレームを描き、上に一時停止オーバーレイ
    facePreviewPausedByWindow = false;
    drawFacePreview(lastFacePreview);
    facePreviewPausedByWindow = true;
  } else {
    drawFacePreviewIdle();
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('設定ウィンドウ非表示のため一時停止', w / 2, h / 2);
  const cap = document.getElementById('av-face-preview-caption');
  if (cap) cap.textContent = 'ウィンドウを表示するとプレビューが再開します。';
}

function drawFacePreview(preview) {
  if (!facePreviewVisible || facePreviewPausedByWindow) return;
  lastFacePreview = preview || null;
  const canvas = getFacePreviewCanvas();
  if (!canvas) return;
  const on = !!document.getElementById('av-face-track')?.checked;
  if (!on) {
    drawFacePreviewIdle();
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const p1 = preview?.p1 || {};
  const p2 = preview?.p2 || {};
  const tracking = !!(preview?.tracking || p1.tracking || p2.tracking);
  const mode = readMdValue(document.getElementById('av-display-mode')) || 'both';
  const labels = readFacePreviewLabels();
  const colorP1 = 'rgba(56, 189, 248, 0.95)';
  const colorP2 = 'rgba(251, 146, 60, 0.95)';

  if (mode === 'both') {
    drawPersonSilhouette(ctx, { x: 0, y: 0, w: w / 2, h }, p1, { label: labels.p1, color: colorP1 });
    drawPersonSilhouette(ctx, { x: w / 2, y: 0, w: w / 2, h }, p2, { label: labels.p2, color: colorP2 });
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.beginPath();
    ctx.moveTo(w / 2, 8);
    ctx.lineTo(w / 2, h - 8);
    ctx.stroke();
    // ランドマークは全体座標のまま薄く重ねる（割り当て確認用）
    drawLandmarkMarks(ctx, mapPreviewPoints(p1.points, w, h), colorP1);
    drawLandmarkMarks(ctx, mapPreviewPoints(p2.points, w, h), colorP2);
  } else if (mode === 'p2') {
    drawPersonSilhouette(ctx, { x: 0, y: 0, w, h }, p2, { label: labels.p2, color: colorP2 });
    drawLandmarkMarks(ctx, mapPreviewPoints(p2.points, w, h), colorP2);
  } else {
    drawPersonSilhouette(ctx, { x: 0, y: 0, w, h }, p1, { label: labels.p1, color: colorP1 });
    drawLandmarkMarks(ctx, mapPreviewPoints(p1.points, w, h), colorP1);
  }

  const cap = document.getElementById('av-face-preview-caption');
  if (cap) {
    if (preview?.calibrating) {
      cap.textContent = '正面を記憶しています… 動かず正面をキープしてください。';
    } else if (tracking) {
      cap.textContent = '実写なし。頭の向き・まばたき・口の開閉と表示名で割り当てを確認できます。';
    } else {
      cap.textContent = '顔を検出できていません。カメラに正面を向けてください。';
    }
  }
  if (preview?.calibrating) {
    const el = document.getElementById('av-face-status');
    if (el) el.textContent = '顔トラッキング: 正面を記憶中… 正面をキープ';
  } else if (tracking) {
    const el = document.getElementById('av-face-status');
    if (el && !el.textContent.includes('エラー')) {
      el.textContent = '顔トラッキング: 稼働中（検出中）';
    }
  }
}

async function scanMics() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    showFb('av-fb', 'マイク許可が必要です: ' + e.message, 'err');
    return [];
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}

async function scanCameras() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  } catch (e) {
    showFb('av-fb', 'カメラ許可が必要です: ' + e.message, 'err');
    return [];
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

function updateAvVuMeters(levels) {
  for (const id of ['p1', 'p2']) {
    const bar = document.getElementById(`av-vu-${id}`);
    const val = document.getElementById(`av-vu-${id}-val`);
    const lvl = Math.max(0, Math.min(100, Number(levels[id]) || 0));
    if (bar) {
      bar.style.width = `${lvl}%`;
      bar.classList.toggle('speaking', !!levels[`${id}Speaking`]);
    }
    if (val) val.textContent = String(Math.round(lvl));
  }
}

async function initAvatar() {
  avatarFormsHydrated = false;
  suppressAutoSave++;
  const cfg = await api.getAvatarConfig().catch(() => ({}));
  avConfigCache = { ...cfg };
  setMdFieldValue(document.getElementById('av-display-mode'), cfg.displayMode || 'both');
  setMdFieldValue(document.getElementById('av-p1-label'), cfg.p1Label || '配信者A');
  setMdFieldValue(document.getElementById('av-p2-label'), cfg.p2Label || '配信者B');
  document.getElementById('av-smile-detect').checked = !!cfg.smileDetectEnabled;
  setMdFieldValue(document.getElementById('av-smile-sensitivity'), cfg.smileSensitivity ?? 50);
  const faceSw = document.getElementById('av-face-track');
  if (faceSw) faceSw.checked = !!cfg.faceTrackEnabled;
  const swapSw = document.getElementById('av-face-assign-swap');
  if (swapSw) swapSw.checked = !!cfg.faceAssignSwap;
  setMdFieldValue(document.getElementById('av-obs-url'), cfg.obsUrl || 'http://127.0.0.1:3003/overlay');

  if (window.avatarSettingsUI) {
    window.avatarSettingsUI.ensureBuilt();
    window.avatarSettingsUI.fillAll(cfg);
  }
  updateAvatarLabelUi();
  applyAvDisplayModeUi();
  renderReactionsList('p1', cfg.p1Reactions || []);
  renderReactionsList('p2', cfg.p2Reactions || []);

  const mics = await scanMics();
  fillMicSelect(document.getElementById('av-mic-a'), mics, cfg.micADeviceId);
  fillMicSelect(document.getElementById('av-mic-b'), mics, cfg.micBDeviceId);

  const cams = await scanCameras().catch(() => []);
  fillCameraSelect(document.getElementById('av-camera'), cams, cfg.cameraDeviceId || '');

  const st = await api.getAvatarStatus().catch(() => ({ serverRunning: false }));
  setAvBadge(st);
  updateFaceTrackStatus(st);
  facePreviewVisible = false;
  facePreviewPausedByWindow = false;
  syncFacePreviewToggleUi();
  try { await api.setAvatarFacePreview?.(false); } catch (_) { /* */ }
  drawFacePreviewIdle();
  suppressAutoSave--;
  avatarFormsHydrated = true;
}

function bindAvatarActions() {
  document.getElementById('av-display-mode')?.addEventListener('change', () => {
    applyAvDisplayModeUi();
    if (facePreviewVisible) {
      if (lastFacePreview) drawFacePreview(lastFacePreview);
      else drawFacePreviewIdle();
    }
    debouncedAvatar();
  });
  const debouncedLabelUi = debounce(updateAvatarLabelUi, 300);
  const refreshFacePreviewLabels = () => {
    if (!facePreviewVisible) return;
    if (lastFacePreview) drawFacePreview(lastFacePreview);
    else drawFacePreviewIdle();
  };
  document.getElementById('av-p1-label')?.addEventListener('input', () => {
    debouncedLabelUi();
    refreshFacePreviewLabels();
  });
  document.getElementById('av-p2-label')?.addEventListener('input', () => {
    debouncedLabelUi();
    refreshFacePreviewLabels();
  });

  document.getElementById('panel-avatar')?.addEventListener('click', (ev) => {
    const addBtn = ev.target?.closest?.('[data-av-reactions-add]');
    if (addBtn) {
      const prefix = addBtn.dataset.avReactionsAdd;
      const list = reactionsListEl(prefix);
      if (!list || list.querySelectorAll('[data-reaction-row]').length >= REACTION_MAX) {
        showFb('av-fb', `リアクションは最大 ${REACTION_MAX} 件までです。`, 'err');
        return;
      }
      list.appendChild(createReactionRow(prefix, { durationMs: REACTION_DEFAULT_MS }));
      window.appUI?.patchAllSwitches?.();
      syncReactionsJson(prefix);
      debouncedAvatar();
      return;
    }

    const removeBtn = ev.target?.closest?.('.av-reaction-remove');
    if (!removeBtn) return;
    const row = removeBtn.closest('[data-reaction-row]');
    const list = row?.closest('[data-av-reactions]');
    const prefix = list?.dataset?.avReactions;
    row?.remove();
    if (prefix) syncReactionsJson(prefix);
    debouncedAvatar();
  });

  document.getElementById('panel-avatar')?.addEventListener('input', (ev) => {
    const row = ev.target?.closest?.('[data-reaction-row]');
    if (!row) return;
    const list = row.closest('[data-av-reactions]');
    const prefix = list?.dataset?.avReactions;
    if (prefix) syncReactionsJson(prefix);
    debouncedAvatar();
  });

  document.getElementById('panel-avatar')?.addEventListener('change', (ev) => {
    const row = ev.target?.closest?.('[data-reaction-row]');
    if (!row) return;
    const list = row.closest('[data-av-reactions]');
    const prefix = list?.dataset?.avReactions;
    if (prefix) syncReactionsJson(prefix);
    debouncedAvatar();
  });

  document.getElementById('av-scan-mics').addEventListener('click', async () => {
    const mics = await scanMics();
    if (!mics.length) return;
    fillMicSelect(document.getElementById('av-mic-a'), mics);
    fillMicSelect(document.getElementById('av-mic-b'), mics);
    showFb('av-fb', `マイク ${mics.length} 件を検出しました。`);
  });

  document.getElementById('av-scan-cameras')?.addEventListener('click', async () => {
    const cams = await scanCameras();
    if (!cams.length) return;
    fillCameraSelect(document.getElementById('av-camera'), cams);
    showFb('av-fb', `カメラ ${cams.length} 件を検出しました。`);
  });

  document.getElementById('av-face-track')?.addEventListener('change', () => {
    updateFaceTrackStatus();
    if (!document.getElementById('av-face-track')?.checked) {
      setFacePreviewVisible(false, { silent: true });
    }
    debouncedAvatar();
  });
  document.getElementById('av-face-assign-swap')?.addEventListener('change', () => debouncedAvatar());
  document.getElementById('av-camera')?.addEventListener('change', () => debouncedAvatar());

  document.getElementById('av-face-preview-toggle')?.addEventListener('click', async () => {
    const trackOn = !!document.getElementById('av-face-track')?.checked;
    if (!facePreviewVisible && !trackOn) {
      showFb('av-fb', '先に顔トラッキングを ON にしてください。', 'err');
      return;
    }
    await setFacePreviewVisible(!facePreviewVisible);
  });

  document.getElementById('av-face-calib')?.addEventListener('click', async () => {
    const on = !!document.getElementById('av-face-track')?.checked;
    if (!on) {
      showFb('av-fb', '先に顔トラッキングを ON にしてください。', 'err');
      return;
    }
    const r = await api.recalibrateAvatarFace?.().catch((e) => ({ success: false, error: e.message }));
    if (r?.success) {
      showFb('av-fb', '正面の記憶を開始しました。正面をキープしてください。');
      const el = document.getElementById('av-face-status');
      if (el) el.textContent = '顔トラッキング: 正面を記憶中… 正面をキープ';
      // プレビュー表示中なら「記憶中」を即描画（次フレーム待ちで旧表示が残るのを防ぐ）
      if (facePreviewVisible && !facePreviewPausedByWindow) {
        drawFacePreview({
          ...(lastFacePreview || {}),
          tracking: true,
          calibrating: true,
          p1: lastFacePreview?.p1 || {},
          p2: lastFacePreview?.p2 || {},
        });
      }
    } else {
      showFb('av-fb', '正面の記憶に失敗: ' + (r?.error || '不明'), 'err');
    }
  });

  window.addEventListener('beforeunload', () => {
    clearFacePreviewAutoOff();
    if (facePreviewVisible) {
      facePreviewVisible = false;
      try { api.setAvatarFacePreview?.(false); } catch (_) { /* */ }
    }
  });

  function closestActionButton(ev, selector) {
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    for (const node of path) {
      if (node instanceof Element && node.matches?.(selector)) return node;
    }
    return ev.target?.closest?.(selector) || null;
  }

  document.body.addEventListener('click', async (ev) => {
    const clearBtn = closestActionButton(ev, '.av-clear');
    if (clearBtn) {
      const fieldKey = clearBtn.dataset.targetF;
      if (fieldKey) {
        const el = document.querySelector(`[data-f="${fieldKey}"]`);
        if (el) {
          el.value = '';
          if (fieldKey) delete avConfigCache[fieldKey];
          persistAvatar({ clearedPathKeys: fieldKey ? [fieldKey] : [], force: true });
        }
      }
      return;
    }

    const btn = closestActionButton(ev, '.av-browse');
    if (!btn) {
      const reactBrowse = closestActionButton(ev, '.av-reaction-browse');
      if (reactBrowse) {
        const p = await api.openImageFileDialog();
        if (!p) return;
        const row = reactBrowse.closest('[data-reaction-row]');
        const pathEl = row?.querySelector('[data-reaction-k="path"]');
        const prefix = reactBrowse.dataset.reactionPrefix;
        if (pathEl) {
          pathEl.value = p;
          if (row) updateReactionThumb(row);
          if (prefix) syncReactionsJson(prefix);
          persistAvatar({ force: true });
        }
      }
      return;
    }
    const p = await api.openImageFileDialog();
    if (!p) return;
    const customPrefix = btn.dataset.targetCustomPath;
    if (customPrefix) {
      const row = btn.closest('[data-custom-row]');
      const pathEl = row?.querySelector('[data-custom-k="path"]');
      if (pathEl) {
        pathEl.value = p;
        window.avatarSettingsUI?.collectForm?.(customPrefix);
        persistAvatar({ force: true });
      }
      return;
    }
    const fieldKey = btn.dataset.targetF;
    if (fieldKey) {
      const el = document.querySelector(`[data-f="${fieldKey}"]`);
      if (el) {
        el.value = p;
        if (fieldKey) avConfigCache[fieldKey] = p;
        persistAvatar({ force: true });
      }
      return;
    }
    const target = btn.dataset.target;
    if (target) {
      const el = document.getElementById(target);
      if (el) {
        el.value = p;
        persistAvatar({ force: true });
      }
    }
  });

  document.getElementById('av-copy-url').addEventListener('click', () => {
    const url = readMdValue(document.getElementById('av-obs-url'));
    navigator.clipboard?.writeText(url).then(() => showFb('av-fb', 'URL をコピーしました。'));
  });
  document.getElementById('av-go-suite-obs')?.addEventListener('click', (e) => {
    e.preventDefault();
    scrollToSettingsSection('overlay', 'sec-setup-obs');
  });

  document.getElementById('av-open-preview').addEventListener('click', async () => {
    const r = await api.openAvatarPreview().catch((e) => ({ success: false, error: e.message }));
    if (r && r.success === false) {
      showFb('av-fb', 'プレビューを開けません: ' + (r.error || ''), 'err');
    }
  });
}
