'use strict';

/**
 * アバター描画・音声検出で揃えるタイミングと z-index 既定値。
 * main の avatar-slot-config.js と値を一致させること。
 */
(function (global) {
  const DEFAULT_LAYER_Z = {
    body: 10,
    face: 15,
    hair1: 20,
    eyes: 30,
    mouth: 40,
    nose: 42,
    hair2: 50,
  };

  /**
   * RMS → 0–100 換算の基準ゲイン（感度倍率と掛ける）。
   * コンデンサ+AIF など入力が小さい環境でも既定感度で VU が読めるようやや高め。
   * 機材差の微調整は各スロットの「感度倍率」(0.5–5) で行う。
   */
  const RMS_LEVEL_GAIN = 1000;

  /**
   * VU / 口パク前のノイズフロア。
   * level < max(発話閾値 × この比率, NOISE_FLOOR_MIN) なら 0。
   * 閾値そのものに揃えると調整用 VU が見えなくなるため、半分弱にする。
   */
  const NOISE_FLOOR_RATIO = 0.4;
  const NOISE_FLOOR_MIN = 3;

  /** Sine 振幅 1px あたりの回転（rad）。大きいと横揺れっぽく見える */
  const SINE_ROT_PER_AMP = 0.006;

  global.AvatarConstants = {
    DEFAULT_LAYER_Z,
    LAUGH_HOLD_MS: 2800,
    SPEAK_HOLD_MS: 600,
    /** 発話 OFF 判定は ON 閾値 × この比率（ヒステリシス） */
    SPEAK_OFF_RATIO: 0.72,
    JIGGLE_HOLD_MS: 400,
    /** main → OBS への audio WS/IPC の最小送信間隔（ms） */
    AUDIO_SEND_MIN_INTERVAL_MS: 50,
    /** この差未満のレベル変化は「変化なし」とみなす（0–100） */
    AUDIO_LEVEL_DELTA: 2,
    /** OBS が非表示扱いのときの描画間隔（Page Visibility 対策） */
    OBS_HIDDEN_TICK_MS: 50,
    /** 旧 px → % 換算の参照パネルサイズ（統合レイアウト既定と一致） */
    SLOT_REF_W: 960,
    SLOT_REF_H: 420,
    /** 音量上昇時の Lerp 係数（口の開き） */
    LEVEL_LERP_OPEN: 0.38,
    /** 音量下降時の Lerp 係数（口の閉じ） */
    LEVEL_LERP_CLOSE: 0.14,
    RMS_LEVEL_GAIN,
    NOISE_FLOOR_RATIO,
    NOISE_FLOOR_MIN,
    SINE_ROT_PER_AMP,
    DEFAULT_JIGGLE_STRENGTH: 0.08,
  };
})(typeof window !== 'undefined' ? window : global);
