(function () {
  const schema = window.StreamOnerCssSchema;
  if (!schema?.scopes?.length) {
    console.error('StreamOnerCssSchema missing scopes');
    return;
  }

  const valuesByScope = schema.defaultsByScope();
  let activeScopeId = 'all';
  let builtinCatalog = [];

  const VIEW_TABS = [
    { id: 'all', label: '全て' },
    ...schema.scopes.map((s) => ({ id: s.id, label: s.label })),
  ];

  const LOCAL_PRESET_KEY = 'streamoner-css-editor-local-presets-v1';

  const controlsEl = document.getElementById('controls');
  const noteEl = document.getElementById('scope-note');
  const tabsEl = document.getElementById('scope-tabs');
  const previewShell = document.getElementById('preview-shell');
  const stageEl = document.getElementById('preview-stage');
  const presetSelect = document.getElementById('preset-select');
  const presetStatus = document.getElementById('preset-status');
  const btnDeleteLocal = document.getElementById('btn-preset-delete-local');

  const verEl = document.getElementById('schema-version');
  const fmtEl = document.getElementById('preset-format');
  if (verEl) verEl.textContent = String(schema.version);
  if (fmtEl) fmtEl.textContent = String(schema.presetFormat || 1);

  function isAllView() {
    return activeScopeId === 'all';
  }

  function activeScope() {
    if (isAllView()) {
      return {
        id: 'all',
        label: '全て',
        note: 'YouTube チャットと Discord VC の見た目をまとめて編集します。ダウンロード CSS には両方含まれます。',
        tokens: [],
      };
    }
    return schema.getScope(activeScopeId);
  }

  function scopeValues(scopeId) {
    return valuesByScope[scopeId];
  }

  function hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function parseRgba(str) {
    const m = String(str || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) return { r: 0, g: 0, b: 0, a: 0.75 };
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] != null ? Number(m[4]) : 1,
    };
  }

  function toHex(r, g, b) {
    const h = (n) => Number(n).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function previewRoot(scope) {
    return document.getElementById(scope.previewId);
  }

  function applyPreview(scopeId) {
    const scope = schema.getScope(scopeId || activeScopeId);
    const el = previewRoot(scope);
    if (!el) return;
    const vals = valuesByScope[scope.id];
    const byVar = Object.fromEntries(scope.tokens.map((t) => [t.cssVar, t]));
    for (const [k, v] of Object.entries(vals)) {
      const token = byVar[k];
      const cssVal = token && schema.formatTokenValue
        ? schema.formatTokenValue(token, v)
        : String(v);
      el.style.setProperty(k, cssVal);
    }
  }

  function applyAllPreviews() {
    for (const s of schema.scopes) applyPreview(s.id);
  }

  function setValue(scopeId, cssVar, value) {
    if (!valuesByScope[scopeId]) return;
    valuesByScope[scopeId][cssVar] = value;
    applyPreview(scopeId);
    refreshCssSnippet();
  }

  function refreshCssSnippet() {
    const out = document.getElementById('css-snippet-out');
    if (out) out.textContent = schema.exportCss(valuesByScope);
  }

  function syncPreviewTools() {
    document.querySelectorAll('.preview-tool-set').forEach((el) => {
      const forId = el.dataset.for;
      el.hidden = !(isAllView() || forId === activeScopeId);
    });
  }

  function syncPreviewVisibility() {
    for (const s of schema.scopes) {
      const wrap = document.getElementById(`${s.previewId}-wrap`)
        || document.getElementById(s.previewId);
      const show = isAllView() || activeScopeId === s.id;
      if (wrap) wrap.hidden = !show;
      const label = document.querySelector(`[data-preview-label="${s.id}"]`);
      if (label) label.hidden = !isAllView();
    }
  }

  function updateChatFilterSummary() {
    const summary = document.getElementById('chat-filter-summary');
    if (!summary) return;
    const boxes = [...document.querySelectorAll('[data-kind-filter]')];
    const total = boxes.length;
    const on = boxes.filter((cb) => cb.checked).length;
    summary.textContent = `${on}/${total}`;
  }

  function applyChatKindFilters() {
    const root = document.getElementById('chat-preview');
    if (!root) return;
    root.querySelectorAll('.chat-item[data-kind]').forEach((item) => {
      const kind = item.dataset.kind;
      const cb = document.querySelector(`[data-kind-filter="${kind}"]`);
      const show = !cb || cb.checked;
      item.hidden = !show;
      // 保険: hidden 属性以外でも確実に隠す
      item.style.display = show ? '' : 'none';
    });
    updateChatFilterSummary();
  }

  function setDiscordSpeaking(card, on) {
    if (!card) return;
    card.classList.toggle('speaking', on);
    card.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function applyDiscordSpeakingDemo() {
    const demo = document.getElementById('dc-speaking-demo');
    const card = document.querySelector('[data-demo-speaker]');
    if (!card) return;
    setDiscordSpeaking(card, !!(demo && demo.checked));
  }

  function bindPreviewExtras() {
    document.querySelectorAll('[data-kind-filter]').forEach((cb) => {
      cb.addEventListener('change', applyChatKindFilters);
    });

    const speakingDemo = document.getElementById('dc-speaking-demo');
    speakingDemo?.addEventListener('change', applyDiscordSpeakingDemo);

    document.querySelectorAll('#discord-preview .dc-card').forEach((card) => {
      const toggle = () => {
        const next = !card.classList.contains('speaking');
        setDiscordSpeaking(card, next);
        if (card.hasAttribute('data-demo-speaker')) {
          const demo = document.getElementById('dc-speaking-demo');
          if (demo) demo.checked = next;
        }
      };
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          toggle();
        }
      });
    });
  }

  function buildTabs() {
    if (!tabsEl) return;
    tabsEl.replaceChildren();
    for (const tab of VIEW_TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'scope-tab' + (tab.id === activeScopeId ? ' is-active' : '');
      btn.textContent = tab.label;
      btn.dataset.scope = tab.id;
      btn.addEventListener('click', () => setActiveScope(tab.id));
      tabsEl.appendChild(btn);
    }
  }

  function setActiveScope(id) {
    activeScopeId = id;
    buildTabs();
    syncPreviewVisibility();
    syncPreviewTools();
    syncControlsFromValues();
    updateOverlayScale();
  }

  function setPreviewMode(mode) {
    if (!previewShell) return;
    const next = mode || 'pc';
    previewShell.dataset.mode = next;
    previewShell.querySelector('.phone-bezel')?.setAttribute(
      'aria-hidden',
      next === 'pc' ? 'true' : 'false',
    );
    updateOverlayScale();
  }

  function updateOverlayScale() {
    if (!previewShell || !stageEl) return;
    if (!String(previewShell.dataset.mode || '').startsWith('phone')) {
      stageEl.style.removeProperty('--overlay-scale');
      return;
    }
    const player = previewShell.querySelector('.yt-player-inner');
    if (!player) return;
    // レイアウト確定後に計測（モード切替直後の clientWidth=0 を避ける）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const w = player.clientWidth;
        if (!w) return;
        // 映像枠幅 ÷ 1920（OBS 論理キャンバス）。高さは 16:9 前提
        stageEl.style.setProperty('--overlay-scale', String(w / 1920));
      });
    });
  }

  function bindPreviewMode() {
    document.querySelectorAll('input[name="preview-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) setPreviewMode(radio.value);
      });
    });
    const checked = document.querySelector('input[name="preview-mode"]:checked');
    setPreviewMode(checked?.value || 'pc');

    if (previewShell && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateOverlayScale());
      ro.observe(previewShell);
      const player = previewShell.querySelector('.yt-player-inner');
      if (player) ro.observe(player);
    }
    window.addEventListener('resize', updateOverlayScale);
  }

  function appendTokenControl(scope, t, values, parent) {
    const wrap = document.createElement('div');
    wrap.className = 'control';
    wrap.dataset.token = t.id;
    wrap.dataset.scope = scope.id;

    const lab = document.createElement('label');
    lab.className = 'main';
    lab.textContent = t.label;
    wrap.appendChild(lab);

    if (t.type === 'range') {
      const row = document.createElement('div');
      row.className = 'row';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(t.min);
      input.max = String(t.max);
      input.step = String(t.step);
      const num = parseFloat(String(values[t.cssVar]).replace(/px$/, '')) || t.default;
      input.value = String(num);
      const out = document.createElement('span');
      out.className = 'val';
      out.textContent = `${num}${t.unit || ''}`;
      input.addEventListener('input', () => {
        const v = `${input.value}${t.unit || ''}`;
        out.textContent = v;
        setValue(scope.id, t.cssVar, v);
      });
      row.append(input, out);
      wrap.appendChild(row);
    } else if (t.type === 'color') {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = String(values[t.cssVar] || t.default);
      input.addEventListener('input', () => setValue(scope.id, t.cssVar, input.value));
      wrap.appendChild(input);
    } else if (t.type === 'rgba') {
      const parsed = parseRgba(values[t.cssVar] || t.default);
      const row = document.createElement('div');
      row.className = 'row';
      const color = document.createElement('input');
      color.type = 'color';
      color.value = toHex(parsed.r, parsed.g, parsed.b);
      const alpha = document.createElement('input');
      alpha.type = 'range';
      alpha.min = '0';
      alpha.max = '1';
      alpha.step = '0.05';
      alpha.value = String(parsed.a);
      const out = document.createElement('span');
      out.className = 'val';
      const sync = () => {
        const rgb = hexToRgb(color.value);
        const a = Number(alpha.value);
        const css = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
        out.textContent = `${Math.round(a * 100)}%`;
        setValue(scope.id, t.cssVar, css);
      };
      color.addEventListener('input', sync);
      alpha.addEventListener('input', sync);
      out.textContent = `${Math.round(parsed.a * 100)}%`;
      row.append(color, alpha, out);
      wrap.appendChild(row);
    } else if (t.type === 'select') {
      const sel = document.createElement('select');
      for (const opt of t.options || []) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === values[t.cssVar]) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => setValue(scope.id, t.cssVar, sel.value));
      wrap.appendChild(sel);
    }

    if (t.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = t.hint;
      wrap.appendChild(hint);
    }

    (parent || controlsEl).appendChild(wrap);
  }

  function tokenGroups(scope) {
    const groups = [];
    let current = null;
    for (const t of scope.tokens) {
      const id = t.group || '_default';
      if (!current || current.id !== id) {
        current = {
          id,
          label: t.groupLabel || (id === '_default' ? '見た目' : id),
          tokens: [],
        };
        groups.push(current);
      }
      if (t.groupLabel) current.label = t.groupLabel;
      current.tokens.push(t);
    }
    return groups;
  }

  function appendGroupedControls(scope, parent, { openFirst = true } = {}) {
    const values = scopeValues(scope.id);
    const groups = tokenGroups(scope);
    groups.forEach((g, i) => {
      const details = document.createElement('details');
      details.className = 'control-details';
      if (openFirst && i === 0) details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = g.label;
      const body = document.createElement('div');
      body.className = 'control-details-body';
      details.append(summary, body);
      for (const t of g.tokens) appendTokenControl(scope, t, values, body);
      parent.appendChild(details);
    });
  }

  function buildControls() {
    const scope = activeScope();
    controlsEl.replaceChildren();
    if (noteEl) noteEl.textContent = scope.note || '';

    if (isAllView()) {
      schema.scopes.forEach((s, i) => {
        const details = document.createElement('details');
        details.className = 'control-details control-details--scope';
        if (i === 0) details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = s.label;
        const body = document.createElement('div');
        body.className = 'control-details-body';
        details.append(summary, body);
        appendGroupedControls(s, body, { openFirst: true });
        controlsEl.appendChild(details);
      });
      return;
    }

    appendGroupedControls(scope, controlsEl, { openFirst: true });
  }

  function syncControlsFromValues() {
    buildControls();
    applyAllPreviews();
    applyChatKindFilters();
    applyDiscordSpeakingDemo();
    refreshCssSnippet();
  }

  function setPresetStatus(msg, isErr) {
    if (!presetStatus) return;
    presetStatus.textContent = msg || '';
    presetStatus.classList.toggle('is-err', !!isErr);
  }

  function readLocalPresets() {
    try {
      const raw = localStorage.getItem(LOCAL_PRESET_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocalPresets(list) {
    localStorage.setItem(LOCAL_PRESET_KEY, JSON.stringify(list));
  }

  function refreshPresetSelect() {
    if (!presetSelect) return;
    const prev = presetSelect.value;
    presetSelect.replaceChildren();

    const gBuiltin = document.createElement('optgroup');
    gBuiltin.label = '組み込み';
    for (const p of builtinCatalog) {
      const o = document.createElement('option');
      o.value = `builtin:${p.id}`;
      o.textContent = p.label || p.id;
      gBuiltin.appendChild(o);
    }
    presetSelect.appendChild(gBuiltin);

    const locals = readLocalPresets();
    if (locals.length) {
      const gLocal = document.createElement('optgroup');
      gLocal.label = 'このブラウザに保存';
      for (const p of locals) {
        const o = document.createElement('option');
        o.value = `local:${p.id}`;
        o.textContent = p.label || p.id;
        gLocal.appendChild(o);
      }
      presetSelect.appendChild(gLocal);
    }

    if (prev && [...presetSelect.options].some((o) => o.value === prev)) {
      presetSelect.value = prev;
    }
    syncDeleteButton();
    syncStyleHint();
  }

  function syncDeleteButton() {
    if (!btnDeleteLocal || !presetSelect) return;
    btnDeleteLocal.hidden = !String(presetSelect.value || '').startsWith('local:');
  }

  function syncStyleHint() {
    const hint = document.getElementById('style-hint');
    if (!hint || !presetSelect) return;
    const val = presetSelect.value || '';
    let text = '';
    if (val.startsWith('builtin:')) {
      const id = val.slice('builtin:'.length);
      const found = builtinCatalog.find((p) => p.id === id);
      text = found?.description || '';
    } else if (val.startsWith('local:')) {
      const id = val.slice('local:'.length);
      const found = readLocalPresets().find((p) => p.id === id);
      text = found?.description || 'このブラウザに保存したスタイル';
    }
    hint.textContent = text;
    hint.hidden = !text;
  }

  function applyPresetObject(data) {
    const result = schema.applyPresetData(valuesByScope, data);
    if (!result.ok) {
      setPresetStatus(result.warnings.join(' / ') || '適用に失敗しました', true);
      return false;
    }
    syncControlsFromValues();
    const extra = result.warnings.length ? `（注意: ${result.warnings.join(' / ')}）` : '';
    setPresetStatus(`「${data.label || data.id || 'スタイル'}」を適用しました${extra}`);
    return true;
  }

  async function loadBuiltinPreset(id) {
    const res = await fetch(`./presets/${id}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error('preset load failed');
    return res.json();
  }

  async function applySelectedPreset() {
    const val = presetSelect?.value || '';
    if (!val) return;
    try {
      if (val.startsWith('builtin:')) {
        const id = val.slice('builtin:'.length);
        const data = await loadBuiltinPreset(id);
        applyPresetObject(data);
      } else if (val.startsWith('local:')) {
        const id = val.slice('local:'.length);
        const found = readLocalPresets().find((p) => p.id === id);
        if (!found) {
          setPresetStatus('保存したスタイルが見つかりません', true);
          return;
        }
        applyPresetObject(found);
      }
    } catch (e) {
      console.error(e);
      setPresetStatus('スタイルの読み込みに失敗しました', true);
    }
  }

  function saveLocalPreset() {
    const label = window.prompt('スタイル名', `マイスタイル ${new Date().toLocaleDateString('ja-JP')}`);
    if (!label) return;
    const id = `local-${Date.now().toString(36)}`;
    const data = schema.exportPresetData(valuesByScope, { id, label, description: 'ブラウザ保存' });
    const list = readLocalPresets();
    list.push(data);
    writeLocalPresets(list);
    refreshPresetSelect();
    presetSelect.value = `local:${id}`;
    syncDeleteButton();
    setPresetStatus(`「${label}」をこのブラウザに保存しました`);
  }

  function deleteSelectedLocalPreset() {
    const val = presetSelect?.value || '';
    if (!val.startsWith('local:')) return;
    const id = val.slice('local:'.length);
    const list = readLocalPresets().filter((p) => p.id !== id);
    writeLocalPresets(list);
    refreshPresetSelect();
    setPresetStatus('保存したスタイルを削除しました');
  }

  function exportPresetJson() {
    const data = schema.exportPresetData(valuesByScope, {
      id: 'custom-export',
      label: 'エクスポート',
      description: 'StreamONER CSS Editor',
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stream-oner-preset.json';
    a.click();
    URL.revokeObjectURL(url);
    setPresetStatus('スタイル JSON を書き出しました');
  }

  function importPresetJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ''));
        if (applyPresetObject(data)) {
          // optionally offer to save — skip
        }
      } catch (e) {
        console.error(e);
        setPresetStatus('JSON の解析に失敗しました', true);
      }
    };
    reader.readAsText(file);
  }

  async function initPresetCatalog() {
    try {
      const res = await fetch('./presets/index.json', { cache: 'no-store' });
      if (res.ok) {
        const catalog = await res.json();
        builtinCatalog = Array.isArray(catalog.presets) ? catalog.presets : [];
      }
    } catch (e) {
      console.error(e);
      builtinCatalog = [
        { id: 'sukkiri', label: 'すっきり' },
        { id: 'hakkiri', label: 'はっきり' },
        { id: 'attaka', label: 'あったか' },
        { id: 'kawaii', label: 'かわいい' },
        { id: 'simple', label: 'しんぷる' },
        { id: 'hinyari', label: 'ひんやり' },
      ];
    }
    refreshPresetSelect();
  }

  function downloadCss() {
    const css = schema.exportCss(valuesByScope);
    const blob = new Blob([css], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stream-oner-custom.css';
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetDefaults() {
    const fresh = schema.defaultsByScope();
    for (const id of Object.keys(valuesByScope)) {
      Object.assign(valuesByScope[id], fresh[id]);
    }
    syncControlsFromValues();
    setPresetStatus('既定値に戻しました');
  }

  document.getElementById('btn-download')?.addEventListener('click', downloadCss);
  document.getElementById('btn-reset')?.addEventListener('click', resetDefaults);
  document.getElementById('btn-preset-apply')?.addEventListener('click', () => {
    applySelectedPreset();
  });
  document.getElementById('btn-preset-save-local')?.addEventListener('click', saveLocalPreset);
  document.getElementById('btn-preset-export')?.addEventListener('click', exportPresetJson);
  document.getElementById('btn-preset-delete-local')?.addEventListener('click', deleteSelectedLocalPreset);
  presetSelect?.addEventListener('change', () => {
    syncDeleteButton();
    syncStyleHint();
  });

  const fileInput = document.getElementById('preset-file');
  document.getElementById('btn-preset-import')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) importPresetJson(file);
    fileInput.value = '';
  });

  bindPreviewMode();
  bindPreviewExtras();
  buildTabs();
  initPresetCatalog().then(() => setActiveScope(activeScopeId));
})();
