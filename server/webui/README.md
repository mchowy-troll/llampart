# llampart WebUI

SvelteKit-based frontend for llampart, designed to work with llama-server as the local backend.

This WebUI lives in `server/webui` and builds into `server/public`, where it can be served by the backend.

## What this directory contains

- chat-focused WebUI for llampart
- local development setup for the llampart Vite/SvelteKit frontend
- static production build output copied into `server/public`
- UI sources, tests, docs, and helper scripts used by frontend work

## Requirements

- Node.js 20.19+ or 22.12+
- npm 9+
- git
- optional: running `llama-server` locally for backend/API access during development

## Repository layout

```text
server/
├── public/      # generated frontend build served by the backend
└── webui/       # SvelteKit source, scripts, tests, docs
```

## Quick start

From the repository root:

```bash
cd server/webui
npm ci
npm run dev
```

This starts the llampart Vite development server at `http://localhost:5173`.

## Local development notes

- `npm run dev` starts the llampart Vite development server.
- `llama-server` is not started automatically. Run it separately if you need real API calls.
- Vite is started with `--insecure-http-parser` because some backend responses may contain malformed header combinations.
- The dev script can install the WebUI git hook automatically if it is missing.

## Available scripts

| Command                 | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `npm run dev`           | Start the llampart Vite dev server          |
| `npm run dev:vite`      | Start the Vite dev server directly          |
| `npm run build`         | Create production build for `server/public` |
| `npm run preview`       | Preview the production build                |
| `npm run check`         | Run Svelte sync + type checks               |
| `npm run lint`          | Run Prettier check and ESLint               |
| `npm run format`        | Format the project with Prettier            |
| `npm run test`          | Run unit tests                              |
| `npm run hooks:install` | Install the WebUI pre-commit hook           |
| `npm run cleanup`       | Remove generated local frontend artifacts   |
| `npm run reset`         | Remove `.svelte-kit` and `node_modules`     |

## Git hook setup

Install the hook manually:

```bash
cd server/webui
npm run hooks:install
```

The installed `pre-commit` hook only runs when staged changes touch `server/webui`.

It currently does this:

1. `npm run format`
2. `npm run lint`
3. `npm run check`

The hook no longer stages frontend build output automatically.

## Build output

`npm run build` writes the static frontend bundle into `server/public`.

High level flow:

```text
server/webui -> SvelteKit static build -> server/public
```

Important pieces:

- `svelte.config.js` targets `../public`
- `scripts/post-build.sh` runs the static build normalizer
- `scripts/normalize-static-build.mjs` prepares final output for backend consumption

## Frontend workflow

Typical loop:

```bash
cd server/webui
npm ci
npm run check
npm run dev
```

Before committing frontend work:

```bash
cd server/webui
npm run format
npm run lint
npm run check
```

## Notes for current llampart work

Current project work has focused mainly on:

- UI/i18n improvements
- terminology consistency across locales
- keeping diffs clean and avoiding unrelated churn

That means frontend changes should stay targeted unless a broader UI or product change is explicitly agreed first.

## Troubleshooting

### Dev script still points to old paths

The current scripts are expected to use `server/webui` and `server/public`.
If you still see `tools/server/webui` anywhere, it should be treated as stale documentation or stale scripting.

### Git hooks do not install

Check that:

- you are inside a real git clone
- `.git/hooks` exists
- the hook file is writable

Then retry:

```bash
cd server/webui
npm run hooks:install
```

### Backend API is unavailable in dev

Start `llama-server` separately and then refresh the WebUI.

## Status of this README

This README is intended to describe the current llampart WebUI layout and local development workflow, not the legacy `tools/server/webui` structure.
