# Changelog

## 2.0.1 - 2026-08-04

- Added a two-phase scan, review, and selected-only deletion workflow.
- Added persistent IndexedDB selection, search, pagination, JSON/CSV export, pause/resume, and stop controls.
- Added bounded server verification with live progress.
- Added safe fallback from 50-item listing requests to TikTok's accepted 30-item size.
- Added request timeouts, bounded listing retries, immediate safety shutdowns, and sanitized logging.
- Tuned deletion pacing to 300–600 ms with randomized 4–7 second group cooldowns.
