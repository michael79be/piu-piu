# Piu-Piu

Decentralized social network. Full client-side, no backend, hosted on piu-piu.top (custom domain). Account creation via URL shortener service (is.gd / v.gd / localhost provider). Auth via WebAuthn. P2P data sync via trystero. Web Push Notifications via VAPID.

## Stack

- Node, Angular 22, Angular CLI (`npx ng`), SCSS, TypeScript
- Tailwind CSS v4 via PostCSS, Taiga UI 5, angular-line-awesome, vitest, jsdom
- Local URL shortener provider (`provider.mjs`, `:3000`) for development
- trystero for WebRTC-based P2P communication
- idb for IndexedDB wrapper
- werift for pure JS WebRTC in Node.js (pull_accounts.mjs)
- jimp for PWA icon generation (pure JS, no native deps)

## Rules

- TypeScript, no comments, `null === var` syntax
- Never use `--legacy-peer-deps`
- Update AGENTS.md according to prompts from AI chat

## Commands

- `npm start` - serve locally (`ng serve`)
- `npm run build` - production build (no base-href, for custom domain)
- `npm test` - tests (vitest via `ng test`)
- `node pull_accounts.mjs [outputPath] [collectionTimeMs]` - pull accounts from global room (default: accounts/test.json, 10s; CI: accounts/public.json, 60s)

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

### Config service (`src/app/config/config.service.ts`)

- `ConfigService` - loads `config.json` at startup via `provideAppInitializer`
- `AppConfig` interface: `rsaPublicKey`, `vapidPublicKey`
- Used by `RsaPublicKeyService` and `VapidPublicKeyService`

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
- `joinRoom(accountName)` - joins room named after account. Account room only uses `postAction`. Broadcasts `requestPosts()` in global room after joining.
- Uses actions:
  - **Account room**: `post` only (broadcast new posts)
  - **Global room** `"piu-piu"`: `whoami` (broadcast who you are), `request` (broadcast to ask for posts), `provide` (provide posts to requests)
- `requestPosts(accountName, { before?, after? })` - broadcasts request for an account's posts in global room
- `handleRequest()` - filters regular posts by `before`/`after` UUID range, always includes meta posts (@settings, @follow) unfiltered
- `handleIncomingPost()` - verifies post signature using sender's publicKey, stores valid posts in IndexedDB
- `broadcastPost(post)` - sends post to all peers in account room
- Dispatches `piu-piu:load-posts` custom event after storing incoming posts
- `joinGlobalRoom()` / `leaveGlobalRoom()` - manages global room connection
- `announceGlobalIfSignedIn()` - broadcasts whoami with encrypted subscription field; also broadcasts requestPosts for followed accounts when new peer joins; includes own `@settings` and `@followers` index in whoami payload
- `updateWhoamiSubscription()` - updates whoami with new push subscription, updates sessionStorage
- Meta posts (`@settings`) NOT synced via P2P provide - only distributed via whoami broadcasts
- Polling: newer posts every 10s (`after` latest uuid), older posts every 30s (`before` oldest uuid), meta posts every 60s
- Logs join/leave/whoami/post events to console

### Meta post recovery (`src/app/room/recover.ts`)

- **`RecoverMetaAction`** - new global room action for recovering lost meta posts
- **`RecoverMetaPayload`** - request: `{ account: string }` - asks peers for stored meta data
- **`RecoverMetaResponse`** - response: `{ account, settings?, followers?, follow? }` - provides stored meta data
- Used when signed-in user's local `@settings`, `@followers`, or `@follow` is missing/corrupted - broadcasts request in global room, peers who received previous whoamis can respond with their cached copy

### Followers system

Followers are tracked via WhoAmI broadcasts and stored locally per-user:

- **`WhoAmI.followers`** - each user's whoami payload includes their full `@followers` index (Record<string, FollowData>) from local DB
- **`RoomService.handleWhoami()`** - on receiving whoami: (1) if sender follows signed-in user → adds sender to signed-in user's `@followers`; (2) stores sender's `@followers` under sender's account name for viewing their profile later
- **`PostService.getFollowers(accountName)`** / **`saveFollowers(accountName, followers)`** - reads/writes `@followers` meta post in target account's IndexedDB
- **`PostService.updateFollowers(accountName, followerAccount, followData, add)`** - serializes writes via promise queue to prevent race conditions; adds or removes a single follower entry
- **`Account.loadFollowers()`** - reads `@followers` count from IndexedDB, called on route load and on `piu-piu:load-posts` events
- **Followers counter** displayed on account page as `Followers: X`

**Followers data flow:**
1. User A follows B → `saveFollow()` signs `@follow` → stores in A's DB → broadcasts whoami (with A's follow list + A's followers)
2. B receives A's whoami → sees A follows B → adds A to B's `@followers` in B's DB
3. C views B's profile → receives B's whoami → gets B's `@followers` from whoami payload → displays count

No `@followers` meta posts are synced via P2P provide action — only via WhoAmI broadcasts.

### Post service (`src/app/post/post.service.ts`)

