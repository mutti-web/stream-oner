/**
 * preload.js - メインプロセスとレンダラープロセスの安全な橋渡し
 *
 * 設計原則:
 * - contextIsolation: true の環境で動作
 * - contextBridge.exposeInMainWorld() で厳格にAPIを公開
 * - Node.js APIをレンダラーに直接露出しない（セキュリティ）
 * - 許可された操作のみをホワイトリスト方式で公開
 *
 * レンダラーからは window.electronAPI.XXX() でアクセスする
 */

const { contextBridge, ipcRenderer } = require("electron");

// ============================================================
// 許可するIPCチャンネルのホワイトリスト
// ============================================================

/** レンダラー → メインへのリクエスト（invoke = 双方向, send = 一方向）*/
const ALLOWED_INVOKE_CHANNELS = [
  "get-settings",
  "save-settings",
  "open-css-file-dialog",
  "load-css-file",
  "toggle-click-through",
  "toggle-position-lock",
  "reconnect-rpc",
  "clear-discord-oauth",
  "get-rpc-status",
  // YouTube OAuth
  "get-youtube-oauth-status",
  "start-youtube-oauth",
  "clear-youtube-oauth",
  "cancel-youtube-oauth",
  "set-youtube-oauth-nudge-dismissed",
  "resolve-youtube-live-broadcasts",
  "prepare-yt-chat-start",
  "confirm-yt-chat-start",
  // YouTube チャット
  "get-yt-config",
  "save-yt-config",
  "start-yt-poller",
  "stop-yt-poller",
  "get-yt-status",
  "pin-yt-message",
  "unpin-yt-message",
  "get-yt-pinned",
  "get-yt-session-participants",
  "get-yt-viewer-detail",
  "clear-yt-session",
  "get-session-log-status",
  "get-last-session-log",
  "start-session-log",
  "end-session-log",
  "mark-session-highlight",
  "add-yt-ng-user",
  "add-yt-ng-word",
  "get-suite-features",
  "save-suite-features",
  "get-broadcast-timer",
  "get-avatar-config",
  "save-avatar-config",
  "get-avatar-status",
  "open-avatar-preview",
  "open-image-file-dialog",
  "open-dashboard-window",
  "open-settings-window",
  "obs-connect",
  "obs-disconnect",
  "obs-get-status",
  "obs-list-audio-inputs",
  "obs-list-scenes",
  "obs-set-current-scene",
  "obs-set-mute",
  "obs-get-config",
  "obs-save-config",
  "obs-detect-suite-source",
  "save-obs-event-actions",
  "test-obs-event-action",
  "open-rehearsal-preview",
  "remote-get-config",
  "remote-list-sessions",
  "remote-revoke-session",
  "remote-regenerate-pin",
  "remote-restart-server",
  "export-settings-dialog",
  "import-settings-dialog",
  "get-suite-presets",
  "save-suite-preset",
  "apply-suite-preset",
  "delete-suite-preset",
  "rename-suite-preset",
];

