# llampart Linux installation

This guide explains the standard Linux installation of llampart with Caddy.

The installer deploys the prebuilt llampart Web UI, serves it through an existing Caddy installation, writes a dedicated llampart Caddy site, and prints the local and home network URLs to open in a browser.

It is intended for normal users who want to run llampart locally. It is not a development setup.

## Requirement

Caddy must already be installed and available as a systemd service.

The llampart installer does not install Caddy.

Install Caddy first using your distribution package manager or the official Caddy instructions:

```text
https://caddyserver.com/docs/install
```

If Caddy is installed but the service is inactive or disabled, the llampart installer can offer to enable and start it.

## Install llampart

Run:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash
```

The installer will show a short menu and a clear plan before asking for your password.

By default, llampart is served at:

```text
http://localhost:8100/#/
```

The default backend proxy target is:

```text
http://127.0.0.1:8080
```

The backend must be started separately.

## Installer menu

When run without a mode, the installer shows an interactive menu:

```text
[1] Install
[2] Update
[3] Configure ports and backend proxy
[4] Uninstall
[5] Exit
```

If no previous llampart installation is detected, the default choice is Install.

If a previous llampart installation is detected, the default choice is Update.

## What the installer does

The installer will:

1. download the latest prebuilt llampart Web UI release
2. verify the release checksum
3. install llampart under `/opt/llampart`
4. point `/srv/llampart/current` to the active release
5. write `/etc/caddy/conf.d/llampart.caddy`
6. validate and reload Caddy
7. show local and home network URLs

## What the installer does not do

The installer will not:

1. install Caddy
2. install `llama-server`
3. install Ollama
4. install LM Studio
5. install model files
6. install Node.js or npm dependencies
7. remove Caddy
8. remove unrelated Caddy sites
9. change firewall rules

## Update llampart

Run:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --update
```

The installer downloads the latest release asset, verifies it, installs it under `/opt/llampart`, updates `/srv/llampart/current`, validates Caddy, reloads Caddy, and shows the llampart URLs.

## Configure ports and backend proxy

Run:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --configure
```

The installer can configure:

1. the public llampart port
2. the backend host
3. the backend proxy port

You can also pass values directly:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --configure --port 8101 --backend-host 127.0.0.1 --backend-port 8081
```

Available options:

```text
--port PORT
--backend-host HOST
--backend-port PORT
```

Default values:

```text
llampart public port: 8100
backend host: 127.0.0.1
backend proxy port: 8080
```

## Uninstall llampart

Run:

```bash
curl -fsSL https://raw.githubusercontent.com/mchowy-troll/llampart/main/install.sh | bash -s -- --uninstall
```

Uninstall removes:

1. `/etc/caddy/conf.d/llampart.caddy`
2. `/srv/llampart/current`
3. `/var/lib/llampart`
4. `/opt/llampart`

Uninstall does not remove:

1. Caddy
2. `/etc/caddy/Caddyfile`
3. unrelated Caddy sites
4. backend servers
5. models

## Caddy behavior

The installer uses a dedicated Caddy site file:

```text
/etc/caddy/conf.d/llampart.caddy
```

It ensures the main Caddyfile imports:

```text
import /etc/caddy/conf.d/*.caddy
```

Before reloading Caddy, the installer validates the Caddy configuration.

If validation fails, the installer restores the previous Caddy configuration backup and stops.

The generated llampart Caddy site serves the Web UI and proxies selected same-origin backend paths:

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

The installer intentionally does not proxy `/*`.

## Backend behavior

The backend is separate from llampart.

The installer configures Caddy to proxy llampart API paths to the selected backend host and port. By default:

```text
http://127.0.0.1:8080
```

When `Server Address` is left empty in llampart settings, the Web UI uses same-origin API requests through the Caddy site.

A backend connection failure is warning-only if the Web UI itself is served correctly. This allows installation to succeed before the backend is started.

## File layout

```text
/opt/llampart/
  releases/
    vX.Y.Z/

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

## Release assets required

The installer expects the latest public GitHub Release to contain:

```text
llampart-webui-vX.Y.Z.tar.xz
llampart-webui-vX.Y.Z.sha256
```

If the asset or checksum is missing, the installer stops before deployment.

## Troubleshooting

### Caddy is not installed

Install Caddy first, then run the llampart installer again.

### Caddy is installed but inactive

The installer can offer to enable and start the existing Caddy systemd service.

### The selected port is already in use

Run the installer interactively and choose another port, or pass a different port:

```bash
bash install.sh --configure --port 8101
```

### The backend does not respond

The Web UI can still be installed and served. Start your backend separately, then refresh llampart.

### Another device cannot open the home network URL

Check your Linux firewall and network settings. The installer does not change firewall rules.

### Release asset download fails

Confirm that the public GitHub Release contains both files:

```text
llampart-webui-vX.Y.Z.tar.xz
llampart-webui-vX.Y.Z.sha256
```

## Development setup is separate

For Web UI development, use the repository workflow:

```bash
cd server/webui
npm install
npm run dev
```

The Linux installer is for deploying prebuilt release assets, not for development bootstrap.
