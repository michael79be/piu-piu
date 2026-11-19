# Piu-Piu

Decentralized social network like Twitter. Full client-side, no backend, hosted on piu-piu.top (custom domain). Account creation via URL shortener service (is.gd / v.gd / localhost provider). Auth via WebAuthn only. P2P data sync via trystero.

⚠️ **IMPORTANT:** Anything published on the network is public. Everything is signed but not encrypted. There are no private messages. Data is synchronized unencrypted over multiple devices on the whole network.

## How it works

1. **Register** — Choose a username and a URL shortener provider (is.gd, v.gd, or localhost). A WebAuthn credential is created and your profile (`{ username, publicKey, provider }`) is base64-encoded into a URL route `/profile/:encoded`. That long URL is shortened through the provider, and you get a profile URL like:
   - `https://is.gd/abc123` → opens as `/@abc123`
   - `https://v.gd/abc123` → opens as `/@abc123/v`
   - `http://localhost:3000/abc123` → opens as `/@abc123/l`

2. **Home page** — Displays project description with Sign in and Register buttons. App icon displayed prominently.

3. **View a profile** — Opening an account URL (`/@accountName` or `/@accountName/v`) resolves the provider, looks up the short URL, decodes the embedded profile, and displays it on the Account page.

4. **P2P Sync** — When visiting an account page, the client joins a trystero WebRTC room named after the account. Signed-in users announce themselves via a `whoami` MessageAction; guests help relay data but don't announce.

5. **Posts** — Signed-in users can create posts via the Post dialog. Each post is signed with WebAuthn (ECDSA P-256), stored in per-account IndexedDB, and displayed in the feed with signature verification status. Posts are broadcast to all peers in the room via the `post` MessageAction.

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

### Profile service (`src/app/profile/profile.service.ts`)
- `ProfileService` - manages profile data state using signals
- `ProfileResolver` - resolves profile data from route parameters

### Error service (`src/app/error/error.service.ts`)
- `ErrorService` - shows toast notifications using Taiga UI toasts (`TuiToastService`)

### Auth service (`src/app/auth/auth.service.ts`)
- `AuthService` - manages WebAuthn authentication state using signals
- `isSignedIn`, `storedSigner`, `displayName`, `signerMatchesAccount` signals
- `signIn(accountName)`, `signOut()`, `restoreSession()`

### Room service (`src/app/room/room.service.ts`)
- `RoomService` - manages trystero P2P room for data sync
- `joinRoom(accountName)` - joins room named after account
- `whoami` and `post` MessageActions for broadcasting

### Crypto service (`src/app/crypto/crypto.service.ts`)
- Centralized cryptographic operations
- WebAuthn sign/verify, public key import, DER conversion, base64 helpers

### Post service (`src/app/post/post.service.ts`)
- `PostService` - manages posts stored in IndexedDB via `idb`
- Per-account databases (name = accountName)
- `createPost(content)` - creates post with uuid, sender, timestamp, content, WebAuthn signature
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
- All routes use lazy-loaded components (`loadComponent`)

## Development

```bash
npm install
npm start
```

`npm start` copies local SSL certificates (via `office-addin-dev-certs`) and serves the app with `ng serve`. The local shortener provider runs on `http://localhost:3000` (`provider.mjs`).

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

## Release

Deployed to GitHub Pages via the `pull_request.yml` GitHub Actions workflow.
Custom domain: piu-piu.top (configured in GitHub Pages settings).