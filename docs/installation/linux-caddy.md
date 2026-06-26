# llampart Linux installation

This guide documents the llampart Linux+Caddy installer.

The installer deploys a prebuilt llampart Web UI release asset, serves it through Caddy, configures Caddy to start with systemd, and prints the local/LAN URLs to open in a browser. It is intended for normal users who want to run llampart locally, not for Web UI development.

## Supported systems

The installer supports Linux systems with systemd in these distribution families:

- Ubuntu-based distributions
- Arch Linux-based distributions

Other Linux families are out of scope for the first installer version. If Caddy is already installed manually, some unsupported systems may be usable with `--skip-caddy-install`, but the installer will not guess distribution-specific Caddy installation commands.

## What the installer does

The installer:

- downloads the selected prebuilt llampart Web UI release asset
- verifies the release checksum
- installs the Web UI into a versioned release directory
- points `/srv/llampart/current` to the active release
- installs Caddy if it is missing and the distribution is supported
- writes a dedicated llampart Caddy config
- validates Caddy configuration before reload/restart
- enables Caddy autostart through systemd
- smoke-tests the Web UI
- checks the backend as warning-only
- writes an installation manifest
- prints local and LAN URLs

The installer does not install:

- `llama-server`
- Ollama
- LM Studio
- model files
- Node.js
- npm dependencies
- development tools
- Docker or Podman

## One-command installation

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash
```

By default, llampart is served on:

```text
http://localhost:8100/#/
```

The default backend proxy target is:

```text
http://127.0.0.1:8080
```

The backend must be started separately. If your backend requires an API key, configure it inside llampart after opening the Web UI.

## Safer inspect-before-run installation

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh -o install.sh
less install.sh
bash install.sh
```

## Common commands

Install or run the interactive installer:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash
```

Update to the latest available release asset:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --update
```

Reinstall the selected or current version:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --reinstall
```

Change ports or Caddy configuration:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --configure
```

Uninstall llampart-owned configuration and metadata, while keeping Caddy installed:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --uninstall
```

Uninstall and also remove llampart release/download files under `/opt/llampart`:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --uninstall --purge
```

Install a specific release version:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --version vX.Y.Z
```

Use a custom public llampart port:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --port 8101
```

Use a custom backend port:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --llama-server-port 8081
```

Select the installer language non-interactively:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --language pl
```

## Installer modes

```text
--install      Fresh install, or install the selected version.
--update       Update to the latest or selected version.
--reinstall    Reinstall the current, latest, or selected version.
--configure    Change Caddy and port configuration without changing the Web UI version.
--uninstall    Remove llampart-owned Caddy config and installation metadata.
```

If an existing installation is detected and no mode is provided, the installer can present an interactive menu.

## Options

```text
--version vX.Y.Z           Install, update, or reinstall a specific release version.
--port PORT                Public llampart/Caddy port. Default: 8100.
--llama-server-port PORT   Local backend port. Default: 8080.
--backend-host HOST        Backend host for Caddy reverse proxy. Default: 127.0.0.1.
--language CODE            Installer language: en, pl, de, es, fr, it.
--skip-caddy-install       Do not install Caddy if it is missing.
--skip-caddy-config        Do not write or reload the llampart Caddy config.
--cleanup-old-releases     Remove older release directories after success.
--keep-releases N          Number of newest releases to keep during cleanup. Default: 2.
--purge                    With --uninstall, also delete /opt/llampart release/download files.
--yes                      Non-interactive mode; accept safe defaults.
--dry-run                  Print the plan and exit before privileged changes.
--no-color                 Disable colorized output.
--help                     Show help.
```

## Environment variables

Command-line flags have priority over environment variables.

```text
LLAMPART_INSTALL_MODE=install|update|reinstall|configure|uninstall
LLAMPART_VERSION=vX.Y.Z
LLAMPART_PORT=8100
LLAMPART_LLAMA_SERVER_PORT=8080
LLAMPART_BACKEND_HOST=127.0.0.1
LLAMPART_LANGUAGE=pl
LLAMPART_ASSUME_YES=1
LLAMPART_DRY_RUN=1
LLAMPART_NO_COLOR=1
```

## File layout

The installer uses versioned releases and a stable symlink:

```text
/opt/llampart/
  releases/
    vX.Y.Z/
    vA.B.C/
  downloads/
  tmp/

/srv/llampart/
  current -> /opt/llampart/releases/vX.Y.Z

/etc/caddy/
  Caddyfile
  conf.d/
    llampart.caddy

/var/lib/llampart/
  install-manifest.json

/tmp/
  llampart-installer-YYYYMMDD-HHMMSS.XXXXXXXX.log
```

The served Web UI root is:

```text
/srv/llampart/current
```

Installer logs are written to a user-writable temporary file, usually under `/tmp`, and the exact path is printed at the end of the run.

