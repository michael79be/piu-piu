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

`provider.enum.ts` defines the shortener providers with helper functions:

- `Provider` type: `{ url: string, prefix: string, label: string }`
- `Providers` array: is.gd (prefix: ''), v.gd (prefix: 'v'), localhost (prefix: 'l')
- Helper functions: `getAvailableProviders()`, `getProviderByUrl()`, `getProviderByPrefix()`, `getDefaultProvider()`

`provider.service.ts` wraps the shortener HTTP API:
- `createShortUrl(providerUrl, base, short?)` → `POST /create.php`
- `lookupShortUrl(providerUrl, shortUrl)` → `GET /lookup`

Local provider (`provider.mjs` / `provider/`) runs on `:3000` and persists to `provider/store.json`.

### Profile service (`src/app/profile/profile.service.ts`)

- `ProfileService` - manages profile data state using signals
- `ProfileResolver` - resolves profile data from route parameters

### Error service (`src/app/error/error.service.ts`)

- `ErrorService` - shows toast notifications using Taiga UI toasts (`TuiToastService`)

### Routes (custom UrlMatcher for @ prefix)

- `/` - Home page
- `/register` - Register page
- `/@:accountName` - Account page with account name (defaults to is.gd)
- `/@:accountName/:provider` - Account page with account name and provider suffix (v=v.gd, l=localhost)

All routes use lazy-loaded components (`loadComponent`).

### Home page (`src/app/home/`)

- Project description with cloud background and apple-touch-icon.png
- Sign in button - shows input for account name or URL + provider dropdown (hidden for URL input)
- Register button - navigates to register page

### Register screen (`src/app/register/`)

1. User picks a provider (URL string) and enters a username (5–30 alphanumeric/underscore).
2. WebAuthn credential is created (`navigator.credentials.create`).
3. Profile `{ username, publicKey, provider }` is base64-encoded into URL path `/profile/:encoded`.
4. The long URL is shortened via the chosen provider; a custom short code (`username_random`) is attempted first.
5. On success, redirects to `/@accountName` or `/@accountName/provider` after 2 seconds.

### Account screen (`src/app/account/`)

- Light mode, X.com-inspired layout using Taiga UI components (`TuiButton`, `TuiDropdown`, `TuiDataList`) and `angular-line-awesome` (`la-icon` component with `las`/`lar` prefixes)
- Left navigation: Home, Post
- Top bar: User menu with sign in/out
- Main content area displays profile information
- Uses `ProfileResolver` to load profile data from route params
- WebAuthn sign in with cryptographic verification via `checkSigner`

**Profile loading flow:**
- `ProfileResolver` loads profile data from route params (`accountName` + optional `provider`)
- Always uses provider service to lookup short URL and decode profile from `/profile/:encoded` path
- Profile data is stored in `ProfileService` for component access
- `checkSigner(signer)` runs when there's a stored signer in `sessionStorage`

**signIn flow:**
- Uses `navigator.credentials.get` to authenticate (not create a new credential)
- The challenge is the accountName (accountName is converted to Uint8Array and used as the WebAuthn challenge)
- Stores signer info in sessionStorage
- Calls `checkSigner` for cryptographic authentication verification

**checkSigner flow:**
- Separate authentication process that verifies:
  - Public key matches between profileData and signer
  - Challenge (accountName) matches
  - Cryptographic signature verification via Web Crypto API (`verifyWebAuthnSignature`)
- Sets `isSignedIn` based on all checks passing

## Release

GitHub Pages via `pull_request.yml` workflow.