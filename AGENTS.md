# AGENTS.md

## Purpose
This repository is a Next.js / TypeScript frontend for the DeFi Simulator app used by defisim.xyz. It is a localized Aave debt simulator with translation support via Lingui.

## Key facts
- Framework: `Next.js 14` with TypeScript
- UI: `@mantine/*`
- Internationalization: `@lingui/core`, `@lingui/react`, `@lingui/macro`
- Translation catalogs: `src/locales/{locale}/messages`
- Backend routes: `pages/api/*`
- Important directories:
  - `pages/` — Next.js pages and API routes
  - `components/` — reusable UI components
  - `hooks/` — custom hooks for Aave data and history
  - `store/` — local state stores
  - `src/languages/` — language metadata

## Recommended commands
- `npm install --legacy-peer-deps` — install dependencies, avoiding current peer dependency conflicts
- `npm run build` — build the app and compile Lingui catalogs
- `npm run lint` — run Next linting
- `npm run typecheck` — run `tsc --noEmit`
- `npm run test` or `npm run jest` — run Jest tests
- `npm run sync` — regenerate Lingui catalogs (`extract` + `compile`)

## Notes for coding agents
- Preserve the existing Next.js page and API route structure when adding or moving files.
- The app currently loads Lingui catalogs from `src/locales/{locale}/messages`; avoid breaking this pattern unless updating the whole i18n flow.
- Prefer editing `package.json` scripts only when necessary; the build flow depends on `sync_and_purge`.
- This repo has both `.babelrc` and `babel.config.js`, so pay attention to Babel configuration when troubleshooting build issues.

## No existing customization file found
There was no `.github/copilot-instructions.md` or `AGENTS.md` in the repository before this file was added.
