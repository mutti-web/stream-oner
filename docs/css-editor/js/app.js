(function () {
  const schema = window.StreamOnerCssSchema;
  if (!schema) {
    console.error('StreamOnerCssSchema missing');
    return;
  }

  const values = schema.defaultsMap();
  const controlsEl = document.getElementById('controls');
  const previewEl = document.getElementById('chat-preview');
  const phoneToggle = document.getElementById('phone-preview');
  const stageEl = document.getElementById('preview-stage');

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

  function applyPreview() {
    for (const [k, v] of Object.entries(values)) {
      previewEl.style.setProperty(k, v);
    }
  }

  function setValue(cssVar, value) {
    values[cssVar] = value;
    applyPreview();
  }

  function buildControls() {
    controlsEl.replaceChildren();
    let lastGroup = null;
    for (const t of schema.tokens) {
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
    applyPreview();
  }

  async function loadPreset(name) {
    const res = await fetch(`./presets/${name}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error('preset load failed');
    const data = await res.json();
    Object.assign(values, schema.defaultsMap(), data.values || {});
    syncControlsFromValues();
  }

  function downloadCss() {
    const css = schema.exportCss(values);
    const blob = new Blob([css], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stream-oner-custom.css';
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetDefaults() {
    Object.assign(values, schema.defaultsMap());
    syncControlsFromValues();
  }

  phoneToggle?.addEventListener('change', () => {
    stageEl.classList.toggle('is-phone', !!phoneToggle.checked);
  });

  document.getElementById('btn-download')?.addEventListener('click', downloadCss);
  document.getElementById('btn-reset')?.addEventListener('click', resetDefaults);
  document.getElementById('btn-preset-mobile')?.addEventListener('click', () => {
    loadPreset('mobile-readable').catch((e) => {
      console.error(e);
      alert('プリセットの読み込みに失敗しました');
    });
  });

  syncControlsFromValues();
})();
