# Piu-Piu

Decentralized social network. Full client-side, no backend, hosted on piu-piu.top (custom domain). Account creation via URL shortener service (is.gd / v.gd / localhost provider). Auth via WebAuthn or Google OAuth2. P2P data sync via trystero. Web Push Notifications via VAPID.

⚠️ **IMPORTANT:** Anything published on the network is public. Everything is signed but not encrypted. There are no private messages. Data is synchronized unencrypted over multiple devices on the whole network.

## How it works

1. **Register** — Choose a username and a URL shortener provider (is.gd, v.gd, or localhost). A WebAuthn credential is created and your profile (`{ username, publicKey, provider }`) is base64-encoded into a URL route `/profile/:encoded`. That long URL is shortened through the provider, and you get a profile URL like:
   - `https://is.gd/abc123` → opens as `/@abc123`
   - `https://v.gd/abc123` → opens as `/@abc123/v`
   - `http://localhost:3000/abc123` → opens as `/@abc123/l`

2. **Home page** — Displays project description with Sign in (WebAuthn + Google) and Register buttons. App icon displayed prominently.

3. **View a profile** — Opening an account URL (`/@accountName` or `/@accountName/v`) resolves the provider, looks up the short URL, decodes the embedded profile, and displays it on the Account page.

4. **P2P Sync** — When visiting an account page, the client joins a trystero WebRTC room named after the account. Signed-in users announce themselves via a `whoami` action; guests help relay data but don't announce. Global room `"piu-piu"` collects all users for push notifications.

5. **Posts** — Signed-in users can create posts via the Post dialog. Each post is signed with WebAuthn (ECDSA P-256) or Google ECDSA key, stored in per-account IndexedDB, and displayed in the feed with signature verification status. Posts are broadcast to all peers in the room.

6. **Push Notifications** — Subscribe via service worker. Subscription encrypted with RSA public key (hybrid AES-GCM + RSA-OAEP), stored locally and announced in global room whoami. Persists across reloads with automatic restoration.

**Profile loading flow:**
- `ProfileResolver` loads profile data from route params (`accountName` + optional `provider`)
- Profile data is stored in `ProfileService` for component access
- `AuthService.restoreSession()` runs on app load, checks sessionStorage for existing signer

Everything is client-side; there is no server except the optional local shortener provider used during development.

## Architecture

### Provider system (`src/app/provider/`)
- `Provider` type: `{ url: string, prefix: string, label: string }`
- Providers: is.gd (prefix: ''), v.gd (prefix: 'v'), localhost (prefix: 'l')
- Helper functions: `getAvailableProviders()`, `getProviderByUrl()`, `getProviderByPrefix()`, `getDefaultProvider()`
- `provider.service.ts` wraps shortener HTTP API (`createShortUrl`, `lookupShortUrl`)

### Config service (`src/app/config/config.service.ts`)
- `ConfigService` - loads `config.json` at startup via `provideAppInitializer`
- `AppConfig` interface: `rsaPublicKey`, `vapidPublicKey`

### Profile service (`src/app/profile/profile.service.ts`)
- `ProfileService` - manages profile data state using signals
- `ProfileResolver` - resolves profile data from route parameters

### Error service (`src/app/error/error.service.ts`)
- `ErrorService` - shows toast notifications using Taiga UI toasts (`TuiToastService`)

### Auth service (`src/app/auth/auth.service.ts`)
- `AuthService` - manages dual authentication state (WebAuthn + Google OAuth2) using signals
- `isSignedIn`, `storedSigner`, `displayName`, `authMethod`, `signerMatchesAccount` signals
- `signIn(accountName)`, `signInWithGoogle()`, `completeGoogleSignIn()`, `signOut()`, `restoreSession()`

### Google Auth services (`src/app/google-auth/`)
- `GoogleAuthService` - OAuth2/OIDC with PKCE, token management, user info fetch, scope verification
- `KeyStorageService` - ECDSA P-256 key pair generation, PBKDF2+AES-GCM encryption, Drive appdata storage
- `GoogleCallbackComponent` - handles OAuth2 redirect at `/google-callback`
- `GooglePasswordPromptComponent` - password prompt dialog with Drive access notice

### Room service (`src/app/room/room.service.ts`)
- `RoomService` - manages trystero P2P room for data sync
- `joinRoom(accountName)` - joins room named after account
- Actions: `whoami` (global room), `post`, `request`, `provide`
- Global room `"piu-piu"` for all users (whoami only), polling: 10s newer posts, 30s older posts

### Crypto service (`src/app/crypto/crypto.service.ts`)
- Centralized cryptographic operations
- WebAuthn sign/verify, ECDSA sign/verify, public key import, DER conversion, base64 helpers
- `rsaEncrypt` - hybrid encryption: AES-GCM for data + RSA-OAEP for AES key
- `rsaDecrypt` - decrypts hybrid-encrypted data

### Post service (`src/app/post/post.service.ts`)
- `PostService` - manages posts stored in IndexedDB via `idb`
- Per-account databases (name = accountName)
- `createPost(content)` - creates post with uuid, sender, timestamp, content, WebAuthn/Google signature
- `getPost(uuid)`, `getAllPosts()`, `deletePost(uuid)`, `verifyPost(post)`

### Post dialog (`src/app/post/post-dialog/`)
- `PostDialogComponent` - Taiga UI routable dialog via `TuiDialogService`
- Opens from Account page Post button (only when `signerMatchesAccount`)
- Returns `PostData` observable via `context.completeWith()`

### Routes (custom UrlMatcher for @ prefix)
- `/` - Home page
- `/register` - Register page
- `/@:accountName` - Account page (defaults to is.gd)
- `/@:accountName/:provider` - Account page with provider suffix (v=v.gd, l=localhost)
- `/google-callback` - Google OAuth2 redirect handler
- All routes use lazy-loaded components (`loadComponent`)

## Development

```bash
npm install
npm start
```

`npm start` serves the app with `ng serve`. The local shortener provider runs on `http://localhost:3000` (`provider.mjs`).

## Build

```bash
npm run build
```

Production build output goes to `dist/` (no base-href, for custom domain).

## Test

```bash
npm test
```

Runs the test suite (vitest via Angular CLI).

## Pull Accounts

```bash
# Local (10 seconds, saves to accounts/test.json)
node pull_accounts.mjs

# CI (60 seconds, saves to accounts/public.json)
node pull_accounts.mjs accounts/public.json 60000
```

Runs via cron-job.org → GitHub Actions `repository_dispatch` every 5 minutes.

Features:
- 3 retries with 5s delay on connection failure
- Fails on any peer connection errors
- 24h cleanup of stale accounts
- Deduplication by username+account+profileUrl (keeps latest lastSeen)

## Release

Deployed to GitHub Pages via the `pull_request.yml` GitHub Actions workflow.
Custom domain: piu-piu.top (configured in GitHub Pages settings).