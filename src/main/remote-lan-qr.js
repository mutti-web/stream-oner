'use strict';

/**
 * LAN URL の QR 生成。
 * 1) npm の qrcode（あれば）
 * 2) src 同梱の vendor（node_modules 無しでも動く）
 */

let lastError = '';

function isRenderableRemoteUrl(url) {
  const s = String(url || '').trim();
  return !!s && s !== '—' && !s.includes('検出できません') && /^https?:\/\//i.test(s);
}

function getLastQrError() {
  return lastError;
}

function tryNpmQrcode() {
  try {
    return require('qrcode');
  } catch (e) {
    lastError = `qrcode パッケージ: ${e.message}`;
    return null;
  }
}

function tryVendoredSvg(url) {
  const QRCode = require('./vendor/qrcode-lib/core/qrcode');
  const SvgRenderer = require('./vendor/qrcode-lib/renderer/svg');
  const qrData = QRCode.create(String(url).trim(), { errorCorrectionLevel: 'M' });
  const svg = SvgRenderer.render(qrData, { width: 176, margin: 1 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * @param {string|null|undefined} url
 * @returns {Promise<string>} data URL（失敗時は空文字）
 */
async function remoteLanQrDataUrl(url) {
  lastError = '';
  if (!isRenderableRemoteUrl(url)) {
    lastError = 'QR 用 URL が無効です';
    return '';
  }
  const text = String(url).trim();

  const npmQr = tryNpmQrcode();
  if (npmQr?.toDataURL) {
    try {
      return await npmQr.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 176,
      });
    } catch (e) {
      console.warn('[Remote] qrcode.toDataURL 失敗、vendor にフォールバック:', e.message);
      lastError = e.message;
    }
  } else if (npmQr?.toString) {
    try {
      const svg = await npmQr.toString(text, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 176,
      });
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch (e) {
      console.warn('[Remote] qrcode.toString 失敗、vendor にフォールバック:', e.message);
      lastError = e.message;
    }
  }

  try {
    const dataUrl = tryVendoredSvg(text);
    lastError = '';
    return dataUrl;
  } catch (e) {
    console.warn('[Remote] vendor QR 失敗:', e.message);
    lastError = lastError || e.message || 'QR 生成に失敗しました';
    return '';
  }
}

module.exports = {
  remoteLanQrDataUrl,
  isRenderableRemoteUrl,
  getLastQrError,
};
