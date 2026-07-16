# StreamONER

配信向けデスクトップアプリです。Discord の VC 表示、YouTube ライブチャット、アバター（PNG レイヤー口パク）を、OBS のブラウザソースにまとめて表示できます。

## 主な機能

- **Discord** — 参加中 VC のメンバー表示・発話ハイライト
- **YouTube** — ライブ配信の検出とライブチャットの取得・OBS 表示（Google アカウント連携は読み取り専用）
- **アバター** — マイク連動の口パクなど、配信向けオーバーレイ

対象 OS: Windows / macOS（配布インストーラは主に Windows x64）

## Google / YouTube 連携について

StreamONER は、ユーザーの許可のもと Google OAuth（スコープ `youtube.readonly`）を使い、次の目的でのみ YouTube データにアクセスします。

- 配信中のライブを検出する
- ライブチャットを取得し、OBS 等に表示する

パスワードは取得しません。詳細は[プライバシーポリシー](./privacy.html)を参照してください。

## リンク

- [プライバシーポリシー](./privacy.html)
- 運営: romu
- 連絡先: [contact@mutti.xyz](mailto:contact@mutti.xyz)
