# Cloudflare deployment

The production application is built once and deployed as one Cloudflare Worker version.

- `worker/index.ts` is passed directly to Wrangler. Wrangler transpiles and bundles the Worker TypeScript.
- `scripts/prepare-runtime.mjs` reconstructs the validated browser runtime during the build, never in the browser.
- Vite bundles the browser runtime and emits hashed assets to `build/client`.
- Cloudflare Static Assets uploads `build/client` together with the Worker.
- The browser does not download patch archives, create Blob modules, use GitHub Raw, or enter a reduced-function mode.

## Local validation

```sh
npm install
npm run check
npm run cf:dev
```

## Production deployment

```sh
npm run deploy
```

GitHub Actions deploys `main` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured as repository secrets.
