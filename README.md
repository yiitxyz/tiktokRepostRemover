<p align="center">
  <img src="assets/icon-128.png" width="128" height="128" alt="TikTok Repost Remover icon">
</p>

<h1 align="center">TikTok Repost Remover</h1>

<p align="center">Scan, review, and selectively remove reposts from your TikTok account.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-25f4ee.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Manifest-V3-fe2c55.svg" alt="Manifest V3">
  <a href="https://github.com/yiitxyz"><img src="https://img.shields.io/github/followers/yiitxyz?style=social" alt="Follow yiitxyz on GitHub"></a>
</p>

![Scan, review, and verify workflow](assets/hero.png)

A local, open-source Manifest V3 extension for Brave and Chrome. It uses your existing signed-in TikTok session, stores results locally for review, and removes only the reposts you explicitly check.

Built and maintained by **[Yiğit (@yiitxyz)](https://github.com/yiitxyz)** — visit my profile for more open-source projects.

## Features

- Two-phase workflow: scan first, delete only after review.
- Persistent checkboxes with select all, select none, invert, search, and pagination.
- Live totals, timing estimates, pause/resume/stop, and JSON/CSV exports.
- Sequential deletion with randomized pacing and immediate safety shutdowns.
- Bounded server verification instead of an unbounded full-account rescan.
- No credentials, cookie permission, analytics, remote code, or external server.

> [!WARNING]
> TikTok does not provide a supported personal-account API for removing reposts, and its terms restrict automated scripts. Random pacing reduces request bursts but cannot guarantee protection from rate limits or account restrictions. Stop immediately if TikTok shows verification or unusual-activity warnings.

This project is not affiliated with, endorsed by, or sponsored by TikTok or ByteDance.

## Install

### From a release

1. Download `tiktok-repost-remover-v*.zip` from the [latest release](https://github.com/yiitxyz/tiktokRepostRemover/releases/latest).
2. Extract the archive.
3. Open `brave://extensions` in Brave or `chrome://extensions` in Chrome.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the extracted `dist` folder.
6. Sign in normally at `https://www.tiktok.com/` and refresh the TikTok tab.

### Build from source

1. Install Node.js 20 or newer.
2. Open PowerShell in this project and run:

   ```powershell
   npm install
   npm run build
   ```

3. Follow steps 3–6 above and select this project's generated `dist` folder.

After source changes, run `npm run build`, then click the extension's reload button on `brave://extensions`.

## Use

1. Open the popup and click **Scan Reposts**.
2. Leave one TikTok tab open while pages are collected. Counts update after every saved page.
3. Let the scan finish, or click **Stop Scan** to keep the partial collection.
4. Click **Open Review Page**.
5. Search and use **Select All**, **Select None**, **Invert**, or individual checkboxes. Selections survive refreshes.
6. Click **Delete Selected Reposts** and confirm the exact count.
7. Pause, resume, or stop at any time. Failed items are skipped, and progress is retained.
8. When the queue ends, the extension scans only as far as the deepest original page containing a selected item, then verifies which selected reposts remain.

Exports are available as JSON and CSV without an additional browser permission.

## Implementation choice

Research refreshed on August 4, 2026 found that TikTok's official Display API lists a user's own posted videos but cannot remove reposts. The restricted Research API can query reposted-video data but is read-only and not appropriate for personal authenticated actions. TikTok's desktop site and the current public reference implementation still use:

- `GET /api/repost/item_list/` with `itemList`, `hasMore`, and `cursor`.
- `POST /tiktok/v1/upvote/delete` with the video `item_id`.
- `secUid` from TikTok's page context to identify the currently signed-in account.

The extension therefore keeps the internal website-request strategy because it is less brittle than automating TikTok's changing DOM. These endpoints are private and may change without notice. The extension probes 50 listing items; if TikTok rejects that listing request with HTTP 400, it falls back once to the website's current 30-item size. It records the number actually returned and always follows TikTok's returned cursor and `hasMore` instead of assuming a page size.

References:

- [TikTok Display API](https://developers.tiktok.com/doc/display-api-overview/)
- [TikTok Research API: reposted videos](https://developers.tiktok.com/doc/research-api-specs-query-user-reposted-videos/)
- [TikTok Help: reposts](https://support.tiktok.com/en/using-tiktok/exploring-videos/repost)
- [Current public web-request reference](https://github.com/gabireze/tiktok-all-reposted-videos-remover)
- [Chrome Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [TikTok Terms](https://www.tiktok.com/legal/page/us/terms-of-service/en)

## Architecture

```text
Popup ──commands/status── MV3 service worker ──single worker tab── TikTok content script
                              │                                      │
                              │                                 list/delete APIs
                              │
Review page ──selection──── IndexedDB
      └──────── live counters in chrome.storage.local
```

- `src/background.ts` owns commands, selects one TikTok worker tab, reads `secUid` in the page's MAIN world, and serializes database/state changes.
- `src/content.ts` performs paced listing, sequential selected deletion, safety shutdowns, and bounded final verification. It logs only endpoint paths and non-secret item IDs.
- `src/storage.ts` stores repost metadata and selections in extension-origin IndexedDB so large scans do not consume `chrome.storage.local` quota.
- `src/shared.ts` defines the persisted state, item model, and message protocol.
- `src/popup.*` provides compact scan controls and totals.
- `src/review.*` renders at most 60 cards per page and provides selection, deletion controls, search, and export.

### State and pacing

The scan and delete phases never run together. Each successful scan page is committed before the randomized 4–8 second pagination delay. A stopped scan remains reviewable. Duplicate item IDs are ignored by IndexedDB.

Deletion processes only checked, non-removed items. Requests are sequential with a randomized 300–600 ms delay between attempts. After a new randomized group of 35–45 attempts, the extension waits a randomized 4–7 seconds and chooses a new group size. One ordinary item failure is saved and skipped. Authentication failures, HTTP 401/403/429, CAPTCHA, verification, risk-control, restriction, unusual-activity, or rate-limit messages stop the entire run.

Listing uses a 20-second timeout and at most two retries after the first attempt, only for timeouts, transport failures, or HTTP 5xx responses. Delete POSTs are not automatically replayed because an ambiguous response could hide a successful server-side action. Final verification tracks each item's original scan page and never scans deeper than needed; selected items can only move earlier when preceding reposts are removed.

Console messages use `[TikTok Repost Remover]`. Logs never include `secUid`, cookies, authentication headers, or full query strings.

## Permissions and privacy

- `storage`: lightweight state; item metadata remains in local IndexedDB.
- `scripting`: read the signed-in account's `secUid` from TikTok's page context.
- `https://www.tiktok.com/*`: run the content script and call TikTok from the existing session.

There is no cookies, downloads, history, `<all_urls>`, remote code, analytics, telemetry, or external server permission.

## Development

```powershell
npm install
npm run lint
npm run typecheck
npm run build
npm test
```

Tests inspect the compiled extension, so build before testing. The unpacked artifact is `dist`.

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), report ordinary bugs through [GitHub Issues](https://github.com/yiitxyz/tiktokRepostRemover/issues), and report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Troubleshooting

### Account cannot be identified

Refresh TikTok, confirm the normal site shows your signed-in profile, complete any consent/CAPTCHA screen, and scan again. Never enter credentials into the extension.

### Scan was interrupted

The collected pages and selections are still available on the review page. HTTP 401, 403, or 429 and verification/risk messages intentionally stop the run. Wait before starting a new scan; a new scan replaces the previous collection after confirmation.

### Returned page size is below 50

This is expected when TikTok caps or shortens a page. The popup reports the largest actual response, and pagination uses the server cursor rather than assuming 50 items.

### Deletion failed or stopped

Open the review page to inspect each status. **Resume** continues pending work after a user pause/stop. **Retry Remaining** requeues only checked failed/remaining items. Do not retry immediately after a safety shutdown.

### Counts differ from the profile tab

TikTok may cache profile UI data. The extension's completion result comes from a new server-side repost-list scan. Refresh the profile; if the discrepancy persists, export JSON and inspect remaining IDs manually.

### Extension code changed but Brave still runs the old version

Run `npm run build`, open `brave://extensions`, and click **Reload** on TikTok Repost Remover. Refresh any already-open TikTok tab so the new content script is injected.

## Project structure

```text
scripts/build.mjs
src/
  background.ts
  content.ts
  manifest.json
  popup.css / popup.html / popup.ts
  review.css / review.html / review.ts
  shared.ts
  storage.ts
tests/build.test.js
```

## License and privacy

Released under the [MIT License](LICENSE). See [PRIVACY.md](PRIVACY.md) for the exact local data behavior.

---

If this project helped you, please **star the repository** and follow **[@yiitxyz](https://github.com/yiitxyz)** for future projects.
