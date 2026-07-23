'use strict';

/**
 * 設定・ダッシュボードの M3 テーマ。
 * - 明るさ: system | light | dark
 * - アクセント: default(青) | neutral | green | yellow | red | pink（プリセットのみ）
 */
(function (global) {
  const VALID_THEME = new Set(['system', 'light', 'dark']);
  const VALID_ACCENT = new Set(['default', 'neutral', 'green', 'yellow', 'red', 'pink']);

  const SYS_COLOR_KEYS = [
    'primary', 'on-primary', 'primary-container', 'on-primary-container', 'inverse-primary',
    'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
    'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
    'error', 'on-error', 'error-container', 'on-error-container',
    'background', 'on-background', 'surface', 'on-surface',
    'surface-variant', 'on-surface-variant',
    'surface-container-lowest', 'surface-container-low', 'surface-container',
    'surface-container-high', 'surface-container-highest',
    'outline', 'outline-variant',
    'inverse-surface', 'inverse-on-surface',
    'shadow', 'scrim', 'surface-tint',
  ];

  const SURFACE_LIGHT = {
    error: '#BA1A1A',
    'on-error': '#FFFFFF',
    'error-container': '#FFDAD6',
    'on-error-container': '#93000A',
    background: '#FFFBFF',
    'on-background': '#1C1B1F',
    surface: '#FFFBFF',
    'on-surface': '#1C1B1F',
    'surface-variant': '#E5E1EC',
    'on-surface-variant': '#47464F',
    'surface-container-lowest': '#FFFFFF',
    'surface-container-low': '#F5F2FA',
    'surface-container': '#EFECF4',
    'surface-container-high': '#E9E6EE',
    'surface-container-highest': '#E3E0E8',
    outline: '#787680',
    'outline-variant': '#C8C5D0',
    'inverse-surface': '#303034',
    'inverse-on-surface': '#F4EFF7',
    shadow: '#000000',
    scrim: '#000000',
  };

  const SURFACE_DARK = {
    error: '#FFB4AB',
    'on-error': '#690005',
    'error-container': '#93000A',
    'on-error-container': '#FFDAD6',
    background: '#131316',
    'on-background': '#E5E1E9',
    surface: '#131316',
    'on-surface': '#E5E1E9',
    'surface-variant': '#46464F',
    'on-surface-variant': '#C7C5D0',
    'surface-container-lowest': '#0E0E11',
    'surface-container-low': '#1B1B1F',
    'surface-container': '#1F1F23',
    'surface-container-high': '#2A2A2F',
    'surface-container-highest': '#35353A',
    outline: '#908F99',
    'outline-variant': '#46464F',
    'inverse-surface': '#E5E1E9',
    'inverse-on-surface': '#303034',
    shadow: '#000000',
    scrim: '#000000',
  };

  /** @type {Record<string, { light: object, dark: object }>} */
  const ACCENT = {
    default: {
      light: {
        primary: '#0061A4',
        'on-primary': '#FFFFFF',
        'primary-container': '#D1E4FF',
        'on-primary-container': '#001D36',
        'inverse-primary': '#9ECAFF',
        secondary: '#535F70',
        'on-secondary': '#FFFFFF',
        'secondary-container': '#D7E3F7',
        'on-secondary-container': '#101C2B',
        tertiary: '#6B5778',
        'on-tertiary': '#FFFFFF',
        'tertiary-container': '#F2DAFF',
        'on-tertiary-container': '#251431',
        'surface-tint': '#0061A4',
      },
      dark: {
        primary: '#9ECAFF',
        'on-primary': '#003258',
        'primary-container': '#00497D',
        'on-primary-container': '#D1E4FF',
        'inverse-primary': '#0061A4',
        secondary: '#BBC7DB',
        'on-secondary': '#253140',
        'secondary-container': '#3B4858',
        'on-secondary-container': '#D7E3F7',
        tertiary: '#D6BEE4',
        'on-tertiary': '#3B2948',
        'tertiary-container': '#523F5F',
        'on-tertiary-container': '#F2DAFF',
        'surface-tint': '#9ECAFF',
      },
    },
    neutral: {
      light: {
        primary: '#5E5E62',
        'on-primary': '#FFFFFF',
        'primary-container': '#E4E2E6',
        'on-primary-container': '#1B1B1F',
        'inverse-primary': '#C7C6CA',
        secondary: '#5E5E62',
        'on-secondary': '#FFFFFF',
        'secondary-container': '#E4E2E6',
        'on-secondary-container': '#1B1B1F',
        tertiary: '#5D5E62',
        'on-tertiary': '#FFFFFF',
        'tertiary-container': '#E3E2E6',
        'on-tertiary-container': '#1A1C20',
        'surface-tint': '#5E5E62',
      },
      dark: {
        primary: '#C7C6CA',
        'on-primary': '#303034',
        'primary-container': '#46464A',
        'on-primary-container': '#E4E2E6',
        'inverse-primary': '#5E5E62',
        secondary: '#C7C6CA',
        'on-secondary': '#303034',
        'secondary-container': '#46464A',
        'on-secondary-container': '#E4E2E6',
        tertiary: '#C7C6CA',
        'on-tertiary': '#303034',
        'tertiary-container': '#46464A',
        'on-tertiary-container': '#E3E2E6',
        'surface-tint': '#C7C6CA',
      },
    },
    green: {
      light: {
        primary: '#386A20',
        'on-primary': '#FFFFFF',
        'primary-container': '#B7F397',
        'on-primary-container': '#042100',
        'inverse-primary': '#9CD67D',
        secondary: '#55624C',
        'on-secondary': '#FFFFFF',
        'secondary-container': '#D8E7CB',
        'on-secondary-container': '#131F0C',
        tertiary: '#386666',
        'on-tertiary': '#FFFFFF',
        'tertiary-container': '#BBEBEB',
        'on-tertiary-container': '#002020',
        'surface-tint': '#386A20',
      },
      dark: {
        primary: '#9CD67D',
        'on-primary': '#0B3900',
        'primary-container': '#275106',
        'on-primary-container': '#B7F397',
        'inverse-primary': '#386A20',
        secondary: '#BBCBB3',
        'on-secondary': '#263422',
        'secondary-container': '#3C4B37',
        'on-secondary-container': '#D8E7CB',
        tertiary: '#A0CFCF',
        'on-tertiary': '#003738',
        'tertiary-container': '#1E4E4E',
        'on-tertiary-container': '#BBEBEB',
        'surface-tint': '#9CD67D',
      },
    },
    yellow: {
      light: {
        primary: '#6D5E00',
        'on-primary': '#FFFFFF',
        'primary-container': '#FFE264',
        'on-primary-container': '#221B00',
        'inverse-primary': '#E2C000',
        secondary: '#655E40',
        'on-secondary': '#FFFFFF',
        'secondary-container': '#EBE2BC',
        'on-secondary-container': '#201B02',
        tertiary: '#43664E',
        'on-tertiary': '#FFFFFF',
        'tertiary-container': '#C5ECCC',
        'on-tertiary-container': '#00210F',
        'surface-tint': '#6D5E00',
      },
      dark: {
        primary: '#E2C000',
        'on-primary': '#3A3000',
        'primary-container': '#544500',
        'on-primary-container': '#FFE264',
        'inverse-primary': '#6D5E00',
        secondary: '#CEC6A5',
        'on-secondary': '#353018',
        'secondary-container': '#4C472B',
        'on-secondary-container': '#EBE2BC',
        tertiary: '#A9D0B3',
        'on-tertiary': '#143523',
        'tertiary-container': '#2B4C38',
        'on-tertiary-container': '#C5ECCC',
        'surface-tint': '#E2C000',
      },
    },
    red: {
      light: {
        primary: '#BA1A1A',
        'on-primary': '#FFFFFF',
        'primary-container': '#FFDAD6',
        'on-primary-container': '#410002',
        'inverse-primary': '#FFB4AB',
        secondary: '#775653',
        'on-secondary': '#FFFFFF',
        'secondary-container': '#FFDAD6',
        'on-secondary-container': '#2C1513',
        tertiary: '#715B2E',
        'on-tertiary': '#FFFFFF',
        'tertiary-container': '#FDE0A8',
        'on-tertiary-container': '#251A00',
        'surface-tint': '#BA1A1A',
      },
      dark: {
        primary: '#FFB4AB',
        'on-primary': '#690005',
        'primary-container': '#93000A',
        'on-primary-container': '#FFDAD6',
        'inverse-primary': '#BA1A1A',
        secondary: '#E7BDB8',
        'on-secondary': '#442925',
        'secondary-container': '#5D3F3C',
        'on-secondary-container': '#FFDAD6',
        tertiary: '#E0C38C',
        'on-tertiary': '#3F2E04',
        'tertiary-container': '#574419',
        'on-tertiary-container': '#FDE0A8',
        'surface-tint': '#FFB4AB',
      },
    },
    pink: {
      light: {
        primary: '#984061',
        'on-primary': '#FFFFFF',
        'primary-container': '#FFD9E2',
        'on-primary-container': '#3E001D',
        'inverse-primary': '#FFB1C8',
        secondary: '#74565F',
        'on-secondary': '#FFFFFF',
        'secondary-container': '#FFD9E2',
        'on-secondary-container': '#2B151C',
        tertiary: '#7C5635',
        'on-tertiary': '#FFFFFF',
        'tertiary-container': '#FFDCC1',
        'on-tertiary-container': '#2E1500',
        'surface-tint': '#984061',
      },
      dark: {
        primary: '#FFB1C8',
        'on-primary': '#5E1133',
        'primary-container': '#7B2949',
        'on-primary-container': '#FFD9E2',
        'inverse-primary': '#984061',
        secondary: '#E3BDC6',
        'on-secondary': '#422931',
        'secondary-container': '#5A3F47',
        'on-secondary-container': '#FFD9E2',
        tertiary: '#EFBD94',
        'on-tertiary': '#432B08',
        'tertiary-container': '#5C411C',
        'on-tertiary-container': '#FFDCC1',
        'surface-tint': '#FFB1C8',
      },
    },
  };

  let systemMq = null;
  let systemMqHandler = null;
  let lastPref = 'system';
  let lastAccent = 'default';

  function normalizeTheme(pref) {
    return VALID_THEME.has(pref) ? pref : 'system';
  }

  function normalizeAccent(accent) {
    return VALID_ACCENT.has(accent) ? accent : 'default';
  }

  function osPrefersLight() {
    return global.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
  }

  /** @returns {'light'|'dark'} */
  function resolveScheme(pref) {
    const p = normalizeTheme(pref);
    if (p === 'light') return 'light';
    if (p === 'dark') return 'dark';
    return osPrefersLight() ? 'light' : 'dark';
  }

  function buildTokens(scheme, accentName) {
    const accent = normalizeAccent(accentName);
    const base = scheme === 'light' ? SURFACE_LIGHT : SURFACE_DARK;
    const chroma = ACCENT[accent][scheme];
    return Object.assign({}, base, chroma);
  }

  function applySysColors(scheme, accentName) {
    const tokens = buildTokens(scheme, accentName);
    const root = document.documentElement;
    const body = document.body;
    for (const key of SYS_COLOR_KEYS) {
      const prop = `--md-sys-color-${key}`;
      const value = tokens[key];
      root.style.setProperty(prop, value);
      if (body) body.style.setProperty(prop, value);
    }
    root.style.colorScheme = scheme;
    if (body) body.style.colorScheme = scheme;
  }

  function detachSystemListener() {
    if (systemMq && systemMqHandler) {
      systemMq.removeEventListener('change', systemMqHandler);
    }
    systemMq = null;
    systemMqHandler = null;
  }

  function attachSystemListener() {
    detachSystemListener();
    if (!global.matchMedia) return;
    systemMq = global.matchMedia('(prefers-color-scheme: light)');
    systemMqHandler = () => {
      if (normalizeTheme(lastPref) === 'system') {
        applySysColors(resolveScheme('system'), lastAccent);
      }
    };
    systemMq.addEventListener('change', systemMqHandler);
  }

  /**
   * @param {string | { themePreference?: string, accentPreset?: string }} input
   */
  function apply(input) {
    let pref = lastPref;
    let accent = lastAccent;
    if (typeof input === 'string') {
      pref = normalizeTheme(input);
    } else if (input && typeof input === 'object') {
      if (input.themePreference !== undefined) pref = normalizeTheme(input.themePreference);
      if (input.accentPreset !== undefined) accent = normalizeAccent(input.accentPreset);
    }
    lastPref = pref;
    lastAccent = accent;
    const root = document.documentElement;
    root.dataset.theme = pref;
    root.dataset.accent = accent;
    applySysColors(resolveScheme(pref), accent);
    if (pref === 'system') attachSystemListener();
    else detachSystemListener();
  }

  global.AppTheme = {
    apply,
    normalize: normalizeTheme,
    normalizeAccent,
    resolveScheme,
    VALID: VALID_THEME,
    VALID_ACCENT,
    ACCENT_IDS: [...VALID_ACCENT],
  };

  if (typeof document !== 'undefined') {
    const boot = () => apply({
      themePreference: document.documentElement.dataset.theme || 'system',
      accentPreset: document.documentElement.dataset.accent || 'default',
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }
})(typeof window !== 'undefined' ? window : global);
