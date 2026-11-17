# Piu-Piu

Decentralized social network like Twitter. Full client-side, no backend, hosted on GitHub Pages. Account creation via URL shortener service (is.gd / v.gd). Auth via WebAuthn only.

## Stack

- Node, Angular 22, Angular CLI (`npx ng`), SCSS
- Tailwind via PostCSS, Taiga UI 5, angular-line-awesome, trystero
- office-addin-dev-certs for local SSL

## Rules

- TypeScript, no comments, `null === var` syntax
- Never use `--legacy-peer-deps`
- Update AGENTS.md according to prompts from AI chat

## Commands

- `npm start` - serve locally
- `npm run build` - production build
- `npm test` - tests

## Release

GitHub Pages via `pull_request.yml` workflow.

## Register screen

- Creates WebAuth credentials
- User chooses username; account name from shortener
- Encode profile URL, shorten it; account name becomes short url
- Display `#@account-name` URL
