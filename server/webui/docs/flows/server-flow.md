# Provider connection and native server properties

Connection status is owned by `providerConnectionStore`, not inferred from the
presence of llama.cpp props. `serverStore` is a separate **native llama-server**
props/defaults/role store. All HTTP calls below use the same-origin provider gateway.

```mermaid
sequenceDiagram
    participant UI as +layout.svelte / Settings
    participant Conn as providerConnectionStore
    participant Adapter as Selected provider adapter
    participant Server as serverStore
    participant Props as PropsService
    participant Settings as settingsStore
    participant GW as Vite dev OR production Caddy
    participant API as Separate backend

    UI->>Conn: check(saved provider, address, key)
    Conn->>Conn: Deduplicate same-source checks, queue newer source
    Conn->>Adapter: validateConnection(input)
    alt llama-server
        Adapter->>GW: GET native /props
        GW->>API: GET /props
        API-->>Adapter: Status/content-type/JSON via gateway
        Note over Adapter: Validate default_generation_settings and build_info
    else vLLM / OpenAI-compatible
        Adapter->>GW: GET provider /v1/models
        GW->>API: GET /v1/models
        API-->>Adapter: Status/content-type/JSON via gateway
        Note over Adapter: Validate object=list and model IDs, no props probe
    end
    Adapter-->>Conn: ok / error
    Conn-->>UI: checking / connected / disconnected

    alt Adapter supportsServerProps and connection is established
        UI->>Server: fetch() when props absent
        Note over Server: modelsStore may also request native props during list initialization
        Server->>Server: Capture source/generation, deduplicate fetchPromise
        Server->>Props: fetch(context)
        Props->>GW: GET native /props?autoload=false
        GW->>API: GET /props?autoload=false
        API-->>Props: Native props via gateway
        Props-->>Server: Props
        Server->>Server: Discard stale result, else store props and detect role
        Note over Server: role=ROUTER only for props.role=router, otherwise MODEL
        UI->>Settings: syncWithServerDefaults() when props arrive
    else No native props support
        UI->>Server: Clear stale props if present, do not fetch
        Note over Server,API: No /props, native role/defaults or props error required for compatible providers
    end

    Note over UI,API: Saved source change
    UI->>UI: sourceLifecycleService.switchSource(source, MCP overrides)
    Note over UI: Cancel chat/agentic work, clear native tools<br/>refresh MCP/proxy and built-in tools only where supported
    UI->>Server: clear()
    UI->>UI: modelsStore.clear(), revalidate connection and reload models
```

## Native props consumers

`PropsService.fetch()` and `fetchForModel()` default to `autoload=false`; per-model
requests add `model=ID`. Global props in MODEL mode describe the single model;
ROUTER mode needs per-model props for model-specific information. Neither endpoint
is part of the vLLM/OpenAI-compatible discovery path.

`serverStore` exposes:

- `defaultParams`: `default_generation_settings.params`, or `null`.
- `contextSize`: numeric `default_generation_settings.n_ctx`, or `null`.
- `webuiSettings`: `ui_settings` with `webui_settings` as fallback.
- `isRouterMode` / `isModelMode`, derived from the native role.
- `hasCurrentProps`, checking provider/address/key ownership.

Native props feed model information/modalities, settings default synchronization
(through `ParameterSyncService`), chat-template reasoning controls and context size.
They are not a shared backend contract. Compatible models use explicit model-list
metadata and tri-state capability snapshots instead; absent fields remain unknown.

Concurrent native props calls share `fetchPromise`. Fetch completion checks source
and request generation; `clear()` invalidates pending results and resets props,
error, loading and role. A fetch failure is translated into a localized native props
error; provider-neutral connection failures are reported separately by the connection
store. A failed inference connection does not prevent the static UI from loading.

## Gateway scope

The browser calls `/__llampart/api/{provider}/{endpoint}` with transport-owned routing
headers. Development uses streaming middleware in Vite's existing process; installed
production uses Caddy. There is no automatic inference startup, separate dev gateway
daemon or API gateway in `vite preview`. The gateway validates/strips routing metadata,
forwards Authorization and SSE, and closes upstream requests on browser cancellation.
It has no generation retry or universal capability-detection endpoint.

See [models](models-flow.md), [chat](chat-flow.md), [frontend development](../../README.md)
and [Caddy deployment/security](../../../../docs/installation/linux-caddy.md).
