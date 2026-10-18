# MCP connections, tools and resources

Direct MCP is independent of the inference provider. The optional HTTP CORS proxy
is a **llama-server-only** feature, reached through the same-origin provider gateway
with the frozen native source context. Native backend authorization and target MCP
authentication headers are separate. WebSocket uses its direct transport.

```mermaid
sequenceDiagram
    participant UI as Layout / MCP settings / resource browser
    participant Settings as settingsStore
    participant Agent as agenticStore
    participant Tools as toolsStore / permissionsStore
    participant MCP as mcpStore
    participant Res as mcpResourceStore
    participant Svc as MCPService / MCP SDK
    participant Proxy as Gateway + native llama-server CORS proxy
    participant Ext as External MCP server

    Note over UI,Ext: Discovery and connection lifecycle
    UI->>MCP: runHealthChecksForServers() for globally enabled configured servers
    MCP->>Settings: Read config().mcpServers
    Note over Settings: Settings persist config, no separate MCP_SERVERS_LOCALSTORAGE_KEY lookup
    MCP->>Svc: Health-check connection / discovery
    Note over MCP: Startup health checks are distinct from active agentic connections

    Agent->>MCP: ensureInitialized(perChatOverrides)
    MCP->>Settings: Read server entries and resolve per-chat enabled overrides
    MCP->>MCP: Reuse matching config signature / pending init, else rebuild connections
    loop Each selected MCP server
        MCP->>Svc: connect(config, signal, phase/list-changed handlers)
        alt Direct WebSocket / Streamable HTTP / legacy SSE
            Svc->>Ext: Handshake / initialize / discover tools
            Ext-->>Svc: Server capabilities and tools
        else HTTP proxy enabled and native source available
            Svc->>Proxy: Proxied MCP request with frozen native routing/auth
            Proxy->>Ext: MCP request with target MCP headers
            Ext-->>Svc: MCP response via native proxy and gateway
        end
        Svc-->>MCP: Connection
        MCP->>MCP: Commit current-generation connection and rebuild tool index
        Note over MCP: Duplicate API-visible names are conflicted, not renamed with prefixes
    end

    Note over Agent,Ext: Tool execution in the shared agentic loop
    Agent->>Tools: Capture enabled, unambiguous entries for current source
    Agent->>MCP: acquireConnection() for active flow
    Agent->>Tools: Check/request tool permission
    opt Approved MCP entry still available and generation matches
        Agent->>Tools: executeTool(entry, args, context, signal)
        Tools->>MCP: executeToolOnServer(serverId, name, args, signal)
        MCP->>MCP: Check unique owner and live connection
        MCP->>Svc: callTool(connection, args, signal)
        Svc->>Ext: MCP call (direct or native proxy transport above)
        Ext-->>Svc: Tool result / error
        Svc-->>MCP: Normalized result
        opt Expired MCP session
            MCP->>MCP: Reconnect, revalidate tool owner/availability
            MCP->>Svc: Retry call with renewed session
        end
        MCP-->>Agent: Tool result through toolsStore
    end
    Agent->>MCP: releaseConnection() in flow cleanup
    Note over Agent: Chat callbacks persist tool messages/attachments, see chat-flow.md

    Note over UI,Ext: Prompts and resources
    UI->>MCP: getAllPrompts() / getPrompt(server, name, args)
    MCP->>Svc: List/get prompts on capable servers
    Svc->>Ext: MCP prompt request
    Ext-->>UI: Prompt content via service/store
    UI->>MCP: fetchAllResources() / fetchServerResources() / readResource(uri)
    MCP->>Svc: listAllResources() / listAllResourceTemplates() / readResource()
    Svc->>Ext: MCP resource request
    Ext-->>MCP: Resource metadata/content via service
    MCP->>Res: Store resource infos and templates
    UI->>Res: Add attachment, fill/cache read content
    Note over Res: Subscriptions/list-changed notifications update or invalidate resource state
    Note over Res: chatStore consumes pending resource attachments as user-message extras

    Note over UI,Ext: Reconnect / source switch / shutdown
    Ext-->>MCP: Disconnect notification through transport handlers
    MCP->>MCP: Backoff reconnect while current generation and not cancelled
    Note over MCP: Guard concurrent reconnects, invalidate old tool registry entries
    UI->>MCP: shutdown() on lifecycle/config changes
    MCP->>MCP: Increment generation, abort connects/reconnects, clear registries
    MCP->>Svc: Disconnect captured connections, clean resource state
```

The proxy is probed only for the native provider (`HEAD /cors-proxy` through its
gateway). Other providers do not inherit that endpoint: configure a browser-reachable
MCP server with the appropriate CORS/authentication for direct HTTP connections.
Legacy SSE endpoint announcements are rewrapped for the configured MCP origin;
native credentials are not sent to another browser origin.

The inference backend receives function definitions/results through its own adapter;
it does not execute the browser's MCP client. Built-in llama-server tools use
`ToolsService` and `/tools`, not an MCP transport. Name conflicts, disabled entries
and stale source/registry generations are rejected before execution.

See [chat-flow.md](chat-flow.md), [conversations-flow.md](conversations-flow.md) and
the [architecture](../architecture/high-level-architecture.md).