/** メイン → レンダラーへのイベント（on = 受信専用）*/
const ALLOWED_RECEIVE_CHANNELS = [
  "rpc-status-changed",     // RPC接続状態の変化
  "voice-state-update",     // 入退出・ミュート変更
  "speaking-update",        // 発話開始/停止
  "channel-update",         // チャンネル切り替え
  "click-through-changed",  // クリック透過状態の変化
  "position-lock-changed",  // 位置ロック状態の変化
  "yt-status-changed",      // YouTubeポーラー状態の変化
  "yt-message",             // YouTubeチャットメッセージ
  "yt-pin-changed",         // ピン留め状態の変化
  "yt-membership",          // メンバーシップ系システムメッセージ
  "yt-session-changed",     // 参加者一覧の更新
  "session-log-changed",    // セッションログ記録状態
  "session-log-ended",      // セッション終了（ハイライト一覧）
  "remote-action",          // リモート操作の actor 通知（トースト）
  "avatar-status-changed",  // アバターサーバー・音声キャプチャ状態
  "avatar-config-changed",  // アバターラベル等（ダッシュボード表示同期）
  "avatar-audio-levels",    // マイク音量（設定画面の VU メーター用）
  "navigate-settings-tab",  // 設定ウィンドウのタブ切替
  "focus-suite-layout-panel", // リハーサル → レイアウト設定へフォーカス
  "suite-layout-changed",   // リハーサルドラッグ → 設定フォーム同期
  "suite-features-changed", // 配信表示 ON/OFF（設定⇔ダッシュボード⇔リモート同期）
  "theme-preference-changed", // テーマ（設定⇔ダッシュボード同期）
  "accent-preference-changed", // アクセント色（設定⇔ダッシュボード同期）
  "yt-config-changed",      // YouTube設定（動画ID等）の同期
  "yt-oauth-changed",       // YouTube OAuth 連携状態
  "broadcast-timer-changed", // 配信タイマー（経過時間）
  "obs-connection-changed",  // OBS WebSocket 接続状態
  "obs-output-state-changed", // 配信・録画（読み取り）
  "obs-scene-changed",       // 現在シーン
  "obs-mute-state-changed",  // マイクミュート
  "obs-config-changed",      // OBS マイクソース割当の同期
  "remote-sessions-changed", // リモート接続端末一覧
  "suite-presets-changed",   // データスロット一覧
];

// ============================================================
// contextBridge でレンダラーにAPIを公開
// ============================================================