- `PostService` - manages posts stored in IndexedDB via `idb`
- `createPost(accountName, content)` - creates post with uuid, sender, timestamp, content, and WebAuthn signature
- `getPost(uuid)` - retrieves single post by uuid
- `getAllPosts(accountName)` - retrieves all posts sorted by timestamp descending
- `getVerifiedPosts(accountName)` - retrieves and verifies posts using post's publicKey, filters invalid
- `deletePost(uuid)` - deletes post by uuid
- `verifyPost(post)` - verifies post signature using Web Crypto API with post's publicKey
- `saveSettings(settings)`, `getSettings()`, `saveFollow(follow)`, `getFollow()`, `verifyFollow()`, `isFollowing()`
- `saveFollowers(accountName, followers)`, `getFollowers(accountName)`, `updateFollowers(accountName, followerAccount, followData, add)` - manages `@followers` meta post
- `saveSubscription(accountName, subscription)` / `getSubscription(accountName)` - manages push subscriptions in `@subscription` key

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

**Meta post types:**
- `@settings` - account settings (avatar, push notifications)
- `@followers` - follower index (who follows this account)

**Signature flow:**
- Signing: `createPost()` computes challenge as SHA-256 of `${uuid}:${senderAccount}:${timestamp}:${content}`, calls `navigator.credentials.get()` (WebAuthn)
- Verification: `verifyPost()` reconstructs signing string, hashes clientData, verifies signature with publicKey
- All binary fields stored as base64 strings for reliable JSON transport

### Post dialog (`src/app/post/post-dialog/`)

- `PostDialogComponent` - Taiga UI routable dialog via `TuiDialogService`
- Opens from Account page Post button (only when `signerMatchesAccount` is true)
- Textarea for content input
- On submit: calls `PostService.createPost()`, broadcasts via `RoomService`, reloads posts list
- Uses `POLYMORPHEUS_CONTEXT` for dialog context (close/completeWith)
- Returns `PostData` observable via `context.completeWith()`

### Settings dialog (`src/app/settings/`)

- `SettingsDialogComponent` - Taiga UI routable dialog via `TuiDialogService`
- Avatar services: Gravatar, Libravatar, Custom URL, None
- Dynamic email/URL input based on selected service
- Push notifications toggle
- Settings signed with WebAuthn, stored in IndexedDB (`@settings` key)
- Broadcast to peers via room service on save

### Crypto service (`src/app/crypto/crypto.service.ts`)

- `CryptoService` - centralized cryptographic operations
- `webAuthnSign(accountName)` - signs challenge using `navigator.credentials.get`
- `verifyWebAuthnSignature(authData, clientData, signature, publicKey)` - verifies WebAuthn assertion
- `importPublicKey(publicKey)` - imports SPKI public key for Web Crypto API
- `derToRawSignature(derSig)` - converts DER to raw r|s for ECDSA P-256
- `padChallenge(challenge)` - ensures challenge is 32 bytes for Web Crypto
- `bytesToBase64()`, `base64ToBytes()` - helpers for base64 encoding/decoding
- `signData(data, publicKey)` - signs data with ECDSA key
- `verifySignature(data, signature, publicKey)` - verifies ECDSA signature
- `importRsaPublicKey(pem)` - imports RSA public key from PEM
- `rsaEncrypt(data, publicKeyPem)` - hybrid encryption: AES-GCM for data + RSA-OAEP for AES key
- `rsaDecrypt(encryptedData, privateKeyPem)` - decrypts hybrid-encrypted data

### RSA Public Key service (`src/app/crypto/rsa-public-key.service.ts`)

- Loads RSA public key from `ConfigService` (via config.json)

### VAPID Public Key service (`src/app/crypto/vapid-public-key.service.ts`)

- Loads VAPID public key from `ConfigService` (via config.json)

### Routes (custom UrlMatcher for @ prefix)

- `/` - Home page
- `/register` - Register page
- `/@:accountName` - Account page with account name (defaults to is.gd)
- `/@:accountName/:provider` - Account page with account name and provider suffix (v=v.gd, l=localhost)
- `/feed` - Feed page (posts from followed accounts)

All routes use lazy-loaded components (`loadComponent`).

### Home page (`src/app/home/`)

- Project description with cloud background and apple-touch-icon.png
- App icon displayed prominently at top
- Sign in button - shows input for account name or URL + provider dropdown (hidden for URL input)
- WebAuthn Sign-In button
- Register button - navigates to register page
- Public data warning notice

### Register screen (`src/app/register/`)

1. User picks a provider (URL string) and enters a username (5–30 alphanumeric/underscore).
2. WebAuthn credential is created (`navigator.credentials.create`).
3. Profile `{ username, publicKey, provider }` is base64-encoded into URL path `/profile/:encoded`.
4. The long URL is shortened via the chosen provider; a custom short code (`username_random`) is attempted first.
5. On success, redirects to `/@accountName?signIn=true` or `/@accountName/provider?signIn=true` after 2 seconds.
- App icon displayed at top of card
- Public data warning notice

### Account screen (`src/app/account/`)

