# Chat flow — all three providers

`chatStore` owns conversation/UI state and persistence callbacks. `ChatService`
normalizes messages and delegates payloads and response parsing to the selected
adapter. The method name `sendMessage` covers both supported conversation protocols.
For model discovery and protocol evidence, see [models-flow.md](models-flow.md).

```mermaid
sequenceDiagram
    participant UI as ChatForm / ChatMessage
    participant Chat as chatStore
    participant Conv as conversationsStore
    participant DB as DatabaseService / IndexedDB
    participant Agent as agenticStore
    participant Tools as toolsStore / permissionsStore
    participant Svc as ChatService
    participant Models as modelsStore / capability snapshot
    participant Adapter as Selected provider adapter
    participant GW as Vite dev OR production Caddy gateway
    participant API as Separate inference backend

    Note over UI,API: Send message
    UI->>Chat: sendMessage(content, extras)
    Chat->>Chat: Lock operation, capture provider context and operation model before awaits
    Chat->>Models: Capture capabilities for that model/source once
    opt No active conversation
        Chat->>Conv: createConversation()
        Note over Conv: See conversations-flow.md
    end
    Chat->>Chat: Consume pending MCP resource attachments as extras
    Chat->>DB: Create user message branch
    Chat->>Conv: Add user message and update current node
    Chat->>DB: Create empty assistant child
    Chat->>Conv: Add assistant message
    Chat->>Chat: Bind assistant AbortController and per-chat loading
    opt Native llama-server ROUTER
        Chat->>Models: Fetch model props if needed (no autoload)
    end
    Note over Chat: Abort/source switch before sending cancels pending work

    alt Agentic configuration enabled and tools become available
        Chat->>Agent: runAgenticFlow(params, callbacks, signal)
        Agent->>Tools: Get enabled, unambiguous entries for frozen source
        Agent->>Svc: sendMessage(history, tool definitions, frozen context)
    else Standard chat (also fallback if agentic flow not handled)
        Chat->>Svc: sendMessage(history, options, conversationId, signal)
    end

    Note over Svc,API: Shared request path for standard chat and each agentic turn
    Svc->>Svc: Use captured operation model (standalone callers resolve once here)
    Svc->>Svc: Normalize DB messages, attachments and tool IDs
    Svc->>Svc: Add request-local chart / Mermaid / response instructions
    Svc->>Models: Await operation's captured capability promise
    Models-->>Svc: Same source/model snapshot for every turn
    Note over Models: Unknown remains unknown; explicit unsupported image fails without removal
    Svc->>Adapter: buildChatCompletionRequest(input, snapshot)
    alt llama-server OR compatible metadata selects/defaults to Chat Completions
        Adapter-->>Svc: Chat Completions payload and gateway fetch request
        Svc->>GW: POST /__llampart/api/{provider}/v1/chat/completions
        GW->>API: POST /v1/chat/completions
    else vLLM / OpenAI-compatible explicitly requires Responses
        Adapter-->>Svc: Responses input, tools/results, store:false
        Svc->>GW: POST /__llampart/api/{provider}/v1/responses
        GW->>API: POST /v1/responses
    end
    Note over GW,API: Gateway streams bytes/status, no generation POST retries

    alt Streaming (normal chat UI path)
        loop Complete SSE records from SseByteParser
            API-->>GW: Provider SSE data and optional event type
            GW-->>Svc: Streamed response bytes
            Svc->>Adapter: Protocol-specific stream parser(data, eventType)
            Adapter-->>Svc: Normalized content / reasoning / tools / model / outcome
            Svc-->>Chat: Callbacks (via agenticStore when active)
            Chat->>Conv: Update active message if this chat is visible
            Chat-->>UI: Reactive content, reasoning and processing state
            Svc-->>Chat: onStreamCheckpoint(accumulated data)
            Chat->>DB: Persist content, reasoning, tool calls, timings, continuation
        end
        Note over Svc,Adapter: Chat parsers recognize DONE, Responses requires its terminal outcome
        Svc-->>Chat: onComplete (agentic turn completion when active)
    else Non-streaming service call
        API-->>GW: JSON response
        GW-->>Svc: JSON response
        Svc->>Adapter: parseResponse(data, protocol) or native parser
        Adapter-->>Svc: Normalized response / usage / outcome
        Svc-->>Chat: Completion callbacks / response text to caller
    end
    Chat->>DB: Persist final message and current node
    Chat->>Chat: Clear loading, streaming and processing state
    opt Native llama-server only, when enabled
        Chat->>Svc: Best-effort pre-encode after completion
        Note over Svc,API: Check native slots, then Chat Completions with n_predict=0
    end

    Note over UI,API: Stop generation
    UI->>Chat: stopGeneration() / stopGenerationForChat(convId)
    Chat->>DB: Save partial response if needed
    opt Native resumable state exists
        Chat->>Svc: stopResumableStream(convId)
        Svc->>GW: DELETE native /v1/stream with stream identity
        GW->>API: Stop native resumable stream
    end
    Chat->>Chat: Abort controller, clear transient UI state
    Note over GW,API: Closing browser fetch closes upstream transport, not a universal backend stop API

    Note over UI,API: Agentic turn continuation (detail)
    loop Until no tool calls, maxTurns, cancellation or error
        Agent->>Svc: Same provider-aware request path, model and capabilities above
        Svc-->>Agent: Parsed response and complete function calls
        Agent-->>Chat: Persist assistant turn through callbacks
        opt Response has tool calls
            loop Each advertised tool call
                Agent->>Tools: Resolve captured entry and request permission
                alt Allowed and entry/source still valid
                    Agent->>Tools: executeTool(entry, args, context, signal)
                    Note over Tools: Built-in via ToolsService + native gateway<br/>MCP via mcpStore.executeToolOnServer + MCPService
                    Tools-->>Agent: Tool result (possibly attachments)
                else Denied, conflicted, unavailable or failed
                    Tools-->>Agent: Denial/error result, not successful execution
                end
                Agent-->>Chat: Create tool-result branch with original call ID
                Chat->>DB: Persist tool result / attachments
            end
            Agent-->>Chat: Create assistant child for next turn
            Note over Agent: Append assistant + results to full history
        end
    end
    Agent-->>Chat: Flow completion / aggregate timings
```

