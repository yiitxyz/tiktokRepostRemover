# Privacy

TikTok Repost Remover runs locally in your browser. It has no analytics, telemetry, advertising, external server, or credential form.

## Data used

- Your existing TikTok session is used by TikTok requests made from `tiktok.com`.
- TikTok's page-context `secUid` identifies the signed-in account for a scan. It is neither logged nor persisted by the extension.
- Repost IDs, creator names, captions, thumbnail URLs, selections, and run status are stored locally in extension IndexedDB and `chrome.storage.local`.

Data is sent only to TikTok for the listing and removal actions you request. JSON/CSV exports are created locally and downloaded only when you click an export button.

## Removal

Remove the extension from Brave or Chrome to delete its browser-managed local data. You can also clear extension data from the browser's site/extension storage settings.

## Contact

Report privacy concerns through [GitHub Issues](https://github.com/yiitxyz/tiktokRepostRemover/issues) without including cookies, account identifiers, or other session data.
