# Piu-Piu

Decentralized social network like Twitter. Full client-side, no backend, hosted on GitHub Pages. Account creation via URL shortener service (is.gd / v.gd / localhost provider). Auth via WebAuthn only.

## How it works

1. **Register** — Choose a username and a URL shortener provider (is.gd, v.gd, or localhost). A WebAuthn credential is created and your profile (`{ username, publicKey }`) is base64-encoded into a URL route `/profile/:encoded`. That long URL is shortened through the provider, and you get a profile URL like:
   - `https://is.gd/abc123` → opens as `/@abc123`
   - `https://v.gd/abc123` → opens as `/@abc123/v`
   - `http://localhost:3000/abc123` → opens as `/@abc123/l`

2. **Home page** — Displays project description with Sign in and Register buttons.

3. **View a profile** — Opening an account URL (`/@accountName` or `/@accountName/v`) resolves the provider, looks up the short URL, decodes the embedded profile, and displays it on the Account page.

**Profile loading flow:**
- `ProfileResolver` loads profile data from route params (`accountName` + optional `provider`)
- Profile data is stored in `ProfileService` for component access
- `checkSigner(signer)` runs when there's a stored signer in `sessionStorage`

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