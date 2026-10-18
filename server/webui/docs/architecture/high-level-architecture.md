# Detailed architecture

This diagram groups actual modules by responsibility rather than listing every
store method. See the [simplified view](high-level-architecture-simplified.md)
for the main runtime boundaries.

```mermaid
flowchart TB
    subgraph Browser["Browser — SvelteKit / Svelte 5"]
        Routes["Routes: / and /chat/[id]<br/>+layout.svelte"]
        ChatUI["ChatScreen, ChatForm, ChatMessage<br/>ChatSidebar, ModelsSelector"]
        SettingsUI["Settings, Tools and MCP components<br/>Permission prompts / resource previews"]
        Render["MarkdownContent<br/>Local charts and safe Mermaid subset<br/>Preview / PNG / SVG; charts also CSV"]

        subgraph Stores["Reactive stores"]
            Chat["chatStore<br/>Send / edit / branch / stop<br/>Per-chat streaming state and callbacks"]
            Conv["conversationsStore<br/>History, active branch, per-chat MCP overrides"]
            Models["modelsStore<br/>Source-scoped lists, selection, capabilities<br/>Native props cache and router operations"]
            Connection["providerConnectionStore<br/>Adapter connection validation"]
            Server["serverStore<br/>Native props, MODEL / ROUTER role"]
            Settings["settingsStore<br/>Committed config / Settings draft"]
            Agent["agenticStore<br/>Multi-turn loop and cancellation"]
            Tools["toolsStore + permissionsStore<br/>Enabled, unambiguous tools and approvals"]
            MCPStores["mcpStore + mcpResourceStore<br/>Connections, tools, prompts, resources"]
        end

        Lifecycle["sourceLifecycleService<br/>Cancel old-source work and refresh tools/MCP"]
        ChatSvc["ChatService<br/>Normalize messages/attachments<br/>Request-local response instructions<br/>SseByteParser and normalized callbacks"]
        ModelsSvc["ModelsService.list<br/>Delegate discovery to adapter"]
        NativeSvc["Native helpers<br/>PropsService / router ModelsService / ToolsService<br/>api-fetch through provider transport"]
        Protocol["provider-capabilities<br/>Source/model snapshot, tri-state features<br/>connectionProtocol selects handling"]
        DB["DatabaseService / Dexie"]
        ParamSync["ParameterSyncService<br/>Native server-default extraction / merge"]
        MCPSvc["MCPService / MCP SDK<br/>WebSocket, Streamable HTTP, legacy SSE"]

        subgraph Providers["Provider registry and adapters"]
            Llama["llama-server.provider<br/>Native Chat Completions payload / parsing"]
            OpenAI["openai-compatible.provider<br/>Shared createOpenAiProvider"]
            Vllm["vllm.provider<br/>Shared protocols + flat extensions / metrics"]
            ChatProtocol["openai-chat.protocol"]
            Responses["openai-responses.protocol<br/>Full history, store:false, function call IDs"]
        end

        Transport["provider-transport<br/>Allowed endpoint/method + routing headers<br/>fetch, AbortSignal, credentials omitted"]
        IDB["IndexedDB: LlamacppWebui<br/>Conversations / messages / branches<br/>Source-bound Responses continuation items"]
        LS["localStorage<br/>Settings, overrides, favorites, tool permissions<br/>Native resumable-stream identity/offset"]
    end

    subgraph Gateway["Same-origin gateway — alternative environments"]
        Dev["scripts/dev-gateway.ts<br/>Middleware inside Vite dev process"]
        Prod["Installer-generated Caddy site<br/>Static UI + production gateway"]
    end

    subgraph Backends["Separate inference backends"]
        NativeAPI["llama-server<br/>Chat Completions, models, props<br/>Router load/unload, tools, slots, resume V2<br/>Optional native MCP CORS proxy"]
        VllmAPI["vLLM<br/>Models, Chat Completions / Responses<br/>Optional per-request usage/metrics"]
        CompatAPI["OpenAI-compatible backend<br/>Models, Chat Completions / Responses"]
    end
    ExternalMCP["External MCP servers"]

    Routes --> ChatUI & SettingsUI
    Routes --> Connection & Server & Lifecycle & MCPStores
    ChatUI --> Chat & Conv & Models
    ChatUI --> Render
    SettingsUI --> Settings & Tools & MCPStores & Agent
    Settings --> LS
    Settings --> ParamSync
    Server --> ParamSync
    ParamSync -. defaults applied by settingsStore .-> Settings
    Chat --> Conv & DB & ChatSvc & Agent
    Conv --> DB
    DB --> IDB
    Models --> ModelsSvc & NativeSvc & Protocol
    Connection --> Providers
    Server --> NativeSvc
    Lifecycle --> Chat & Agent & Tools & MCPStores
    Agent --> ChatSvc & Tools
    Tools --> NativeSvc & MCPStores & LS
    MCPStores --> MCPSvc
    MCPSvc <--> ExternalMCP
    MCPSvc -. optional native proxy .-> Transport
    ChatSvc --> Protocol
    ChatSvc --> Providers
    ModelsSvc --> Providers
    Protocol -. chosen protocol / feature evidence .-> Providers
    OpenAI & Vllm --> ChatProtocol & Responses
    Llama & OpenAI & Vllm --> Transport
    NativeSvc --> Transport
    ChatSvc -. native resume / pre-encode .-> Transport
    ChatSvc -. native resume state .-> LS
    Transport <--> Dev & Prod
    Dev & Prod <--> NativeAPI & VllmAPI & CompatAPI
    NativeAPI -. proxy forwards MCP traffic .-> ExternalMCP
```

