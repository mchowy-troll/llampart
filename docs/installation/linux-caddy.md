# llampart Linux installation

This guide explains the standard Linux installation of llampart with Caddy.

The installer deploys the prebuilt llampart Web UI, serves it through an existing Caddy installation, writes a dedicated llampart Caddy site, and prints the local and home network URLs to open in a browser.

It is intended for normal users who want to run llampart locally. It is not a development setup.

## Requirement

Caddy 2.11.4 or newer must already be installed and available as a systemd service. The dynamic gateway is tested with the standard Caddy 2.11.4 binary, without plugins.

The `ss` command from the distribution's `iproute2` package is also required so the installer can verify that the selected port is free. If it is unavailable or the check fails, the installer stops before making changes.

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

The generated llampart Caddy site serves the Web UI and provides the same-origin provider gateway:

```text
/__llampart/api/{provider}/{endpoint}
```

Provider IDs are `llama-server`, `openai-compatible` and `vllm`. Routing metadata is validated independently in Caddy, then removed before forwarding. Only the UI's required endpoint/method pairs are accepted (models, chat completions, Responses for compatible providers, llama-server props/model management/tools/resumable V2/native MCP proxy, and vLLM version/metrics). Query parameters and upstream status codes are preserved. Authorization is forwarded, cookies and routing headers are not. HTTPS verifies certificates and uses the upstream host for SNI and Host. SSE is streamed and cancelling the browser request closes the upstream request.

Legacy installed-backend paths remain for existing releases and the native MCP proxy:

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

An **empty llama-server address selects the gateway's environment default**; it never hardcodes a destination in the browser. The installer configures this fallback to the selected backend host and port and preserves a deliberately configured target on upgrades. Both environments use this standard local default unless configured otherwise:

```text
http://127.0.0.1:8080
```

Choose a provider in Settings, enter its Server Address and optional API key, and save. Each provider keeps separate flat address/key settings. Changes take effect on the next request without restarting Caddy, editing its configuration, or requiring backend CORS. OpenAI-compatible and vLLM require an address and an exact model ID returned by `/v1/models`; a trailing `/v1` is normalized. Base prefixes such as `https://example.com/proxy/v1` are supported.

When the llama-server Server Address is empty, the Web UI uses the installed-backend fallback through the same gateway. `http://0.0.0.0:8080` is a convenience spelling routed to `http://127.0.0.1:8080`. Both `localhost` and `127.0.0.1` mean **the computer running Caddy**, not the browser device. IPv4, bracketed IPv6, LAN addresses, DNS names and remote HTTPS are allowed. HTTP credentials embedded in URLs, queries/fragments in base URLs, malformed ports, CRLF, header injection and ambiguous traversal prefixes are rejected. Self-signed remote certificates must be trusted by the Caddy machine; verification is not disabled.

### Trusted-LAN security boundary

This is a home interface for a trusted private LAN, **not a public multi-user service or SSRF firewall**. The dynamic gateway restricts clients to private/loopback ranges, checks Origin and Sec-Fetch-Site, requires transport-owned routing headers and restricts methods/endpoints. These safeguards prevent accidental unrestricted proxying and browser cross-origin use; they do not authenticate a trusted-LAN client.

There is deliberately **no destination IP policy, DNS-resolution filter, host allowlist or DNS-rebinding protection**. A LAN client can target any valid HTTP/HTTPS host at the allowed endpoints, including local services. DNS may resolve to sensitive addresses. Only use this on a trusted network; do not expose it by port forwarding or an untrusted reverse proxy. These limitations are accepted by the project's architecture, not claimed to be mitigated by URL validation. Provider API keys are kept in browser settings, never placed in routing URLs; Caddy access logging is not enabled by the installer. Transport failures use a generic status-preserving error response rather than dumping credentialed request objects into the default error log. Do not enable global Caddy debug/`log_credentials`, or add logs of Authorization, custom MCP authentication headers or routing request objects. Configure MCP credentials as headers, not URL query parameters.

### Conversation protocols and backend differences

The composer reasoning control is shared by compatible providers; llama.cpp-only parsing and token-budget controls remain native. Custom JSON backend extensions are passed flat, validated where schemas exist, or explicitly rejected with a reason (including confirmed unsupported options); they are never silently dropped. Missing model modality metadata means unknown, not unsupported. Protocol/UI limits remain separate: generic providers support existing image/audio representations, while the native `input_video` representation is llama-server-only and Responses does not serialize input audio. No new media panels are added. Per-request vLLM metrics are connected to response statistics; the separate `readVllmTelemetry()` diagnostic helper is not automatically polled by the UI and does not constitute a server-metrics dashboard.

Adapters choose the conversation protocol internally; there is no protocol control in Settings. Chat Completions is preferred when both protocols are supported and is the default when capabilities are unknown. Responses is used only when model metadata from `/v1/models` explicitly declares `capabilities.required_protocol: "responses"`, `capabilities.protocols: ["responses"]`, or `capabilities.chat_completions: false` together with `capabilities.responses: true`. Mere support for Responses is insufficient. Obsolete saved manual choices are discarded safely. There is no generation probe or automatic fallback (including after 404/405), `previous_response_id`, or backend-stored conversation: Responses sends history with `store:false`. Function calls/results use their original call IDs. Opaque reasoning items needed for stateless continuation stay in local IndexedDB, bound to the provider, address, credential fingerprint, protocol and model; they are not replayed at a different source. Canonical V1 conversation exports and settings exports remain unchanged (no API secrets, connection data, MCP configuration or opaque reasoning continuation are added).