## Caddy behavior and safety

The installer is designed not to damage an existing Caddy setup.

It does not:

- overwrite `/etc/caddy/Caddyfile` wholesale
- delete existing site blocks
- disable unrelated Caddy sites
- delete `/etc/caddy`
- uninstall Caddy
- edit firewall rules

It does:

- use a dedicated file: `/etc/caddy/conf.d/llampart.caddy`
- ensure the main Caddyfile imports `/etc/caddy/conf.d/*.caddy`
- back up Caddy config before editing
- validate Caddy config before reload/restart
- restore backups if validation fails
- reload or restart Caddy only after successful validation

The generated llampart Caddy config serves the Web UI and proxies selected API paths to the configured backend host and port.

The installer-generated Caddy config proxies these same-origin backend paths:

```text
/props
/models
/models/*
/slots
/slots/*
/cors-proxy
/tools
/tools/*
/v1/*
```

These paths are needed for llama-server props, model listing, model lifecycle actions, tools, CORS proxy support, and OpenAI-compatible API requests. The installer intentionally does not proxy `/*`, so static Web UI files continue to be served by Caddy.

## Ports

Default ports:

```text
llampart/Caddy public port: 8100
backend port: 8080
```

If the public llampart port is already busy, interactive mode asks for a different port.

In non-interactive `--yes` mode, a port conflict fails instead of guessing a replacement port.

The installer rejects privileged ports below `1024`.

## Backend behavior

The backend is separate from llampart.

The installer can configure Caddy to proxy default llampart API paths to a local backend, but it does not install or start the backend.

When `Server Address` is left empty in llampart settings, the Web UI uses same-origin relative API requests through the Caddy site, for example:

```text
http://localhost:8100/props
http://localhost:8100/models
http://localhost:8100/slots
```

With the installer-based Caddy setup, users normally do not need to enter `http://127.0.0.1:8080` as the Server Address. That direct backend URL is useful mainly for debugging or custom setups.

Supported backend workflows include:

- local `llama-server`
- a local or remote `OpenAI-compatible` API server configured inside llampart

A backend connection failure is warning-only if the Web UI itself is served correctly. This allows installation to succeed before the backend is started.

## Release assets required

The installer expects release assets on the matching GitHub Release:

```text
llampart-webui-vX.Y.Z.tar.xz
llampart-webui-vX.Y.Z.sha256
```

The tarball must contain the static Web UI with this root layout:

```text
llampart-webui-vX.Y.Z/
  index.html
  200.html
  _app/
  wallpapers/
  other static assets required by the build
```

If the asset or checksum is missing, the installer aborts before deployment.

## Packaging release assets

Maintainers package release assets from an already-built `server/public` directory:

```bash
cd server/webui
bash scripts/package-release-llampart.sh
```

By default, the packager writes release assets to:

```text
$HOME/llampart/release-assets
```

For example, on a typical Linux system this resolves to:

```text
/home/<user>/llampart/release-assets/
```

For release `vX.Y.Z`, the packager creates:

```text
$HOME/llampart/release-assets/llampart-webui-vX.Y.Z.tar.xz
$HOME/llampart/release-assets/llampart-webui-vX.Y.Z.sha256
```

You can choose a different output directory with `--output-dir`.

Build and validation should happen before packaging. The packager does not run npm install, tests, lint, or build.

## Uninstall behavior

Default uninstall removes only llampart-owned configuration and metadata:

- `/etc/caddy/conf.d/llampart.caddy`
- `/srv/llampart/current`, if it is a symlink
- `/var/lib/llampart/install-manifest.json`

Default uninstall keeps:

- Caddy
- `/etc/caddy`
- unrelated Caddy sites
- `/opt/llampart`

Use `--uninstall --purge` to also remove `/opt/llampart`.

The installer validates Caddy configuration before reloading it after uninstall.

## Troubleshooting

### The selected port is already in use

Run the installer interactively and choose another port when asked, or pass a different port:

```bash
bash install.sh --port 8101
```

### Caddy is already installed

The installer reuses the existing Caddy installation. It does not reinstall or replace Caddy.

### Caddy config validation fails

The installer restores the previous Caddy config backup and aborts before reloading Caddy with an invalid configuration.

### The backend does not respond

The Web UI can still be installed and served. Start your backend separately, then refresh llampart.

### LAN URLs are shown but other devices cannot connect

Check your Linux firewall and network settings. The installer does not change firewall rules.

### Release asset download fails

Confirm that the GitHub Release contains both files:

```text
llampart-webui-vX.Y.Z.tar.xz
llampart-webui-vX.Y.Z.sha256
```

## Development install is separate

For Web UI development, use the normal development workflow from the repository root:

```bash
cd server/webui
npm install
npm run dev
```

The Linux installer is for deploying prebuilt release assets, not for development bootstrap.
