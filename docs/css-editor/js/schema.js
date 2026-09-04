/**
 * StreamONER CSS Editor — visual tokens
 * YouTube: youtube-overlay.html :root
 * Discord: discord-overlay.css (export scoped to #user-list)
 * version 3: Phase B Discord scope / Phase D preset format
 */
(function (global) {
  const SCHEMA_VERSION = 3;
  const PRESET_FORMAT = 1;

  const FONT_PRESETS = [
    {
      id: 'system',
      label: 'システム（既定）',
      value: "'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Meiryo', sans-serif",
    },
    {
      id: 'noto',
      label: 'Noto Sans JP',
      value: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', sans-serif",
    },
    {
      id: 'rounded',
      label: '丸ゴシック寄り',
      value: "'Hiragino Maru Gothic ProN', 'M PLUS Rounded 1c', 'Yu Gothic UI', sans-serif",
    },
  ];

  const PADDING_PRESETS = [
    { id: 'compact', label: 'コンパクト', value: '4px 8px' },
    { id: 'default', label: '標準', value: '6px 10px' },
    { id: 'roomy', label: '広め', value: '10px 14px' },
  ];

  const BADGE_PADDING_PRESETS = [
    { id: 'tight', label: '小さめ', value: '1px 4px' },
    { id: 'default', label: '標準', value: '1px 5px' },
    { id: 'roomy', label: '広め', value: '2px 8px' },
  ];

  const BADGE_SIZE_PRESETS = [
    { id: 'small', label: '小さめ', value: '0.55em' },
    { id: 'default', label: '標準', value: '0.65em' },
    { id: 'large', label: '大きめ', value: '0.8em' },
  ];

  /** @type {Array<object>} */
  const YOUTUBE_TOKENS = [
    {
      id: 'font-size',
      cssVar: '--font-size',
      group: 'chat',
      groupLabel: 'チャット基本',
      label: '文字サイズ',
      type: 'range',
      unit: 'px',
      min: 12,
      max: 36,
      step: 1,
      default: 14,
      hint: 'スマホ視聴メインなら 22〜26px が読みやすい目安です',
    },
    {
      id: 'font-family',
      cssVar: '--font-family',
      group: 'chat',
      label: 'フォント',
      type: 'select',
      options: FONT_PRESETS,
      default: FONT_PRESETS[0].value,
    },
    {
      id: 'bg-color',
      cssVar: '--bg-color',
      group: 'chat',
      label: '吹き出し背景',
      type: 'rgba',
      defaultHex: '#000000',
      defaultAlpha: 0.75,
      default: 'rgba(0, 0, 0, 0.75)',
    },
    {
      id: 'text-color',
      cssVar: '--text-color',
      group: 'chat',
      label: '本文色',
      type: 'color',
      default: '#f0f0f0',
    },
    {
      id: 'username-color',
      cssVar: '--username-color',
      group: 'chat',
      label: 'ユーザー名色',
      type: 'color',
      default: '#7dd3fc',
    },
    {
      id: 'superchat-color',
      cssVar: '--superchat-color',
      group: 'chat',
      label: 'スパチャ色',
      type: 'color',
      default: '#fbbf24',
    },
    {
      id: 'border-radius',
      cssVar: '--border-radius',
      group: 'chat',
      label: '角丸',
      type: 'range',
      unit: 'px',
      min: 0,
      max: 24,
      step: 1,
      default: 8,
    },
    {
      id: 'padding',
      cssVar: '--padding',
      group: 'chat',
      label: '内余白',
      type: 'select',
      options: PADDING_PRESETS,
      default: PADDING_PRESETS[1].value,
    },
    {
      id: 'avatar-size',
      cssVar: '--avatar-size',
      group: 'chat',
      label: 'アイコンサイズ',
      type: 'range',
      unit: 'px',
      min: 16,
      max: 40,
      step: 1,
      default: 22,
    },
    {
      id: 'owner-color',
      cssVar: '--owner-color',
      group: 'badge',
      groupLabel: 'バッジ',
      label: '配信者バッジ色',
      type: 'color',
      default: '#f87171',
    },
    {
      id: 'moderator-color',
      cssVar: '--moderator-color',
      group: 'badge',
      label: 'モデレーターバッジ色',
      type: 'color',
      default: '#86efac',
    },
    {
      id: 'member-color',
      cssVar: '--member-color',
      group: 'badge',
      label: 'メンバーバッジ色',
      type: 'color',
      default: '#818cf8',
      hint: 'メンバーシップ入場バナーにも使います',
    },
    {
      id: 'first-color',
      cssVar: '--first-color',
      group: 'badge',
      label: '初見バッジ色',
      type: 'color',
      default: '#10b981',
      hint: '文言は Suite チャットタブで変更',
    },
    {
      id: 'regular-color',
      cssVar: '--regular-color',
      group: 'badge',
      label: '常連バッジ色',
      type: 'color',
      default: '#f59e0b',
      hint: '文言・判定回数は Suite チャットタブで変更',
    },
    {
      id: 'badge-font-size',
      cssVar: '--badge-font-size',
      group: 'badge',
      label: 'バッジ文字サイズ',
      type: 'select',
      options: BADGE_SIZE_PRESETS,
      default: BADGE_SIZE_PRESETS[1].value,
    },
    {
      id: 'badge-padding',
      cssVar: '--badge-padding',
      group: 'badge',
      label: 'バッジ余白',
      type: 'select',
      options: BADGE_PADDING_PRESETS,
      default: BADGE_PADDING_PRESETS[1].value,
    },
    {
      id: 'badge-radius',
      cssVar: '--badge-radius',
      group: 'badge',
      label: 'バッジ角丸',
      type: 'range',
      unit: 'px',
      min: 0,
      max: 12,
      step: 1,
      default: 4,
    },
    {
      id: 'badge-text-dark',
      cssVar: '--badge-text-dark',
      group: 'badge',
      label: 'バッジ文字（暗）',
      type: 'color',
      default: '#1a1a1a',
      hint: '配信者・モデ・メンバー・常連など明るい背景向け',
    },
    {
      id: 'badge-text-light',
      cssVar: '--badge-text-light',
      group: 'badge',
      label: 'バッジ文字（明）',
      type: 'color',
      default: '#ffffff',
      hint: '初見など暗い背景向け',
    },
  ];

  const DISCORD_FONT_PRESETS = [
    {
      id: 'system',
      label: 'システム（既定）',
      value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    {
      id: 'segoe',
      label: 'Segoe UI / 日本語',
      value: "'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', sans-serif",
    },
  ];

  /** Keep in sync with discord-overlay.css :root */
  const DISCORD_TOKENS = [
    {
      id: 'speaking-color',
      cssVar: '--speaking-color',
      label: '発話ハイライト色',
      type: 'color',
      default: '#23a55a',
    },
    {
      id: 'speaking-glow',
      cssVar: '--speaking-glow',
      label: '発話グロー',
      type: 'rgba',
      default: 'rgba(35, 165, 90, 0.35)',
    },
    {
      id: 'overlay-bg',
      cssVar: '--overlay-bg',
      label: 'カード背景',
      type: 'rgba',
      default: 'rgba(18, 18, 24, 0.85)',
    },
    {
      id: 'text-normal',
      cssVar: '--text-normal',
      label: '名前色（通常）',
      type: 'rgba',
      default: 'rgba(255, 255, 255, 0.75)',
    },
    {
      id: 'text-speaking',
      cssVar: '--text-speaking',
      label: '名前色（発話）',
      type: 'color',
      default: '#ffffff',
    },
    {
      id: 'name-bg',
      cssVar: '--name-bg',
      label: '名前背景（通常）',
      type: 'rgba',
      default: 'rgba(0, 0, 0, 0.45)',
    },
    {
      id: 'name-bg-speaking',
      cssVar: '--name-bg-speaking',
      label: '名前背景（発話）',
      type: 'rgba',
      default: 'rgba(35, 165, 90, 0.25)',
    },
    {
      id: 'avatar-size',
      cssVar: '--avatar-size',
      label: 'アバターサイズ',
      type: 'range',
      unit: 'px',
      min: 24,
      max: 72,
      step: 2,
      default: 40,
      hint: 'チャット側の --avatar-size と衝突しないよう #user-list スコープで出力します',
    },
    {
      id: 'font',
      cssVar: '--font',
      label: 'フォント',
      type: 'select',
      options: DISCORD_FONT_PRESETS,
      default: DISCORD_FONT_PRESETS[0].value,
    },
    {
      id: 'name-font-size',
      cssVar: '--name-font-size',
      label: '名前サイズ',
      type: 'range',
      unit: 'px',
      min: 11,
      max: 22,
      step: 1,
      default: 14,
    },
    {
      id: 'radius',
      cssVar: '--radius',
      label: 'カード角丸',
      type: 'range',
      unit: 'px',
      min: 0,
      max: 24,
      step: 1,
      default: 12,
    },
    {
      id: 'name-radius',
      cssVar: '--name-radius',
      label: '名前角丸',
      type: 'range',
      unit: 'px',
      min: 0,
      max: 16,
      step: 1,
      default: 6,
    },
    {
      id: 'list-gap',
      cssVar: '--list-gap',
      label: 'カード間隔',
      type: 'range',
      unit: 'px',
      min: 0,
      max: 16,
      step: 1,
      default: 4,
    },
  ];

  const SCOPES = [
    {
      id: 'youtube',
      label: 'YouTube チャット',
      selector: ':root',
      tokens: YOUTUBE_TOKENS,
      previewId: 'chat-preview',
      note: '位置・幅・件数・バッジ文言は Suite 本体で調整します。',
    },
    {
      id: 'discord',
      label: 'Discord VC',
      selector: '#user-list',
      tokens: DISCORD_TOKENS,
      previewId: 'discord-preview',
      note: 'メンバー枠・発話色など。位置・サイズは Suite レイアウトタブのまま。',
    },
  ];

  function formatTokenValue(t, raw) {
    let cssVal = String(raw != null ? raw : t.default);
    if (t.type === 'range' && t.unit && !/[a-z%]+$/i.test(cssVal)) {
      cssVal = `${cssVal}${t.unit}`;
    }
    return cssVal;
  }

  function tokenDefaults(tokens) {
    const out = {};
    // range 既定値は単位付きで保持（単位なしだと width: var(--avatar-size) が無効になり SVG が巨大化する）
    for (const t of tokens) out[t.cssVar] = formatTokenValue(t, t.default);
    return out;
  }

  function defaultsByScope() {
    const out = {};
    for (const s of SCOPES) out[s.id] = tokenDefaults(s.tokens);
    return out;
  }

  /** @deprecated use defaultsByScope — flat map of youtube only for old callers */
  function defaultsMap() {
    return tokenDefaults(YOUTUBE_TOKENS);
  }

  function exportCss(valuesByScope) {
    const lines = [
      '/* stream-oner-custom.css — generated by StreamONER CSS Editor */',
      '/* https://streamoner.mutti.xyz/css-editor/ */',
      `/* schemaVersion: ${SCHEMA_VERSION} */`,
      '',
    ];
    for (const s of SCOPES) {
      const vals = (valuesByScope && valuesByScope[s.id]) || tokenDefaults(s.tokens);
      lines.push(`/* ${s.label} */`);
      lines.push(`${s.selector} {`);
      for (const t of s.tokens) {
        lines.push(`  ${t.cssVar}: ${formatTokenValue(t, vals[t.cssVar])};`);
      }
      lines.push('}');
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * Apply preset JSON into valuesByScope (mutates).
   * Supports format 1 ({ scopes }) and legacy ({ values } → youtube).
   * Unknown tokens are ignored. Returns { ok, warnings }.
   */
  function applyPresetData(valuesByScope, data) {
    const warnings = [];
    if (!data || typeof data !== 'object') {
      return { ok: false, warnings: ['無効なプリセットです'] };
    }
    if (data.schemaVersion != null && Number(data.schemaVersion) > SCHEMA_VERSION) {
      warnings.push(`プリセットの schemaVersion (${data.schemaVersion}) がエディタ (${SCHEMA_VERSION}) より新しいです`);
    }

    const pickKnown = (scopeId, src) => {
      const scope = getScope(scopeId);
      if (!scope || !src || typeof src !== 'object') return;
      const known = new Set(scope.tokens.map((t) => t.cssVar));
      for (const [k, v] of Object.entries(src)) {
        if (known.has(k)) valuesByScope[scopeId][k] = v;
        else warnings.push(`未知の変数をスキップ: ${k}`);
      }
    };

    if (data.scopes && typeof data.scopes === 'object') {
      for (const sid of Object.keys(data.scopes)) {
        if (!valuesByScope[sid]) {
          warnings.push(`未知のスコープをスキップ: ${sid}`);
          continue;
        }
        pickKnown(sid, data.scopes[sid]);
      }
    } else if (data.values && typeof data.values === 'object') {
      pickKnown('youtube', data.values);
      warnings.push('旧形式（values）を YouTube スコープとして読み込みました');
    } else {
      return { ok: false, warnings: ['scopes / values がありません'] };
    }
    return { ok: true, warnings };
  }

  function exportPresetData(valuesByScope, meta) {
    const scopes = {};
    for (const s of SCOPES) {
      scopes[s.id] = { ...(valuesByScope[s.id] || tokenDefaults(s.tokens)) };
    }
    return {
      format: PRESET_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      id: (meta && meta.id) || 'custom',
      label: (meta && meta.label) || 'カスタム',
      description: (meta && meta.description) || '',
      scopes,
    };
  }

  function getScope(id) {
    return SCOPES.find((s) => s.id === id) || SCOPES[0];
  }

  global.StreamOnerCssSchema = {
    version: SCHEMA_VERSION,
    presetFormat: PRESET_FORMAT,
    scopes: SCOPES,
    tokens: YOUTUBE_TOKENS,
    fontPresets: FONT_PRESETS,
    paddingPresets: PADDING_PRESETS,
    defaultsMap,
    defaultsByScope,
    formatTokenValue,
    exportCss,
    exportPresetData,
    applyPresetData,
    getScope,
  };
})(typeof window !== 'undefined' ? window : globalThis);
