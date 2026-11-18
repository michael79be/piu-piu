# Piu-Piu

Decentralized social network like Twitter. Full client-side, no backend, hosted on GitHub Pages. Account creation via URL shortener service (is.gd / v.gd / localhost provider). Auth via WebAuthn only.

## How it works

1. **Register** — Choose a username and a URL shortener provider (is.gd, v.gd, or localhost). A WebAuthn credential is created and your profile (`{ username, publicKey }`) is base64-encoded into a URL hash fragment. That long URL is shortened through the provider, and you get a profile URL like:
   - `https://is.gd/abc123` → opens as `#@abc123`
   - `https://v.gd/abc123` → opens as `#v@abc123`
   - `http://localhost:3000/abc123` → opens as `#l@abc123`

2. **View a profile** — Opening a profile URL reads the hash prefix (`#@`, `#v@`, `#l@`), detects the provider, looks up the short URL, decodes the embedded profile, and displays it.

**Profile loading flow:**
- `loadProfileFromHash()` is always called in the constructor - this loads the profile on guest access by reading the hash prefix from the URL and using `ProviderTagMap` to determine the provider
- `checkSigner(signer)` is a separate authentication process that only runs when there's a stored signer in `sessionStorage`

Everything is client-side; there is no server except the optional local shortener provider used during development.

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

Production build output goes to `dist/`.

## Test

```bash
npm test
```

Runs the test suite (vitest via Angular CLI).

## Release

Deployed to GitHub Pages via the `pull_request.yml` GitHub Actions workflow.

