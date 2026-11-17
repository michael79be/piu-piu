# Piu-Piu

Decentralized social network like Twitter. Full client-side, no backend, hosted on GitHub Pages. Account creation via URL shortener service (is.gd / v.gd / localhost provider). Auth via WebAuthn only.

## Stack

- Node, Angular 22, Angular CLI (`npx ng`), SCSS, TypeScript
- Tailwind CSS v4 via PostCSS, Taiga UI 5, angular-line-awesome, vitest, jsdom
- office-addin-dev-certs for local SSL
- Local URL shortener provider (`provider.mjs`, `:3000`) for development

## Rules

- TypeScript, no comments, `null === var` syntax
- Never use `--legacy-peer-deps`
- Update AGENTS.md according to prompts from AI chat

## Commands

- `npm start` - serve locally (copies dev SSL certs, then `ng serve`)
- `npm run build` - production build
- `npm test` - tests (vitest via `ng test`)

## Architecture

### Provider system (`src/app/provider/`)

`provider.enum.ts` defines the shortener providers and their URL-prefix tags:

- `#@` → `https://is.gd` (`ProviderTag.IsGd`)
- `#v@` → `https://v.gd` (`ProviderTag.Vgd`)
- `#l@` → `http://localhost:3000` (`ProviderTag.Localhost`)

`ProviderTagMap` maps provider base URLs → `ProviderTag` enum values. Use it to:
- Build profile URLs from a provider (`register.ts`)
- Detect the provider from a profile URL hash prefix (`profile.ts`)

`provider.service.ts` wraps the shortener HTTP API:
- `createShortUrl(providerUrl, base, short?)` → `POST /create.php`
- `lookupShortUrl(providerUrl, shortUrl)` → `GET /lookup`

Local provider (`provider.mjs` / `provider/`) runs on `:3000` and persists to `provider/store.json`.

### Register screen (`src/app/register/`)

1. User picks a provider and enters a username (5–30 alphanumeric/underscore).
2. WebAuthn credential is created (`navigator.credentials.create`).
3. Profile `{ username, publicKey }` is base64-encoded and appended to the page URL as a hash fragment.
4. The long URL is shortened via the chosen provider; a custom short code (`username_random`) is attempted first.
5. The profile URL is displayed as `${rootUrl}/${tag}${name}` where `tag` comes from `ProviderTagMap`.

Example profile URLs: `#@abc123` (is.gd), `#v@abc123` (v.gd), `#l@abc123` (localhost).

### Profile screen (`src/app/profile/`)

- Light mode, X.com-inspired layout using Taiga UI components (`TuiButton`) and `angular-line-awesome` (`la-icon` component with `las`/`lar` prefixes)
- Bottom navigation: Home, Post, Account
- Top bar: Home back button, Profile title, more options (ellipsis)
- Main content area intentionally empty
- Reads `location.hash` and matches prefix `/^(#v@|#l@|#@)([^&]*)/`.
- Reverse-looks-up the provider base URL from `ProviderTagMap` using the matched tag; defaults to `https://is.gd`.
- Looks up the short URL via `ProviderService.lookupShortUrl`.
- Extracts the encoded profile from `longurl.split('#')[1]`, base64-decodes, parses JSON, and displays it.

## Register screen (legacy notes)

- Creates WebAuthn credentials
- User chooses username; account name from shortener
- Encode profile URL, shorten it; account name becomes short url
- Display `#@account-name` URL

## Release

GitHub Pages via `pull_request.yml` workflow.

