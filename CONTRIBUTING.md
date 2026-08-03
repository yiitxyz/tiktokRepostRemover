# Contributing

Thanks for helping improve TikTok Repost Remover.

1. Fork the repository and create a focused branch.
2. Install Node.js 20 or newer and run `npm install`.
3. Keep permissions minimal, avoid new dependencies, and never add captured cookies or account data.
4. Run the complete check before opening a pull request:

   ```sh
   npm run lint
   npm run typecheck
   npm run build
   npm test
   ```

5. Explain the behavior change, safety impact, and manual browser verification performed.

TikTok's internal endpoints are unsupported and can change. When updating them, include sanitized evidence that omits query strings, session identifiers, and authentication data.
