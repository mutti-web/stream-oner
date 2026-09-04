/**
 * StreamONER CSS Editor — chat visual tokens
 * Keep in sync with youtube-overlay.html :root defaults.
 * version 2: Phase A badge tokens
 */
(function (global) {
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
  const TOKENS = [
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

  function defaultsMap() {
    const out = {};
    for (const t of TOKENS) out[t.cssVar] = t.default;
    return out;
  }

  function exportCss(values) {
    const lines = [
      '/* stream-oner-custom.css — generated by StreamONER CSS Editor */',
      '/* https://streamoner.mutti.xyz/css-editor/ */',
      ':root {',
    ];
    for (const t of TOKENS) {
      const raw = values[t.cssVar] != null ? values[t.cssVar] : t.default;
      let cssVal = String(raw);
      if (t.type === 'range' && t.unit && !/[a-z%]+$/i.test(cssVal)) {
        cssVal = `${cssVal}${t.unit}`;
      }
      lines.push(`  ${t.cssVar}: ${cssVal};`);
    }
    lines.push('}');
    lines.push('');
    return lines.join('\n');
  }

  global.StreamOnerCssSchema = {
    version: 2,
    scope: 'youtube-chat',
    tokens: TOKENS,
    fontPresets: FONT_PRESETS,
    paddingPresets: PADDING_PRESETS,
    defaultsMap,
    exportCss,
  };
})(typeof window !== 'undefined' ? window : globalThis);