- Light mode, X.com-inspired layout using Taiga UI components (`TuiButton`, `TuiDropdown`, `TuiDataList`) and `angular-line-awesome` (`la-icon` component with `las`/`lar` prefixes)
- Left navigation: Home (→ `/feed`), Post (when signed in)
- Top bar: User menu with sign in/out/register, push notifications toggle
- App icon + "Piu-Piu" title in sidebar header
- Main content area displays profile with "Piu-Piu" title and posts feed
- Uses `ProfileResolver` to load profile data from route params
- On init: joins trystero room via `RoomService.joinRoom(accountName)` and global room via `RoomService.joinGlobalRoom()`
- Loads posts from IndexedDB via `PostService.getVerifiedPosts()`
- Listens for `piu-piu:load-posts` custom event to auto-refresh posts
- Uses `AuthService` for authentication state
- Auto-triggers WebAuthn sign-in when `?signIn=true` query param present (guarded by `signingIn` signal to prevent double trigger on mobile)
- Push notifications: subscribe/unsubscribe via service worker, hybrid RSA encryption, updates whoami
- **Push subscription persists across reloads** - auto-restored on page load via `pushManager.getSubscription()` and IndexedDB `@subscription`
- Follow/unfollow button with loading state, hidden on mobile; on mobile shows as icon-only on new line below header
- Followers counter (Followers: X) displayed under profile name/handle; built from WhoAmI broadcasts stored locally

**Profile loading flow:**
- `ProfileResolver` loads profile data from route params (`accountName` + optional `provider`)
- Always uses provider service to lookup short URL and decode profile from `/profile/:encoded` path
- Profile data is stored in `ProfileService` for component access
- On room join, broadcasts `requestPosts(accountName, { after: latestLocalPostUuid })` in global room for incremental sync
- Loads `@followers` count via `PostService.getFollowers(accountName)` for followers counter

**Post flow:**
- Post button opens `PostDialogComponent` via `TuiDialogService`
- User enters content, submits
- `PostService.createPost(content)` signs with WebAuthn, stores in IndexedDB
- `RoomService.broadcastPost(post)` sends to P2P room
- Posts list refreshes, displays newest first
- Each post shows sender, timestamp, content, and signature status

**signIn flow (WebAuthn):**
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

### Feed page (`src/app/feed/`)

- Child route under Layout, shows posts from followed accounts sorted by timestamp descending
- Loads verified posts via `PostService.getVerifiedPosts()` for each followed account
- Small avatar (`w-6 h-6`) for each post using `getAvatarUrl()` with Gravatar/Libravatar
- Signal-based `gravatarCache` with on-demand `fetchAndCacheAvatar`
- On load: broadcasts `requestPosts(targetAccount, { after: lastId })` for each followed account in global room (incremental sync)

### Pull Accounts Script (`pull_accounts.mjs`)

- Connects to global room `"piu-piu"` using `werift` (pure JS WebRTC)
- Collects `whoami` messages for specified duration (10s local, 60s CI)
- Saves accounts to JSON file with `subscription` field
- CLI: `node pull_accounts.mjs [outputPath] [collectionTimeMs]`
- Default: `accounts/test.json` with 10000ms
- CI: `accounts/public.json` with 60000ms (via cron-job.org triggering GitHub Actions)
- **3 retries** with 5s delay on connection failure
- **Fails on any peer connection errors** (`errorCount > 0`)
- **24h cleanup** - removes accounts with `lastSeen` > 24h
- **Deduplication** - keyed by `username|account|profileUrl`, keeps latest `lastSeen`
- Failsafe deduplication by `account` field (two-pass)

### Layout & Menu Components

- `Layout` (`src/app/layout/layout.ts`) - wrapper component with shared sidebar/menu, contains `RouterOutlet` for child routes
- `Menu` (`src/app/menu/menu.ts`) - sidebar with app icon, navigation (Feed/Post), user dropdown with sign in/out, push notifications
- `Feed` (`src/app/feed/feed.ts`) - child route under Layout, shows posts from followed accounts sorted by timestamp descending
- `Account` (`src/app/account/account.ts`) - child route under Layout, shows profile and posts for specific account

Routes:
- `/` - Home (landing page)
- `/feed` - Feed (Layout + Feed component)
- `/@accountName` - Account (Layout + Account component)
- `/register` - Register

## Release

GitHub Pages via `pull_request.yml` workflow.
Custom domain: piu-piu.top (configured in GitHub Pages settings).
Pull accounts via cron-job.org → GitHub Actions `repository_dispatch` (every 5 min).

## Security

- All data is PUBLIC. Every post, profile, and interaction is publicly visible and cryptographically verifiable.
- WebAuthn credentials never leave the authenticator.
- ECDSA private keys encrypted with PBKDF2+AES-GCM, stored in Google Drive appdata.
- Push subscriptions encrypted with RSA-OAEP (hybrid with AES-GCM) before storage/transmission.
- Push subscriptions stored in IndexedDB (per-account database, key `@subscription`) instead of localStorage for service worker access.
- Client secret NOT embedded (Desktop app OAuth client type, no secret needed).