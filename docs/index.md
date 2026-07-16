---
title: StreamONER
---

# StreamONER

**App name: StreamONER**

StreamONER is a desktop application for live streamers.

## App purpose

StreamONER helps streamers show on-air overlays in OBS:

- Discord voice-channel members and speaking highlights
- YouTube live chat on stream
- Avatar / mouth-sync overlays driven by microphone input

These features are combined into OBS browser sources for live production.

日本語での説明: StreamONER は配信者向けデスクトップアプリです。Discord の VC 表示、YouTube ライブチャット、アバター（マイク連動の口パク）を OBS のブラウザソースにまとめて表示します。

## YouTube / Google OAuth purpose

When a user connects Google, StreamONER uses the read-only scope
`https://www.googleapis.com/auth/youtube.readonly` only to:

1. Detect the user's active YouTube live broadcast
2. Read live chat messages for on-screen display in OBS

StreamONER does not collect Google passwords. Details are in the
[Privacy Policy](./privacy.html).

## Platform

Windows / macOS desktop app (installer primarily for Windows x64).

## Links

- [Privacy Policy](./privacy.html)
- Operator: romu
- Contact: [contact@mutti.xyz](mailto:contact@mutti.xyz)
