# Piu-Piu

Decentralized social network like Twitter. Full client-side, no backend, hosted on piu-piu.top (custom domain). Account creation via URL shortener service (is.gd / v.gd / localhost provider). Auth via WebAuthn only. P2P data sync via trystero.

## Stack

- Node, Angular 22, Angular CLI (`npx ng`), SCSS, TypeScript
- Tailwind CSS v4 via PostCSS, Taiga UI 5, angular-line-awesome, vitest, jsdom
- office-addin-dev-certs for local SSL
- Local URL shortener provider (`provider.mjs`, `:3000`) for development
- trystero for WebRTC-based P2P communication
- idb for IndexedDB wrapper

## Rules

- TypeScript, no comments, `null === var` syntax
- Never use `--legacy-peer-deps`
- Update AGENTS.md according to prompts from AI chat

## Commands

- `npm start` - serve locally (copies dev SSL certs, then `ng serve`)
- `npm run build` - production build (no base-href, for custom domain)
- `npm test` - tests (vitest via `ng test`)

## Architecture

### Provider system (`src/app/provider/`)

`provider.enum.ts` defines the shortener providers with helper functions:

- `Provider` type: `{ url: string, prefix: string, label: string }`
- `Providers` array: is.gd (prefix: ''), v.gd (prefix: 'v'), localhost (prefix: 'l')
- Helper functions: `getAvailableProviders()`, `getProviderByUrl()`, `getProviderByPrefix()`, `getDefaultProvider()`

`provider.service.ts` wraps the shortener HTTP API:
- `createShortUrl(providerUrl, base, short?)` → `POST /create.php`
- `lookupShortUrl(providerUrl, shortUrl)` → `GET /forward.php`

Local provider (`provider.mjs` / `provider/`) runs on `:3000` and persists to `provider/store.json`.

### Profile service (`src/app/profile/profile.service.ts`)

- `ProfileService` - manages profile data state using signals
- `ProfileResolver` - resolves profile data from route parameters

### Error service (`src/app/error/error.service.ts`)

- `ErrorService` - shows toast notifications using Taiga UI toasts (`TuiToastService`)

### Auth service (`src/app/auth/auth.service.ts`)

- `AuthService` - manages WebAuthn authentication state using signals
- `isSignedIn` - signal for authentication state
- `storedSigner` - signal containing signer info from sessionStorage
- `displayName` - signal for display name
- `signerMatchesAccount` - computed checking if signer matches current route account
- `signIn(accountName)` - performs WebAuthn credential.get with accountName as challenge
- `signOut()` - clears sessionStorage and resets signals
- `restoreSession()` - called in constructor, restores from sessionStorage

### Room service (`src/app/room/room.service.ts`)

- `RoomService` - manages trystero P2P room for data sync
- `joinRoom(accountName)` - joins room named after account
- Uses `MessageAction` for `whoami` and `post` broadcasts
- Signed-in users announce themselves with signerInfo; guests participate but don't announce
- `handleIncomingPost()` - verifies post signature using sender's publicKey, stores valid posts in IndexedDB
- `broadcastPost(post)` - sends post to all peers in room
- Dispatches `piu-piu:load-posts` custom event after storing incoming posts
- Logs join/leave/whoami/post events to console

### Post service (`src/app/post/post.service.ts`)

- `PostService` - manages posts stored in IndexedDB via `idb`
- `createPost(accountName, content)` - creates post with uuid, sender, timestamp, content, and WebAuthn signature
- `getPost(uuid)` - retrieves single post by uuid
- `getAllPosts(accountName)` - retrieves all posts sorted by timestamp descending
- `getVerifiedPosts(accountName)` - retrieves and verifies posts using post's publicKey, filters invalid
- `deletePost(uuid)` - deletes post by uuid
- `verifyPost(post)` - verifies post signature using Web Crypto API with post's publicKey

**Post data structure:**
- `uuid` - crypto.randomUUID()
- `sender` - username from signer
- `senderAccount` - account name from signer
- `timestamp` - Date.now()
- `content` - user input
- `publicKey` - base64 encoded SPKI public key
- `signature` - base64 encoded WebAuthn ECDSA P-256 signature
- `authenticatorData` - base64 encoded authenticator data
- `clientData` - base64 encoded client data JSON

**Signature flow:**
- Signing: `createPost()` computes challenge as SHA-256 of `${uuid}:${senderAccount}:${timestamp}:${content}`, calls `navigator.credentials.get()` with challenge
- Verification: `verifyPost()` reconstructs signing string, hashes clientData, verifies signature with publicKey
- All binary fields stored as base64 strings for reliable JSON transport

