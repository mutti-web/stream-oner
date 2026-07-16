# StreamONER Privacy Policy

**Last updated:** 2026-07-16  
**Operator:** romu  
**Contact:** [contact@mutti.xyz](mailto:contact@mutti.xyz)  
**Application:** StreamONER (desktop app for Windows / macOS)  
**Homepage:** [https://streamoner.mutti.xyz/](https://streamoner.mutti.xyz/)

This Privacy Policy explains what information StreamONER (“the App”) accesses, how it is used, where it is stored, and how it may be shared.

## 1. Information we collect or access

### 1.1 Google / YouTube OAuth

If you authorize Google account linking, the App accesses YouTube data for the following purposes:

| Data | Purpose |
| --- | --- |
| Broadcast / live stream information linked to your YouTube account | Detect an active live stream and start chat retrieval |
| Live chat data (including message text, display names, and Super Chat display info) | Show chat in OBS and related overlays |
| Minimal channel metadata needed for identification | Show connection status in the App |

Scope used:

- `https://www.googleapis.com/auth/youtube.readonly` (view / read YouTube data)

The App does not collect or store your Google password. Authentication happens on Google’s screens.

Live chat may include display names and comments from viewers (third parties). These are processed and displayed on your device so you (the streamer) can show comments in the App / OBS.

### 1.2 Information stored on your device

The App mainly stores the following on your device:

- OAuth access tokens and refresh tokens (to keep the connection)
- App settings (layout, microphone settings, theme, etc.)
- Optional API keys or Discord secrets that you enter yourself

Tokens and secrets are stored using OS-provided encrypted storage.

### 1.3 Where data is sent

- During Google / YouTube linking, the App sends necessary requests from your device to Google’s servers (OAuth and YouTube Data API).
- As of the last update of this policy, there is no product mechanism that uploads retrieved YouTube data or OAuth tokens to the operator’s own servers.
- For chat display, display data may be sent to OBS (or similar) on your local machine, or to a remote control UI on the same LAN if you enable it. This stays on your PC / local network.

## 2. Purpose of use

We use the information only to:

1. Detect YouTube lives and retrieve / display live chat
2. Maintain and restore the linked connection
3. Carry out actions you explicitly request (unlink, change settings, backup, etc.)

Google user data obtained via Google APIs is not used for purposes other than providing these user-facing features.

## 3. Google API Services User Data Policy (Limited Use)

StreamONER’s use and transfer of Google user data complies with the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

The App does **not**:

- Sell or transfer Google user data to advertising platforms, data brokers, or information resellers
- Use Google user data for advertising, retargeting, personalized ads, or interest-based ads
- Use Google user data for creditworthiness or lending decisions
- Perform advertising tracking, or intentionally send App usage analytics to third-party analytics services
- Access Google services other than YouTube without authorization

## 4. Sharing with third parties

Except where required by law or necessary for security, we do not share retrieved YouTube data or OAuth tokens with third parties.

As described in section 1.3, display data may be sent to OBS or a same-LAN remote UI based on your settings and actions.

## 5. Human access

The operator and related parties do not read your Google user data (chat content, tokens, etc.) in normal operations.

We may handle the minimum necessary data only when:

- You explicitly agree for support and provide the needed information
- A security investigation (abuse, incidents, etc.) requires it
- Required by law

## 6. Retention and deletion

- OAuth tokens are kept on the device only while linked.
- If you unlink YouTube in the App, stored YouTube OAuth tokens are deleted.
- Live chat display data may remain on the device for display / history features. It can be removed by unlinking or deleting App data.
- After uninstall, files may remain in OS / user data areas. Follow OS procedures (e.g. delete the App data directory) for full removal.
- You can also revoke access in
  [Google Account → Third-party access](https://myaccount.google.com/permissions).

## 7. Security

Tokens and secrets are designed to be stored in an encryptable form on device and excluded from source code and settings exports. We cannot completely eliminate risks from device compromise or malware.

## 8. Children’s privacy

StreamONER is primarily a tool for streamers. We do not knowingly collect personal information from children under 13 without parental consent.

## 9. Changes to this policy

If we change this policy, we will update the “Last updated” date on this page. For material changes, we will provide notice in a reasonable manner.

## 10. Contact

For questions about this Privacy Policy:

- Email: [contact@mutti.xyz](mailto:contact@mutti.xyz)
- Operator: romu
- Homepage: [https://streamoner.mutti.xyz/](https://streamoner.mutti.xyz/)
