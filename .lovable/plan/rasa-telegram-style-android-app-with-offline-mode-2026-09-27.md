# Rasa: Telegram-style Android app with offline mode

## What you get
1. **Works offline**: the app opens with no internet. Your chat list, past messages and saved messages load from the phone. New messages you send offline show "waiting" and go out when you are back online.
2. **Telegram-style look**: full screen, a blue top bar that matches the phone's status bar, a floating pencil button to start a new chat, a side menu (profile, saved messages, settings), bubbles with tails and a patterned chat background, swipe back to the chat list, and the Android back button works inside the app.
3. **Saved Messages**: a chat with yourself, pinned at the top, available offline.
4. **New APK**: a freshly built, signed app file you can download from Files. It opens full screen and never opens the browser.

## Limits (plain)
- Offline only works in the installed or published app, not in the editor preview.
- Only chats you have already opened once while online are available offline. Photos and videos you haven't viewed yet won't load offline.
- Replying to a notification while the app is closed would need a separate notification service (Firebase). That can be a later step.

## Technical details
- Offline: `vite-plugin-pwa` (generateSW, `/sw.js`, autoUpdate, NetworkFirst for pages, CacheFirst for hashed assets, CacheFirst for Supabase storage media, `/~oauth` excluded). Register it through one guarded module (no dev, preview or iframe, `?sw=off` kill switch).
- Data: the existing IndexedDB query persister, plus `networkMode: "offlineFirst"`. The auth gate uses `getSession()` (local) instead of `getUser()` when offline. Add an offline banner, and queue outgoing messages in localforage, retrying on `online`.
- Saved Messages: a DM with `receiver_id = self`. Check that the RLS allows it, and pin it in `chats.index.tsx`.
- UI: token and style updates in `styles.css`, a drawer (Sheet) and FAB in the chats list, and `history.back` handling.
- APK: rebuild the Bubblewrap TWA with the same key and fingerprint (assetlinks unchanged), bump versionCode, set status bar color #0088cc and fullscreen display. Output to `/mnt/documents/rasa-v2.apk`.