## Protocol, stream and source rules

- `connectionProtocol()` prefers Chat Completions if declared. Otherwise Responses
  requires `capabilities.protocols: ["responses"]`, `required_protocol: "responses"`,
  or `chat_completions: false` with `responses: true`. Missing evidence defaults to
  Chat Completions. Mere Responses support does not select it; there is no automatic
  retry with another protocol after 404/405 or another generation error.
- Responses sends full local history with `store:false`, not `previous_response_id`
  or a backend-stored conversation. Function-call/result IDs are preserved. Opaque
  reasoning continuation items are persisted locally and replayed only for the
  matching source, credential fingerprint, protocol and model.
- SSE framing is shared; payload parsing is adapter/protocol-owned. Reasoning, tool
  deltas, usage, refusal and outcome fields depend on the protocol/backend. Native
  `prompt_progress` and llama timings are not expected from every provider.
- vLLM Chat streaming requests include cumulative usage options unless metadata
  explicitly denies them. Increasing token snapshots can supply a labeled approximate
  client speed; backend timings/metrics remain separate, and missing values are not
  fabricated from server-wide `/metrics`.
- Only llama-server creates resumable state. Its V2 lookup and byte-offset reattach
  endpoints are optional; unsupported endpoints clear resume state. Compatible
  providers do not use native resume APIs or replay a generation POST on disconnect.
  An incomplete non-resumable stream without a terminal event is an error, not success.
- Changing the provider source invalidates request contexts and cancels chat/agentic
  work through `sourceLifecycleService`; native tools and MCP connections are refreshed.

## Branching, continuation and errors

- Regenerate creates an assistant sibling branch through
  `regenerateMessageWithBranching(messageId, modelOverride?)`, then reuses the same
  request path. An explicit override or the target message's model can be reused.
- Continue reuses the existing assistant content; editing a user message with
  branching preserves the old branch and creates a new assistant response.
- Non-abort stream errors invoke the store error callback, clean transient state,
  delete the failed assistant branch with `deleteMessageCascading` where applicable,
  and show the timeout/server dialog. Stop is a separate partial-save/cancellation path.

See [conversations](conversations-flow.md), [server connection](server-flow.md),
[MCP](mcp-flow.md) and [architecture](../architecture/high-level-architecture.md).
