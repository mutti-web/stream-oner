(function () {
  const schema = window.StreamOnerCssSchema;
  if (!schema?.scopes?.length) {
    console.error('StreamOnerCssSchema missing scopes');
    return;
  }

  const valuesByScope = schema.defaultsByScope();
  let activeScopeId = schema.scopes[0].id;

  const controlsEl = document.getElementById('controls');
  const noteEl = document.getElementById('scope-note');
  const tabsEl = document.getElementById('scope-tabs');
  const phoneToggle = document.getElementById('phone-preview');
  const stageEl = document.getElementById('preview-stage');
  const btnPreset = document.getElementById('btn-preset-mobile');

  function activeScope() {
    return schema.getScope(activeScopeId);
  }

  function activeValues() {
    return valuesByScope[activeScopeId];
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
    for (const [k, v] of Object.entries(vals)) {
      el.style.setProperty(k, v);
    }
  }

  function applyAllPreviews() {
    for (const s of schema.scopes) applyPreview(s.id);
  }

  function setValue(cssVar, value) {
    activeValues()[cssVar] = value;
    applyPreview(activeScopeId);
  }

  function buildTabs() {
    if (!tabsEl) return;
    tabsEl.replaceChildren();
    for (const s of schema.scopes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'scope-tab' + (s.id === activeScopeId ? ' is-active' : '');
      btn.textContent = s.label;
      btn.dataset.scope = s.id;
      btn.addEventListener('click', () => setActiveScope(s.id));
      tabsEl.appendChild(btn);
    }
  }

  function setActiveScope(id) {
    activeScopeId = id;
    buildTabs();
    for (const s of schema.scopes) {
      const el = previewRoot(s);
      if (el) el.hidden = s.id !== id;
    }
    if (btnPreset) {
      btnPreset.hidden = id !== 'youtube';
    }
    const btnDiscordPreset = document.getElementById('btn-preset-discord');
    if (btnDiscordPreset) {
      btnDiscordPreset.hidden = id !== 'discord';
    }
    if (phoneToggle) {
      const wrap = phoneToggle.closest('label');
      if (wrap) wrap.hidden = id !== 'youtube';
      if (id !== 'youtube') {
        phoneToggle.checked = false;
        stageEl?.classList.remove('is-phone');
      }
    }
    syncControlsFromValues();
  }

  function buildControls() {
    const scope = activeScope();
    const values = activeValues();
    controlsEl.replaceChildren();
    if (noteEl) noteEl.textContent = scope.note || '';

    let lastGroup = null;
    for (const t of scope.tokens) {
      if (t.group && t.group !== lastGroup) {
        lastGroup = t.group;
        const h = document.createElement('h3');
        h.className = 'control-group';
        h.textContent = t.groupLabel || t.group;
        controlsEl.appendChild(h);
      }

      const wrap = document.createElement('div');
      wrap.className = 'control';
      wrap.dataset.token = t.id;

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
          setValue(t.cssVar, v);
        });
        row.append(input, out);
        wrap.appendChild(row);
      } else if (t.type === 'color') {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = String(values[t.cssVar] || t.default);
        input.addEventListener('input', () => setValue(t.cssVar, input.value));
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
          setValue(t.cssVar, css);
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
        sel.addEventListener('change', () => setValue(t.cssVar, sel.value));
        wrap.appendChild(sel);
      }

      if (t.hint) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = t.hint;
        wrap.appendChild(hint);
      }

      controlsEl.appendChild(wrap);
    }
  }

  function syncControlsFromValues() {
    buildControls();
    applyAllPreviews();
  }

  async function loadPreset(name) {
    const res = await fetch(`./presets/${name}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error('preset load failed');
    const data = await res.json();
    if (data.scopes) {
      for (const [sid, vals] of Object.entries(data.scopes)) {
        if (valuesByScope[sid]) Object.assign(valuesByScope[sid], vals);
      }
    } else if (data.values) {
      Object.assign(valuesByScope.youtube, data.values);
    }
    syncControlsFromValues();
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
  }

  phoneToggle?.addEventListener('change', () => {
    stageEl.classList.toggle('is-phone', !!phoneToggle.checked);
  });

  document.getElementById('btn-download')?.addEventListener('click', downloadCss);
  document.getElementById('btn-reset')?.addEventListener('click', resetDefaults);
  btnPreset?.addEventListener('click', () => {
    loadPreset('mobile-readable').catch((e) => {
      console.error(e);
      alert('プリセットの読み込みに失敗しました');
    });
  });
  document.getElementById('btn-preset-discord')?.addEventListener('click', () => {
    loadPreset('discord-calm').catch((e) => {
      console.error(e);
      alert('プリセットの読み込みに失敗しました');
    });
  });

  buildTabs();
  setActiveScope(activeScopeId);
})();