Capabilities are tri-state: supported, unsupported or unknown, scoped to source generation/model/protocol. Model names do not establish reasoning, tools or vision support. Explicit metadata can establish support and constraints; unknown optional parameters are experimental and are sent only when explicitly set. Confirmed unsupported options are omitted. llama-server keeps its native props, defaults, tools, timings and resumable V2. Other providers never probe those native endpoints or create resumable state. MCP servers are still usable directly; the native `/cors-proxy` is only available with llama-server and follows its frozen address/key through the same gateway. Native and target MCP authentication headers remain separate; legacy SSE endpoint events are rewrapped for the configured MCP origin, never given the native key at another browser origin.

Use the existing Custom JSON setting for advanced Chat Completions options (`max_completion_tokens`, `seed`, `stop`, `tool_choice`, `parallel_tool_calls`, `response_format`, `reasoning_effort`). vLLM also maps `top_k`, `min_p`, `repetition_penalty`, `min_tokens`, `stop_token_ids`, `ignore_eos`, `skip_special_tokens`, `truncate_prompt_tokens`, `structured_outputs`, `chat_template_kwargs` and `include_reasoning` as **flat** request fields, never an `extra_body` wrapper. Do not combine both token-limit variants or conflicting structured-output modes. Support varies by model and server version; unsupported backend requests surface as errors, not automatic retries with changed payloads.

In Responses mode, Custom JSON also accepts `instructions`, `max_output_tokens`, `reasoning` (effort/summary) and `text` (verbosity/format). These are serialized as Responses fields, not Chat Completions fields. Choose one token-limit/reasoning/format representation, not both mapped Chat controls and their Responses-specific equivalents. Tools are local function tools; hosted OpenAI tools, background jobs and server-stored conversation state are not part of this chat UI.

Streaming vLLM Chat requests use system-owned `stream_options: { include_usage: true, continuous_usage_stats: true }` unless metadata explicitly denies that extension. Live speed uses increasing cumulative `completion_tokens` snapshots and monotonic client observation time between positive snapshots (including reasoning counted by the backend, excluding prefill/queue waiting). It is shown with `≈` and identified as an approximate client measurement in the existing statistics tooltip. A single final usage snapshot or missing counters does not produce a live speed. Repeated counters are not added; decreasing counters invalidate the client rate. Final backend speed takes precedence. A rejected streaming extension is reported without retry. Existing `--enable-per-request-metrics` and `--enable-force-include-usage` flags need no changes for versions supporting this request contract; older versions may differ.

The attachment menu disables confirmed unsupported modalities without extra hints or tooltips. Unknown stays enabled only where the adapter implements the input format: generic Chat supports images/audio, Responses supports images but not the current audio representation, and native video input remains llama-server-only. Text/PDF actions remain available through their existing processing paths. Stock vLLM `/v1/models` does not report `--language-model-only`; model names/architecture are not proof of runtime support. The gateway deliberately does not expose `/server_info` (configuration and environment data), and standard Caddy has no JSON-field projection here. Thus stock vLLM runtime modalities remain unknown without explicit safe metadata. If a backend supplies `language_model_only: true` in model-list metadata or its capabilities extension, it overrides positive architectural declarations. No multimodal generation probes are performed.

Backend usage includes cached/reasoning tokens when available, including genuine zero values. vLLM per-request metrics use `time_to_first_token_ms`, `generation_time_ms`, `queue_time_ms`, `mean_itl_ms` and `tokens_per_second` only if supplied by the backend. Absent values are shown as unavailable, not fabricated. The familiar reading/generation badges show tokens, backend processing time and backend throughput; TTFT and browser elapsed time are not substituted for prompt processing. Additional metrics remain in the throughput tooltip. The `i` action opens the existing Model information dialog, not telemetry: llama-server retains its native details and chat template, while other providers show the exact model ID and explicit runtime context metadata (`max_model_len` or `context_length`) when available, without probing `/props`. Browser elapsed time is labeled separately and includes transport; `/metrics` is server-wide telemetry and is never attributed to a chat turn. SHA-256 source fingerprints also work on HTTP LAN without `crypto.subtle`; the shipped llama-server identity format remains compatible.

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

If the asset, checksum, `index.html`, `200.html`, or `_app/` directory is missing, the installer stops before deployment.

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
npm ci --include=dev
npm run dev
```

`npm run dev` executes the repository-local Vite, without a global installation. A small streaming middleware in the existing Vite process handles `/__llampart/api` directly, using the same endpoint and routing-header contract as production Caddy. No running Caddy, extra process or gateway configuration is needed. Edit the provider's address and key in Settings; changes apply without restarting Vite. Native MCP uses `/__llampart/api/llama-server/cors-proxy` with frozen metadata. An empty native address selects the development gateway default: `http://127.0.0.1:8080`. Developers may optionally set `LLAMPART_DEV_BACKEND_URL` to a validated HTTP(S) base URL when starting Vite to configure a different environment default; normal startup needs no configuration. In production, the same empty-address sentinel selects the installer's configured backend, not a hardcoded replacement. Explicit UI addresses always override the environment default and work identically in both environments, without restarts. TLS certificates/SNI, HTTP errors, SSE and cancellation are preserved; generation POSTs are never retried. Destination filtering and full SSRF protection remain outside this trusted-LAN contract.

Transport verification (local ephemeral mock backends, no installation/deployment):

```bash
node tests/transport/caddy-gateway.mjs
node tests/transport/caddy-gateway.mjs --vite
bash tests/installer/transaction.sh
```

The Linux installer is for deploying prebuilt release assets, not for development bootstrap.
