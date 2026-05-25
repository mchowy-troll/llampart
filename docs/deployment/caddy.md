# Deploying llampart with Caddy

This guide shows one practical way to serve llampart as a static frontend with Caddy while proxying API requests to a local `llama-server`.

The example assumes:

- llampart source code is cloned into a normal project directory.
- `llama-server` listens locally on `127.0.0.1:8080`.
- Caddy serves llampart on port `8100`.
- The deployment target is a local desktop or trusted LAN environment.

> Do not expose this example directly to the public internet unless you add the authentication, TLS, firewall, and operational controls you need.

## Build the frontend

From the frontend directory:

```bash
cd server/webui
npm install
npm run build
```

The generated static frontend is written to:

```text
server/public
```

## Copy the build to the Caddy web root

This example uses `/srv/llampart` as the directory served by Caddy:

```bash
sudo mkdir -p /srv/llampart
sudo find /srv/llampart -mindepth 1 -delete
sudo cp -av ../../server/public/. /srv/llampart/
sudo chown -R root:caddy /srv/llampart
sudo find /srv/llampart -type d -exec chmod 755 {} \;
sudo find /srv/llampart -type f -exec chmod 644 {} \;
```

If you run the copy commands from the repository root instead, use:

```bash
sudo mkdir -p /srv/llampart
sudo find /srv/llampart -mindepth 1 -delete
sudo cp -av server/public/. /srv/llampart/
sudo chown -R root:caddy /srv/llampart
sudo find /srv/llampart -type d -exec chmod 755 {} \;
sudo find /srv/llampart -type f -exec chmod 644 {} \;
```

## Example Caddyfile

Edit:

```text
/etc/caddy/Caddyfile
```

Example configuration:

```caddy
:8100 {
    root * /srv/llampart

    @llama_api path /props /models /cors-proxy /tools /tools/* /v1/*
    reverse_proxy @llama_api 127.0.0.1:8080

    file_server
}
```

This serves the static frontend from `/srv/llampart` and sends selected API requests to the local `llama-server`.

## Enable and restart Caddy

```bash
sudo systemctl enable --now caddy
sudo systemctl restart caddy
```

Check status:

```bash
systemctl is-enabled caddy
systemctl status caddy
```

## Open llampart

On the same machine:

```text
http://localhost:8100/#/
```

From another device on the same trusted LAN, use the host machine's LAN IP address:

```text
http://<host-lan-ip>:8100/#/
```

## Notes

- Re-run `npm run build` whenever you want to deploy a new frontend build.
- Caddy serves the last build copied into `/srv/llampart`; it does not run `npm run build` automatically.
- `llama-server` must be running separately.
- If your `llama-server` requires an API key, enter it in llampart's settings.