contextBridge.exposeInMainWorld("electronAPI", {
  // ----------------------------------------------------------
  // 設定管理
  // ----------------------------------------------------------

  /**
   * 現在の設定を取得する
   * @returns {Promise<Object>} settings
   */
  getSettings: () => ipcRenderer.invoke("get-settings"),

  /**
   * 設定を保存する
   * @param {Object} settings
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // ----------------------------------------------------------
  // ファイル操作
  // ----------------------------------------------------------

  /**
   * CSSファイル選択ダイアログを開く
   * @returns {Promise<string|null>} 選択されたファイルパス
   */
  openCssFileDialog: () => ipcRenderer.invoke("open-css-file-dialog"),

  /**
   * CSSファイルの内容を読み込む
   * @param {string} filePath
   * @returns {Promise<{success: boolean, css?: string, error?: string}>}
   */
  loadCssFile: (filePath) => ipcRenderer.invoke("load-css-file", filePath),

  // ----------------------------------------------------------
  // オーバーレイ操作
  // ----------------------------------------------------------

  /**
   * クリック透過モードを切り替える
   * @returns {Promise<boolean>} 新しい状態
   */
  toggleClickThrough: () => ipcRenderer.invoke("toggle-click-through"),

  /**
   * 位置ロックを切り替える
   * @returns {Promise<boolean>} 新しい状態
   */
  togglePositionLock: () => ipcRenderer.invoke("toggle-position-lock"),

  // ----------------------------------------------------------
  // RPC管理
  // ----------------------------------------------------------

  /**
   * Discord RPCに再接続する
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  reconnectRpc: () => ipcRenderer.invoke("reconnect-rpc"),

  /**
   * 保存済み Discord OAuth トークンを削除し、必要なら再接続する
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  clearDiscordOAuth: () => ipcRenderer.invoke("clear-discord-oauth"),

  /**
   * 現在のRPC接続状態を取得する
   * @returns {Promise<Object>} RPCStatus
   */
  getRpcStatus: () => ipcRenderer.invoke("get-rpc-status"),

  /** YouTube OAuth 連携状態 */
  getYoutubeOAuthStatus: () => ipcRenderer.invoke("get-youtube-oauth-status"),

  /** ブラウザで YouTube OAuth 認可を開始 */
  startYoutubeOAuth: () => ipcRenderer.invoke("start-youtube-oauth"),

  /** YouTube OAuth 連携を解除 */
  clearYoutubeOAuth: () => ipcRenderer.invoke("clear-youtube-oauth"),

  /** 進行中の YouTube OAuth 認可をキャンセル */
  cancelYoutubeOAuth: () => ipcRenderer.invoke("cancel-youtube-oauth"),

  /** 未連携時の連携促しを抑制 */
  setYoutubeOAuthNudgeDismissed: (value) =>
    ipcRenderer.invoke("set-youtube-oauth-nudge-dismissed", value),

  /** 配信中の YouTube ライブを検出（OAuth 連携必須） */
  resolveYoutubeLiveBroadcasts: () => ipcRenderer.invoke("resolve-youtube-live-broadcasts"),

  prepareYtChatStart: () => ipcRenderer.invoke("prepare-yt-chat-start"),
  confirmYtChatStart: (videoId) => ipcRenderer.invoke("confirm-yt-chat-start", videoId),

  // ----------------------------------------------------------
  // 外部リンク
  // ----------------------------------------------------------

  /**
   * 外部URLをデフォルトブラウザで開く
   * @param {string} url
   */
  openExternal: (url) => ipcRenderer.send("open-external", url),

  // ----------------------------------------------------------
  // YouTube チャット管理
  // ----------------------------------------------------------

  /** YouTube 設定を取得する */
  getYtConfig:   () => ipcRenderer.invoke("get-yt-config"),

  /** YouTube 設定を保存する */
  saveYtConfig:  (settings) => ipcRenderer.invoke("save-yt-config", settings),

  /** ポーリングを開始する */
  startYtPoller: () => ipcRenderer.invoke("start-yt-poller"),

  /** ポーリングを停止する */
  stopYtPoller:  () => ipcRenderer.invoke("stop-yt-poller"),

  /** ポーラーの現在状態を取得する */
  getYtStatus:   () => ipcRenderer.invoke("get-yt-status"),

  /** OBS にコメントをピン留めする */
  pinYtMessage:  (msg) => ipcRenderer.invoke("pin-yt-message", msg),

  /** ピン留めを解除する（msgId 省略時は全解除） */
  unpinYtMessage: (msgId) => ipcRenderer.invoke("unpin-yt-message", msgId),

  /** 現在ピン留め中のメッセージ一覧（最大3件） */
  getYtPinned:   () => ipcRenderer.invoke("get-yt-pinned"),

  getYtSessionParticipants: () => ipcRenderer.invoke("get-yt-session-participants"),

  getYtViewerDetail: (channelId) => ipcRenderer.invoke("get-yt-viewer-detail", channelId),

  clearYtSession: () => ipcRenderer.invoke("clear-yt-session"),

  getSessionLogStatus: () => ipcRenderer.invoke("get-session-log-status"),
  getLastSessionLog: () => ipcRenderer.invoke("get-last-session-log"),
  startSessionLog: (videoId) => ipcRenderer.invoke("start-session-log", videoId),
  endSessionLog: () => ipcRenderer.invoke("end-session-log"),
  markSessionHighlight: (entryId) => ipcRenderer.invoke("mark-session-highlight", entryId),

  addYtNgUser: (channelId) => ipcRenderer.invoke("add-yt-ng-user", channelId),

  addYtNgWord: (word) => ipcRenderer.invoke("add-yt-ng-word", word),

  getSuiteFeatures: () => ipcRenderer.invoke("get-suite-features"),
  saveSuiteFeatures: (flags) => ipcRenderer.invoke("save-suite-features", flags),

  exportSettingsDialog: () => ipcRenderer.invoke("export-settings-dialog"),
  importSettingsDialog: () => ipcRenderer.invoke("import-settings-dialog"),

  getSuitePresets: () => ipcRenderer.invoke("get-suite-presets"),
  saveSuitePreset: (opts) => ipcRenderer.invoke("save-suite-preset", opts),
  applySuitePreset: (id) => ipcRenderer.invoke("apply-suite-preset", id),
  deleteSuitePreset: (id) => ipcRenderer.invoke("delete-suite-preset", id),
  renameSuitePreset: (id, name) => ipcRenderer.invoke("rename-suite-preset", { id, name }),

  getBroadcastTimer: () => ipcRenderer.invoke("get-broadcast-timer"),

  getAvatarConfig: () => ipcRenderer.invoke("get-avatar-config"),
  saveAvatarConfig: (settings) => ipcRenderer.invoke("save-avatar-config", settings),
  getAvatarStatus: () => ipcRenderer.invoke("get-avatar-status"),
  openAvatarPreview: () => ipcRenderer.invoke("open-avatar-preview"),
  openImageFileDialog: () => ipcRenderer.invoke("open-image-file-dialog"),

  openDashboard: () => ipcRenderer.invoke("open-dashboard-window"),
  openSettings: (opts) => ipcRenderer.invoke("open-settings-window", opts),

  obsConnect: () => ipcRenderer.invoke("obs-connect"),
  obsDisconnect: () => ipcRenderer.invoke("obs-disconnect"),
  obsGetStatus: () => ipcRenderer.invoke("obs-get-status"),
  obsListAudioInputs: () => ipcRenderer.invoke("obs-list-audio-inputs"),
  obsListScenes: () => ipcRenderer.invoke("obs-list-scenes"),
  obsSetCurrentScene: (sceneName) => ipcRenderer.invoke("obs-set-current-scene", sceneName),
  obsSetMute: (slot, muted) => ipcRenderer.invoke("obs-set-mute", { slot, muted }),
  obsGetConfig: () => ipcRenderer.invoke("obs-get-config"),
  obsSaveConfig: (partial) => ipcRenderer.invoke("obs-save-config", partial),
  obsDetectSuiteSource: () => ipcRenderer.invoke("obs-detect-suite-source"),
  saveObsEventActions: (rules) => ipcRenderer.invoke("save-obs-event-actions", rules),
  testObsEventAction: (rule) => ipcRenderer.invoke("test-obs-event-action", rule),
  openRehearsalPreview: () => ipcRenderer.invoke("open-rehearsal-preview"),

  remoteGetConfig: () => ipcRenderer.invoke("remote-get-config"),
  remoteListSessions: () => ipcRenderer.invoke("remote-list-sessions"),
  remoteRevokeSession: (sessionId) => ipcRenderer.invoke("remote-revoke-session", sessionId),
  remoteRegeneratePin: () => ipcRenderer.invoke("remote-regenerate-pin"),
  remoteRestartServer: () => ipcRenderer.invoke("remote-restart-server"),

  // ----------------------------------------------------------
  // イベントリスナー（メインプロセスからのプッシュ通知）
  // ----------------------------------------------------------

  /**
   * メインプロセスからのイベントを購読する
   *
   * 使用例:
   * const cleanup = window.electronAPI.on('speaking-update', (data) => {
   *   console.log(data);
   * });
   * // 不要になったら cleanup() でリスナーを解除
   *
   * @param {string} channel - チャンネル名
   * @param {Function} callback - コールバック関数 (data) => void
   * @returns {Function} リスナー解除関数
   */
  on: (channel, callback) => {
    // チャンネルのホワイトリストチェック
    if (!ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      console.warn(`[Preload] 未許可のチャンネル: ${channel}`);
      return () => {};
    }

    // ipcRendererのコールバックはeventオブジェクトを第一引数に持つため、
    // レンダラーには第二引数以降（実際のデータ）のみを渡す
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);

    // クリーンアップ関数を返す（メモリリーク防止）
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },

  /**
   * 一度だけイベントを受信する
   * @param {string} channel
   * @param {Function} callback
   */
  once: (channel, callback) => {
    if (!ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      console.warn(`[Preload] 未許可のチャンネル: ${channel}`);
      return;
    }
    ipcRenderer.once(channel, (event, ...args) => callback(...args));
  },
});

// ============================================================
// バージョン情報（デバッグ用）
// ============================================================

contextBridge.exposeInMainWorld("versions", {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});
