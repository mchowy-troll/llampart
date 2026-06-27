# llampart

llampart is a local chat Web UI designed for use with `llama-server` and `OpenAI-compatible`.

The project focuses on a polished desktop experience, including a custom Frosted Glass theme, conversation management, model selection, MCP-related UI flows, and careful local settings handling.

## Project status

llampart is being prepared as an open-source project.

Current release:

```text
llampart 1.3.5
```

## Features

llampart builds on the llama.cpp / llama-ui foundation and focuses on a more polished, desktop-oriented local chat experience.

Key llampart features include:

- **Frosted Glass visual theme**
  A custom translucent interface style with wallpaper-backed surfaces, blur, softened panels, redesigned menus, and tuned contrast for everyday desktop use.

- **Wallpaper customization for Frosted Glass**
  Support for bundled wallpapers and a user-selected custom wallpaper. The Frosted Glass wallpaper system also includes a milkiness/readability mode that softens the background and improves text legibility.

- **Two-column tiled conversation sidebar**
  A redesigned conversation sidebar with a tiled layout that can use two columns on wider desktop viewports and adapts to a single-column layout when space is limited.

- **Interface scaling controls**
  llampart includes a local interface scaling option for adjusting the desktop UI size to better fit different displays, resolutions, and personal readability preferences.

- **Conversation organization tools**
  Conversations can show their date and time, be pinned for quick access, and be managed directly from the sidebar. llampart also supports selective conversation deletion and a one-click “delete all conversations” flow that preserves pinned conversations.

- **Localized interface**
  llampart includes interface translations for multiple languages, including English, Polish, German, French, Italian, and Spanish. User-facing settings and chat UI labels are designed to follow the selected interface language.

- **Minimalistic Reasoning and Tools display**
  Optional cleaner presentation for reasoning and tool-related assistant sections, designed to reduce visual noise while keeping reasoning/tool information accessible when needed.

- **Extended chat and interface settings**
  llampart includes additional local settings for the chat experience, including visual theme selection, Frosted Glass wallpaper options, interface scaling, conversation date/time display, message/statistics display behavior, model display preferences, and generation-related chat parameters.

- **Local import/export flows for settings and conversations**
  llampart provides local import/export workflows. Settings export is designed to avoid including sensitive local configuration by default, such as API keys, server connection URLs, and MCP server definitions.

- **Provider-aware connection workflow**
  llampart supports both `llama-server` and `OpenAI-compatible` API servers. The selected provider controls the connection settings, available model-management actions, chat request behavior, and which advanced settings are shown.

- **`OpenAI-compatible` API support**
  llampart can connect to local or remote `OpenAI-compatible` servers, including tools such as LM Studio, Ollama, or another endpoint that supports `/v1/models` and `/v1/chat/completions`. `OpenAI-compatible` mode has its own server URL and API key settings, keeps model selection and favorites scoped to that provider, and hides `llama-server`-specific controls that are not supported by the selected API provider.

- **Local `llama-server` support**
  llampart continues to support `llama-server` as a first-class local backend. When the `llama-server` URL setting is left empty, llampart uses the default local `llama-server` address, typically `http://localhost:8080/`.

- **MCP prompts, resources, and server-related UI flows**
  llampart keeps MCP prompt/resource workflows and server-related UI flows available while integrating them into the customized llampart chat interface.

## Screenshots

### Frosted Glass start screen

![llampart Frosted Glass start screen](docs/assets/screenshots/llampart-main_page-frosted-glass.png)

### Frosted Glass chat

![llampart Frosted Glass chat](docs/assets/screenshots/llampart-chat-frosted-glass.png)

### Dark and light themes

![llampart dark mode chat](docs/assets/screenshots/llampart-chat-dark_mode.png)

![llampart light mode chat](docs/assets/screenshots/llampart-chat-light_mode.png)

### Appearance settings

![llampart Frosted Glass settings](docs/assets/screenshots/llampart-settings-frosted-glass.png)

## Installation

llampart can be installed on supported Linux systems with the bundled installer. The installer deploys the prebuilt llampart Web UI, serves it through Caddy, configures Caddy autostart, and keeps the backend/model server separate. It does not install `llama-server`, Ollama, LM Studio, models, Node.js, npm dependencies, or development tooling.

Supported installer targets are Ubuntu-based and Arch Linux-based distributions with systemd.

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash
```

Full installation, update, configuration, uninstall, file layout, and troubleshooting documentation is available in [the Linux installation guide](docs/installation/linux-caddy.md).

## Optional Caddy deployment

llampart can also be served as a static frontend through Caddy, with selected API requests proxied to a local `llama-server`.

For a practical local/LAN deployment example, see [Deploying llampart with Caddy](docs/deployment/caddy.md).

## Requirements

For normal installed use:

- a supported Linux distribution for the installer: Ubuntu-based or Arch Linux-based
- systemd
- Caddy, installed or installable by the installer
- a separately running backend, such as `llama-server` or an `OpenAI-compatible` API server

For Web UI development:

- Node.js 20 or newer
- npm
- git

## Development

From the repository root:

```bash
cd server/webui
npm install
npm run dev
```

Common validation commands:

```bash
cd server/webui
npm run check
npm run lint
npm run build
```

The production Web UI build is generated into `server/public`.

Release Web UI assets for the installer are packaged from an already-built `server/public` directory with:

```bash
cd server/webui
bash scripts/package-release-llampart.sh
```

## Repository layout

```text
server/
├── public/      # generated frontend build consumed by the server and release packager
└── webui/       # SvelteKit Web UI source, tests, docs, and helper scripts

docs/
└── installation/ # user installation and maintenance documentation
```

The main frontend project lives in:

```text
server/webui
```

The root installer lives at:

```text
install.sh
```

## Relationship to llama.cpp

llampart is based in part on the `llama-ui` work from the `llama.cpp` project and is designed to work with `llama-server` as a local backend.

`llama.cpp` and `llama-server` are separate upstream projects. `OpenAI-compatible` API servers are also separate projects. llampart is not an official llama.cpp project.

See:

- `NOTICE`
- `THIRD_PARTY_LICENSES.md`

for attribution and third-party license information.

## Frontend framework

llampart's frontend is built with Svelte and SvelteKit.

Svelte and SvelteKit are MIT-licensed open-source projects. Their license information is preserved through npm package metadata, installed package license files, and the project third-party license notes.

## Wallpapers

llampart supports a Frosted Glass wallpaper workflow:

- five bundled/default wallpaper slots
- one user-selected custom wallpaper option

The bundled Frosted Glass wallpaper files are part of the public release asset set. Wallpaper photo credits are maintained in `AUTHORS.md` and preserved in `NOTICE`; llampart's About / Welcome dialog links to the authors document.

## Credits

llampart is developed by Marcin Gluziński.

Special thanks to Marcin Stefański (Gdańsk, Poland) and to the Unsplash photographers whose photos are used as bundled Frosted Glass wallpapers. Full project and bundled asset credits are maintained in `AUTHORS.md`.

llampart includes and adapts work from the `llama.cpp` / `llama-ui` foundation. See `AUTHORS.md`, `NOTICE` and `THIRD_PARTY_LICENSES.md` for details.

## License

llampart is released under the MIT License. See `LICENSE`.

Third-party notices and license information are provided in `NOTICE` and `THIRD_PARTY_LICENSES.md`.

This license information is provided for open-source project hygiene and is not legal advice.