## Provider and protocol boundaries

- `ApiProviderAdapter` owns connection validation, model discovery, payload building
  and response/stream parsing. Despite the historical `buildChatCompletionRequest`
  name, the vLLM/OpenAI-compatible adapters can build **Responses** requests too.
- `modelsStore.refreshCapabilities()` uses model-list metadata already fetched for
  the current source; it is not an extra inference probe. Static adapter support
  and runtime model evidence are separate. Missing metadata stays **unknown**.
- llama-server always uses Chat Completions. Compatible providers prefer it when
  both protocols are declared, default to it without evidence, and use Responses
  only for an explicit requirement. There is no automatic POST retry/fallback.
  See [models and capability selection](../flows/models-flow.md).
- `ChatService` consumes normalized provider events. Native prompt progress/timings
  are not universal SSE fields; other providers expose usage/outcomes when supplied.
  vLLM client speed estimates are distinct from backend timings. The diagnostic
  `readVllmTelemetry()` helper is not a UI polling service or chat-turn metric source.

## Transport and persistence

All provider HTTP requests go through `/__llampart/api/{provider}/{endpoint}`.
The Vite middleware and installed Caddy validate routing metadata and allowlisted
endpoint/method pairs, strip routing headers/cookies, and stream upstream responses.
Cancellation closes the upstream request. These are trusted-LAN gateways, not
authentication services or destination/DNS/IP firewalls. `vite preview` does not
install the dev middleware. See the [frontend guide](../../README.md) and
[production gateway contract](../../../../docs/installation/linux-caddy.md).

Conversation/message branches and stream checkpoints are persisted through
`DatabaseService`. Native resumable identity/byte offsets additionally use localStorage.
Responses continuation items stay in local IndexedDB and are bound to source, credential
fingerprint, protocol and model; they are not a backend-stored conversation.
Rendering charts/diagrams does not add storage tables or a rendering service.

## Tools, MCP and native-only helpers

The agentic loop uses enabled, uniquely resolved entries from `toolsStore`, checks
permissions, executes tools and appends results before the next `ChatService` call.
Direct MCP connections work independently of the inference provider. Only llama-server
provides native built-in `/tools` and optional `/cors-proxy`; proxied MCP requests
use the frozen native address/key, separately from target MCP authentication headers.

Props/default synchronization, MODEL/ROUTER role detection, model load/unload,
chat-template inspection, slots/pre-encode, prompt progress and resumable V2 remain
native integrations. See [chat](../flows/chat-flow.md), [models](../flows/models-flow.md),
[server](../flows/server-flow.md) and [MCP](../flows/mcp-flow.md).
