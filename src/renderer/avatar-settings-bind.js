'use strict';

/**
 * 配信者A / B 個別のレイヤー・動き設定フォームを Material Web で動的生成する。
 *
 * `data-f="<prefix>_<key>"` で flat な avatar 設定キーと一意に紐づけ、
 * settings.html 側の collect / fill が単純な走査で動くようにしている。
 *
 * - md-switch（チェックボックス） … `.checked` は ui-helpers の shim 経由
 * - md-outlined-text-field … `.value` を直接読み書き
 * - md-outlined-button.av-browse … クリックでファイル選択（settings.html 側のイベント委譲）
 */

(function () {
  const ASSETS = [
    ['body', '身体'],
    ['face', '顔'],
    ['nose', '鼻'],
    ['hair1', '髪1'],
    ['hair2', '髪2'],
    ['eyes-normal', '目・通常'],
    ['eyes-smile', '目・笑い'],
    ['eyes-blink', '目・まばたき'],
    ['eyes-pupil', '目・瞳（LookAt用）'],
    ['mouth-closed', '口・閉じ'],
    ['mouth-open', '口・開き'],
    ['mouth-smile', '口・笑い'],
    ['mouth-a', '口・あ'],
    ['mouth-i', '口・い'],
    ['mouth-u', '口・う'],
    ['mouth-e', '口・え'],
    ['mouth-o', '口・お'],
  ];
  const CUSTOM_PARENTS = [
    ['body', '身体'], ['face', '顔'], ['hair1', '髪1'], ['hair2', '髪2'],
    ['eyes', '目'], ['mouth', '口'], ['nose', '鼻'], ['attach', '目口鼻グループ'], ['rig', '体全体'],
  ];
  const LAYERS = ['body', 'face', 'hair1', 'hair2', 'eyes', 'mouth', 'nose'];
  const LAYER_LABEL = {
    body: '身体', face: '顔', hair1: '髪1', hair2: '髪2', eyes: '目', mouth: '口', nose: '鼻',
  };

  const pathKey = (asset) => asset.replace(/-/g, '_');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fieldRow({ label, control, desc }) {
    return (
      '<div class="app-field">' +
        '<div class="app-label">' + esc(label) + '</div>' +
        (desc ? '<div class="app-desc">' + esc(desc) + '</div>' : '') +
        control +
      '</div>'
    );
  }

  function toggleField(prefix, key, label, desc) {
    return (
      '<div class="app-field app-field-row">' +
        '<div>' +
          '<div class="app-label">' + esc(label) + '</div>' +
          (desc ? '<div class="app-desc">' + esc(desc) + '</div>' : '') +
        '</div>' +
        '<div class="app-toggle-controls">' +
          '<md-switch data-f="' + prefix + '_' + key + '" icons show-only-selected-icon></md-switch>' +
        '</div>' +
      '</div>'
    );
  }

  function numberField(prefix, key, label, attrs) {
    const a = Object.entries(attrs || {})
      .map(([k, v]) => `${k}="${esc(v)}"`)
      .join(' ');
    return (
      '<md-outlined-text-field class="full-width" type="number" label="' + esc(label) + '" data-f="' +
      prefix + '_' + key + '" ' + a + '></md-outlined-text-field>'
    );
  }

  function pathField(prefix, key, label) {
    return (
      '<div class="app-field">' +
        '<div class="app-label">' + esc(label) + ' PNG</div>' +
        '<div class="url-row">' +
          '<md-outlined-text-field readonly data-f="' + prefix + '_path_' + key +
          '" placeholder="パス..." class="app-grow"></md-outlined-text-field>' +
          '<md-outlined-button class="av-browse" data-target-f="' + prefix + '_path_' + key +
          '">参照</md-outlined-button>' +
          '<md-text-button class="av-clear" data-target-f="' + prefix + '_path_' + key +
          '" style="--md-text-button-label-text-color: var(--md-sys-color-error);">クリア</md-text-button>' +
        '</div>' +
      '</div>'
    );
  }

  const DEFAULT_LAYER_Z = (window.AvatarConstants && window.AvatarConstants.DEFAULT_LAYER_Z) ||
    { body: 10, hair1: 20, eyes: 30, mouth: 40, hair2: 50 };

  function layerSection(prefix, ln) {
    const label = LAYER_LABEL[ln];
    const defZ = DEFAULT_LAYER_Z[ln] ?? 30;
    const desc = ln === 'nose'
      ? '描画順（既定 42）。鼻の揺れは「顔」レイヤーの自動ゆらぎに追従します（鼻ではゆらぎ項目は使いません）'
      : ln === 'hair2'
        ? '髪2 は髪1 の次。目・口より z を大きくすると前髪が手前に出ます'
        : '描画順（小さいほど奥）。顔は身体より大きく設定すると手前に表示されます';
    const sineBlock = ln === 'nose'
      ? '<div class="app-desc">「体の動きに遅れて付く」をオンにすると、目・口と同様に身体の動きに付きます。</div>' +
        '<label class="app-row app-row-compact app-toggle-inline">' +
          '<span class="app-toggle-name">体の動きに遅れて付く</span>' +
          '<md-switch data-f="' + prefix + '_' + ln + '_drag" icons show-only-selected-icon></md-switch>' +
        '</label>'
      : '<div class="app-grid-2">' +
          numberField(prefix, ln + '_sine_amp', 'ゆらぎの大きさ', { step: '0.1', min: 0 }) +
          numberField(prefix, ln + '_sine_period', 'ゆらぎの速さ（ms）', { step: 50, min: 0 }) +
        '</div>' +
        '<div class="app-row app-row-wide">' +
          '<label class="app-row app-row-compact app-toggle-inline">' +
            '<span class="app-toggle-name">自動でゆらす</span>' +
            '<md-switch data-f="' + prefix + '_' + ln + '_sine_on" icons show-only-selected-icon></md-switch>' +
          '</label>' +
          '<label class="app-row app-row-compact app-toggle-inline">' +
            '<span class="app-toggle-name">体の動きに遅れて付く</span>' +
            '<md-switch data-f="' + prefix + '_' + ln + '_drag" icons show-only-selected-icon></md-switch>' +
          '</label>' +
        '</div>';
    return (
      '<div class="app-field">' +
        '<div class="app-label">' + esc(label) + ' — オフセット' + (ln === 'nose' ? ' / 追従' : ' / ゆらぎ') + '</div>' +
        '<div class="app-desc">' + esc(desc) + '</div>' +
        '<div class="app-grid-2">' +
          numberField(prefix, ln + '_ox', 'オフセット X', { step: 1 }) +
          numberField(prefix, ln + '_oy', 'オフセット Y', { step: 1 }) +
        '</div>' +
        '<div class="app-field-group">' +
          numberField(prefix, ln + '_z', '描画順（z-index）', { step: 1, min: 0, max: 99, value: defZ }) +
        '</div>' +
        sineBlock +
      '</div>'
    );
  }

  function subsectionTitle(text) {
    return '<div class="app-subsection-title">' + esc(text) + '</div>';
  }

  function layerBlock(prefix, title) {
    const head = '<div class="app-section-title">' + esc(title) + ' — レイヤー・動き</div>';

    let body = '<div class="app-card">';
    body += '<details class="av-adv-details" open>';
    body += '<summary>画像設定</summary>';
    body += '<div class="app-stack-md">';
    for (const [akey, alabel] of ASSETS) {
      body += pathField(prefix, pathKey(akey), alabel);
    }
    body += '</div></details>';

    body += '<details class="av-adv-details">';
    body += '<summary>表示設定</summary>';
    body += '<div class="app-stack-md">';
    body += fieldRow({
      label: 'スロット位置',
      desc: 'キャラクター全体（ラベル含む）をまとめて移動。OBS パネルの幅・高さに対する % です（パネルサイズが変わっても比率を維持）。レイヤーごとのオフセット（px）とは別です',
      control:
        '<div class="app-grid-2">' +
          numberField(prefix, 'slot_ox', '横（%）', { step: 0.5, min: -100, max: 100, value: 0 }) +
          numberField(prefix, 'slot_oy', '縦（%）', { step: 0.5, min: -100, max: 100, value: 0 }) +
        '</div>',
    });
    body += fieldRow({
      label: '表示の反転',
      desc: 'アバター全体を中心基準で反転',
      control:
        '<div class="app-row app-row-wide">' +
          '<label class="app-row app-row-compact app-toggle-inline">' +
            '<span class="app-toggle-name">水平反転</span>' +
            '<md-switch data-f="' + prefix + '_flipX" icons show-only-selected-icon></md-switch>' +
          '</label>' +
          '<label class="app-row app-row-compact app-toggle-inline">' +
            '<span class="app-toggle-name">垂直反転</span>' +
            '<md-switch data-f="' + prefix + '_flipY" icons show-only-selected-icon></md-switch>' +
          '</label>' +
        '</div>',
    });
    for (const ln of LAYERS) {
      body += layerSection(prefix, ln);
    }
    body += fieldRow({
      label: '無音時の透明度（%）',
      desc: '喋っていない・笑っていないときの不透明度。0 で完全に非表示、100 で常に表示',
      control:
        numberField(prefix, 'silentOpacity', '透明度', { step: 1, min: 0, max: 100, value: 100 }),
    });
    body += fieldRow({
      label: '追従と口の動き',
      desc: '「ついてくる速さ」は大きいほど早く身体に付きます（小さいほどゆっくり）。「喋り時の口の膨らみ」は声に合わせて口が少し大きく見えます',
      control:
        '<div class="app-grid-2">' +
          numberField(prefix, 'dragLag',        'ついてくる速さ',     { step: '0.05', min: '0.05', max: '0.95' }) +
          numberField(prefix, 'jiggleStrength', '喋り時の口の膨らみ', { step: '0.01', min: 0, max: 1, value: '0.08' }) +
        '</div>',
    });
    body += fieldRow({
      label: 'まばたき間隔',
      desc: '三角分布で自然な間隔になります（最小〜最大の範囲内で中央付近に寄ります）',
      control:
        '<div class="app-grid-2">' +
          numberField(prefix, 'blinkMinSec', 'まばたき最小（秒）', { step: '0.1', min: 0 }) +
          numberField(prefix, 'blinkMaxSec', 'まばたき最大（秒）', { step: '0.1', min: 0 }) +
        '</div>',
    });
    body += toggleField(prefix, 'lookAtEnabled', 'LookAt（瞳追従）', 'eyes-pupil PNG があるとき、ゆっくり視線を動かします');
    body += fieldRow({
      label: '瞳の移動幅（px）',
      control: numberField(prefix, 'pupilOffsetMax', '最大オフセット', { step: 1, min: 1, max: 16, value: 4 }),
    });
    body += fieldRow({
      label: 'リグ種別（Pixi）',
      desc: 'human=部位差のあるパララックス / integrated=一体感寄り（差を抑える）',
      control:
        '<md-outlined-select class="full-width" data-f="' + prefix + '_rigType" label="リグ種別">' +
          '<md-select-option value="human"><div slot="headline">human（部位パララックス）</div></md-select-option>' +
          '<md-select-option value="integrated"><div slot="headline">integrated（一体感）</div></md-select-option>' +
        '</md-outlined-select>',
    });
    body += fieldRow({
      label: '髪の揺れ（Pixi）',
      desc: '顔の動き・声に対する髪スプリング。0 で追従のみ、大きいほど余韻が残ります',
      control: numberField(prefix, 'hairSpringStrength', 'スプリング強さ', { step: '0.05', min: 0, max: 1, value: '0.55' }),
    });
    body += '</div></details>';

    body += '<details class="av-adv-details">';
    body += '<summary>カスタム部位</summary>';
    body += '<div class="app-stack-md" data-custom-layers-wrap="' + prefix + '">';
    body += '<div class="app-desc">基本部位の子として追加され、親の動きに追従します。PNG を指定して部位を増やせます。</div>';
    body += '<div data-custom-layers-list="' + prefix + '"></div>';
    body += '<md-outlined-button type="button" data-custom-add="' + prefix + '">部位を追加</md-outlined-button>';
    body += '<input type="hidden" data-f="' + prefix + '_custom_layers_json" value="[]" />';
    body += '</div></details>';
    body += '</div>';

    return head + body;
  }

  function syncCustomLayersJson(prefix) {
    const list = document.querySelector('[data-custom-layers-list="' + prefix + '"]');
    const hidden = document.querySelector('[data-f="' + prefix + '_custom_layers_json"]');
    if (!list || !hidden) return;
    const rows = list.querySelectorAll('[data-custom-row]');
    const layers = [];
    rows.forEach((row) => {
      const read = (k) => {
        const el = row.querySelector('[data-custom-k="' + k + '"]');
        if (!el) return '';
        if (el.tagName === 'MD-SWITCH') return !!el.checked;
        return window.appUI?.readMdFieldValue?.(el) ?? el.value ?? '';
      };
      layers.push({
        id: row.dataset.customId || ('cl-' + Date.now().toString(36)),
        name: String(read('name') || 'カスタム'),
        parentAnchor: String(read('parent') || 'body'),
        path: String(read('path') || '').trim(),
        offsetX: Number(read('ox')) || 0,
        offsetY: Number(read('oy')) || 0,
        scale: Number(read('scale')) || 1,
        zIndex: Number(read('z')) || 45,
      });
    });
    hidden.value = JSON.stringify(layers);
  }

  function customLayerRow(prefix, layer) {
    const id = layer?.id || ('cl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    const parentOpts = CUSTOM_PARENTS.map(([v, label]) =>
      '<md-select-option value="' + v + '"' + (layer?.parentAnchor === v ? ' selected' : '') +
      '><div slot="headline">' + esc(label) + '</div></md-select-option>'
    ).join('');
    return (
      '<div class="app-inset-block av-custom-layer-row app-stack-sm" data-custom-row data-custom-id="' + esc(id) + '">' +
        '<div class="app-grid-2">' +
          '<md-outlined-text-field label="名前" data-custom-k="name" value="' + esc(layer?.name || 'カスタム') + '"></md-outlined-text-field>' +
          '<md-outlined-select label="親部位" data-custom-k="parent">' + parentOpts + '</md-outlined-select>' +
        '</div>' +
        '<div class="url-row">' +
          '<md-outlined-text-field readonly data-custom-k="path" placeholder="PNG パス..." class="app-grow" value="' + esc(layer?.path || '') + '"></md-outlined-text-field>' +
          '<md-outlined-button class="av-browse" data-target-custom-path="' + prefix + '">参照</md-outlined-button>' +
        '</div>' +
        '<div class="app-grid-2">' +
          '<md-outlined-text-field type="number" label="横オフセット" data-custom-k="ox" value="' + (layer?.offsetX ?? 0) + '"></md-outlined-text-field>' +
          '<md-outlined-text-field type="number" label="縦オフセット" data-custom-k="oy" value="' + (layer?.offsetY ?? 0) + '"></md-outlined-text-field>' +
          '<md-outlined-text-field type="number" label="拡大率" data-custom-k="scale" step="0.05" min="0.1" max="4" value="' + (layer?.scale ?? 1) + '"></md-outlined-text-field>' +
          '<md-outlined-text-field type="number" label="z-index" data-custom-k="z" value="' + (layer?.zIndex ?? 45) + '"></md-outlined-text-field>' +
        '</div>' +
        '<md-text-button type="button" data-custom-remove style="--md-text-button-label-text-color: var(--md-sys-color-error);">削除</md-text-button>' +
      '</div>'
    );
  }

  function renderCustomLayers(prefix, layers) {
    const list = document.querySelector('[data-custom-layers-list="' + prefix + '"]');
    if (!list) return;
    const arr = Array.isArray(layers) ? layers : [];
    list.innerHTML = arr.map((l) => customLayerRow(prefix, l)).join('');
    syncCustomLayersJson(prefix);
  }

  function bindCustomLayerEvents() {
    document.body.addEventListener('click', (e) => {
      const addBtn = e.target.closest('[data-custom-add]');
      if (addBtn) {
        const prefix = addBtn.getAttribute('data-custom-add');
        const list = document.querySelector('[data-custom-layers-list="' + prefix + '"]');
        if (!list) return;
        list.insertAdjacentHTML('beforeend', customLayerRow(prefix, { parentAnchor: 'hair1' }));
        syncCustomLayersJson(prefix);
        return;
      }
      const rm = e.target.closest('[data-custom-remove]');
      if (rm) {
        const row = rm.closest('[data-custom-row]');
        const wrap = row?.closest('[data-custom-layers-wrap]');
        row?.remove();
        if (wrap) syncCustomLayersJson(wrap.getAttribute('data-custom-layers-wrap'));
      }
    });
    document.body.addEventListener('change', (e) => {
      const row = e.target.closest('[data-custom-row]');
      if (!row) return;
      const wrap = row.closest('[data-custom-layers-wrap]');
      if (wrap) syncCustomLayersJson(wrap.getAttribute('data-custom-layers-wrap'));
    });
    document.body.addEventListener('input', (e) => {
      const row = e.target.closest('[data-custom-row]');
      if (!row) return;
      const wrap = row.closest('[data-custom-layers-wrap]');
      if (wrap) syncCustomLayersJson(wrap.getAttribute('data-custom-layers-wrap'));
    });
  }

  function getDisplayNames() {
    const readV = (el) => window.appUI?.readMdFieldValue?.(el) ?? el?.value ?? '';
    const p1 = readV(document.getElementById('av-p1-label')).trim() || '配信者A';
    const p2 = readV(document.getElementById('av-p2-label')).trim() || '配信者B';
    return { p1, p2 };
  }

  function patchAdvSwitches(root) {
    if (window.appUI?.patchAllSwitches && root) {
      window.appUI.patchAllSwitches(root);
    }
  }

  function buildForms() {
    const { p1, p2 } = getDisplayNames();
    const m1 = document.getElementById('av-adv-p1');
    const m2 = document.getElementById('av-adv-p2');
    if (m1) {
      m1.innerHTML = layerBlock('p1', `${p1}（1人目）`);
      patchAdvSwitches(m1);
    }
    if (m2) {
      m2.innerHTML = layerBlock('p2', `${p2}（2人目）`);
      patchAdvSwitches(m2);
    }
  }

  /** 起動直後・アバタータブ表示時に空パネルを防ぐ */
  function ensureBuilt() {
    const m1 = document.getElementById('av-adv-p1');
    const m2 = document.getElementById('av-adv-p2');
    if (!m1?.innerHTML.trim() || !m2?.innerHTML.trim()) {
      buildForms();
    }
  }

  /** 表示名変更時 — 見出しだけ更新（フォーム内容は維持） */
  function rebuildLayerTitles(p1Name, p2Name) {
    const p1 = p1Name || getDisplayNames().p1;
    const p2 = p2Name || getDisplayNames().p2;
    const h1 = document.querySelector('#av-adv-p1 .app-section-title');
    const h2 = document.querySelector('#av-adv-p2 .app-section-title');
    const suffix = ' — レイヤー・動き';
    if (h1) h1.textContent = `${p1}（1人目）${suffix}`;
    else {
      const m1 = document.getElementById('av-adv-p1');
      if (m1 && !m1.innerHTML.trim()) {
        m1.innerHTML = layerBlock('p1', `${p1}（1人目）`);
        patchAdvSwitches(m1);
      }
    }
    if (h2) h2.textContent = `${p2}（2人目）${suffix}`;
    else {
      const m2 = document.getElementById('av-adv-p2');
      if (m2 && !m2.innerHTML.trim()) {
        m2.innerHTML = layerBlock('p2', `${p2}（2人目）`);
        patchAdvSwitches(m2);
      }
    }
  }

  function isSwitch(el) {
    return el && el.tagName === 'MD-SWITCH';
  }

  function fillForm(prefix, flat) {
    document.querySelectorAll('[data-f^="' + prefix + '_"]').forEach((el) => {
      const key = el.getAttribute('data-f');
      if (flat[key] === undefined) return;
      if (isSwitch(el)) {
        el.checked = !!flat[key];
      } else {
        if (typeof setMdFieldValue === 'function') setMdFieldValue(el, flat[key]);
        else el.value = flat[key];
      }
    });
    const jsonKey = prefix + '_custom_layers_json';
    if (flat[jsonKey] !== undefined) {
      try {
        renderCustomLayers(prefix, JSON.parse(String(flat[jsonKey] || '[]')));
      } catch (_) {
        renderCustomLayers(prefix, []);
      }
    }
  }

  function readFieldValue(el) {
    if (isSwitch(el)) return !!el.checked;
    if (window.appUI?.readMdFieldValue) return window.appUI.readMdFieldValue(el);
    return el.value;
  }

  function isFieldVisible(el) {
    if (!el || !el.isConnected) return false;
    let node = el;
    while (node && node !== document.body) {
      if (node.hidden) return false;
      if (node.tagName === 'DETAILS' && !node.open) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      node = node.parentElement;
    }
    return true;
  }

  function collectForm(prefix) {
    syncCustomLayersJson(prefix);
    const data = {};
    document.querySelectorAll('[data-f^="' + prefix + '_"]').forEach((el) => {
      if (!isFieldVisible(el)) return;
      data[el.getAttribute('data-f')] = readFieldValue(el);
    });
    return data;
  }

  window.avatarSettingsUI = {
    buildForms,
    ensureBuilt,
    rebuildLayerTitles,
    fillForm,
    collectForm,
    collectAll() {
      return Object.assign({}, collectForm('p1'), collectForm('p2'));
    },
    fillAll(cfg) {
      if (cfg) {
        fillForm('p1', cfg);
        fillForm('p2', cfg);
      }
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureBuilt();
      bindCustomLayerEvents();
    });
  } else {
    ensureBuilt();
    bindCustomLayerEvents();
  }
})();
