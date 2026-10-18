# Simplified architecture

The application runs in the browser; inference runs separately. The gateway is
development middleware in Vite **or**, in the installed production setup, Caddy —
not another application service.

```mermaid
flowchart TB
    UI["SvelteKit routes and Svelte components<br/>Chat, model selector, Settings, Tools and MCP"]
    Stores["Reactive stores<br/>Chat, conversations, models, connection, settings"]
    Services["ChatService, ModelsService<br/>Provider-specific helpers where supported"]
    Adapters["Provider adapters<br/>llama-server / vLLM / OpenAI-compatible<br/>Payloads and response parsing"]
    Protocol["Protocol from model metadata<br/>Chat Completions by default<br/>Responses only when explicitly required"]
    Transport["Browser fetch + same-origin routing headers<br/>JSON or SSE"]
    Gateway["Provider gateway<br/>Vite in development OR Caddy in production"]
    Backends["Separate inference backends<br/>llama-server / vLLM / OpenAI-compatible server"]
    History["IndexedDB<br/>Conversations and message branches"]
    Settings["localStorage<br/>Settings, tool preferences, resume checkpoints"]
    Agent["agenticStore + toolsStore + permissionsStore"]
    MCP["mcpStore / mcpResourceStore + MCPService"]
    ExternalMCP["External MCP servers<br/>Direct WebSocket / Streamable HTTP / SSE"]

    UI <--> Stores
    Stores --> Services
    Services --> Adapters
    Stores -. capabilities .-> Protocol
    Protocol -. selects adapter handling .-> Adapters
    Adapters --> Transport
    Transport <--> Gateway
    Gateway <--> Backends
    Stores --> History
    Stores --> Settings
    Stores --> Agent
    Agent --> Services
    Agent --> MCP
    MCP <--> ExternalMCP
    MCP -. optional native CORS proxy, llama-server only .-> Transport
    Agent -. native built-in tools, llama-server only .-> Transport
```

- `DatabaseService` owns IndexedDB access. Settings and tool preferences use existing
  browser storage; the gateway does not store conversation history.
- Tools/agentic orchestration and direct MCP are shared. Native props/defaults,
  router load/unload, built-in `/tools`, pre-encode and resumable V2 are llama-server-only.
- Model capabilities can be supported, unsupported or unknown. Protocol selection
  is metadata-driven, not a generation probe or retry/fallback mechanism.
- Charts and the four allowed Mermaid families render locally in assistant answers.
  Technical documentation can use other Mermaid syntax, such as sequence diagrams;
  that does not expand the application's [rendering allowlist](../diagrams.md).

See the [detailed architecture](high-level-architecture.md),
[chat flow](../flows/chat-flow.md) and [development guide](../../README.md).