### Post dialog (`src/app/post/post-dialog/`)

- `PostDialogComponent` - Taiga UI routable dialog via `TuiDialogService`
- Opens from Account page Post button (only when `signerMatchesAccount` is true)
- Textarea for content input
- On submit: calls `PostService.createPost()`, broadcasts via `RoomService`, reloads posts list
- Uses `POLYMORPHEUS_CONTEXT` for dialog context (close/completeWith)
- Returns `PostData` observable via `context.completeWith()`

### Crypto service (`src/app/crypto/crypto.service.ts`)

- `CryptoService` - centralized cryptographic operations
- `webAuthnSign(accountName)` - signs challenge using `navigator.credentials.get`
- `verifyWebAuthnSignature(authData, clientData, signature, publicKey)` - verifies WebAuthn assertion
- `importPublicKey(publicKey)` - imports SPKI public key for Web Crypto API
- `derToRawSignature(derSig)` - converts DER to raw r|s for ECDSA P-256
- `padChallenge(challenge)` - ensures challenge is 32 bytes for Web Crypto
- `bytesToBase64()`, `base64ToBytes()` - helpers for base64 encoding/decoding

### Routes (custom UrlMatcher for @ prefix)

- `/` - Home page
- `/register` - Register page
- `/@:accountName` - Account page with account name (defaults to is.gd)
- `/@:accountName/:provider` - Account page with account name and provider suffix (v=v.gd, l=localhost)

All routes use lazy-loaded components (`loadComponent`).

### Home page (`src/app/home/`)

- Project description with cloud background and apple-touch-icon.png
- App icon displayed prominently at top
- Sign in button - shows input for account name or URL + provider dropdown (hidden for URL input)
- Register button - navigates to register page

### Register screen (`src/app/register/`)

1. User picks a provider (URL string) and enters a username (5–30 alphanumeric/underscore).
2. WebAuthn credential is created (`navigator.credentials.create`).
3. Profile `{ username, publicKey, provider }` is base64-encoded into URL path `/profile/:encoded`.
4. The long URL is shortened via the chosen provider; a custom short code (`username_random`) is attempted first.
5. On success, redirects to `/@accountName?signIn=true` or `/@accountName/provider?signIn=true` after 2 seconds.
- App icon displayed at top of card

### Account screen (`src/app/account/`)

- Light mode, X.com-inspired layout using Taiga UI components (`TuiButton`, `TuiDropdown`, `TuiDataList`) and `angular-line-awesome` (`la-icon` component with `las`/`lar` prefixes)
- Left navigation: Home, Post (when signed in)
- Top bar: User menu with sign in/out/register
- App icon + "Piu-Piu" title in sidebar header
- Main content area displays profile with "Piu-Piu" title and posts feed
- Uses `ProfileResolver` to load profile data from route params
- On init: joins trystero room via `RoomService.joinRoom(accountName)`
- Loads posts from IndexedDB via `PostService.getVerifiedPosts()`
- Listens for `piu-piu:load-posts` custom event to auto-refresh posts
- Uses `AuthService` for authentication state

**Profile loading flow:**
- `ProfileResolver` loads profile data from route params (`accountName` + optional `provider`)
- Always uses provider service to lookup short URL and decode profile from `/profile/:encoded` path
- Profile data is stored in `ProfileService` for component access

**Post flow:**
- Post button opens `PostDialogComponent` via `TuiDialogService`
- User enters content, submits
- `PostService.createPost(content)` signs with WebAuthn, stores in IndexedDB
- `RoomService.broadcastPost(post)` sends to P2P room
- Posts list refreshes, displays newest first
- Each post shows sender, timestamp, content, and signature status

**signIn flow:**
- Uses `navigator.credentials.get` to authenticate (not create a new credential)
- The challenge is the accountName (accountName is converted to Uint8Array and used as the WebAuthn challenge)
- Stores signer info in sessionStorage via `AuthService`
- `AuthService.checkSigner` performs cryptographic verification

**checkSigner flow:**
- Separate authentication process that verifies:
  - Public key matches between profileData and signer
  - Challenge (accountName) matches
  - Cryptographic signature verification via Web Crypto API (`verifyWebAuthnSignature`)
- Sets `isSignedIn` based on all checks passing

## Release

GitHub Pages via `pull_request.yml` workflow.
Custom domain: piu-piu.top (configured in GitHub Pages settings).