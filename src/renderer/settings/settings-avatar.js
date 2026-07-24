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
  return payload;
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
    return;
  }
  if (st?.faceError) {
    el.textContent = `顔トラッキング: エラー — ${st.faceError}`;
    return;
  }
  el.textContent = st?.faceRunning ? '顔トラッキング: 稼働中' : '顔トラッキング: 待機中';
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
  setMdFieldValue(
    document.getElementById('av-obs-url-pixi'),
    (cfg.obsUrlPixi || 'http://127.0.0.1:3003/overlay-pixi') + '?hud=0',
  );

  if (window.avatarSettingsUI) {
    window.avatarSettingsUI.ensureBuilt();
    window.avatarSettingsUI.fillAll(cfg);
  }
  updateAvatarLabelUi();
  applyAvDisplayModeUi();

  const mics = await scanMics();
  fillMicSelect(document.getElementById('av-mic-a'), mics, cfg.micADeviceId);
  fillMicSelect(document.getElementById('av-mic-b'), mics, cfg.micBDeviceId);

  const cams = await scanCameras().catch(() => []);
  fillCameraSelect(document.getElementById('av-camera'), cams, cfg.cameraDeviceId || '');

  const st = await api.getAvatarStatus().catch(() => ({ serverRunning: false }));
  setAvBadge(st);
  updateFaceTrackStatus(st);
  suppressAutoSave--;
  avatarFormsHydrated = true;
}

function bindAvatarActions() {
  document.getElementById('av-display-mode')?.addEventListener('change', () => {
    applyAvDisplayModeUi();
    debouncedAvatar();
  });
  const debouncedLabelUi = debounce(updateAvatarLabelUi, 300);
  document.getElementById('av-p1-label')?.addEventListener('input', debouncedLabelUi);
  document.getElementById('av-p2-label')?.addEventListener('input', debouncedLabelUi);

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
    debouncedAvatar();
  });
  document.getElementById('av-face-assign-swap')?.addEventListener('change', () => debouncedAvatar());
  document.getElementById('av-camera')?.addEventListener('change', () => debouncedAvatar());

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
    if (!btn) return;
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
  document.getElementById('av-copy-url-pixi')?.addEventListener('click', () => {
    const url = readMdValue(document.getElementById('av-obs-url-pixi'));
    navigator.clipboard?.writeText(url).then(() => showFb('av-fb', 'Pixi URL をコピーしました。'));
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
