# Native llama-server MODEL mode — simplified data flow

This is the single-model llama.cpp integration, not a universal provider mode.
Services/adapters and the same-origin gateway (Vite development or installed Caddy)
are omitted for readability. The backend runs separately.
See the general [chat](chat-flow.md), [models](models-flow.md) and
[server](server-flow.md) flows for all three providers.

```mermaid
%% Native llama-server MODEL mode (single model)
%% Detailed flows: server-flow.md, models-flow.md, chat-flow.md

sequenceDiagram
    participant User as 👤 User
    participant UI as 🧩 UI
    participant Stores as 🗄️ Stores
    participant DB as 💾 IndexedDB
    participant API as 🌐 llama-server

    Note over User,API: 🚀 Initialization (see: server-flow.md, models-flow.md)

    UI->>Stores: initialize()
    Stores->>DB: load conversations
    Stores->>API: GET /props?autoload=false
    API-->>Stores: server config + modalities
    Stores->>API: GET /v1/models
    API-->>Stores: single model (displayed from native props)

    Note over User,API: 💬 Chat Flow (see: chat-flow.md)

    User->>UI: send message
    UI->>Stores: sendMessage()
    Stores->>DB: save user message
    Stores->>API: POST /v1/chat/completions (stream)
    loop streaming
        API-->>Stores: SSE chunks
        Stores-->>UI: reactive update
        Stores->>DB: persist stream checkpoint
    end
    API-->>Stores: done + timings
    Stores->>DB: save assistant message

    Note over User,API: 🔁 Regenerate

    User->>UI: regenerate
    Stores->>DB: create message branch
    Note right of Stores: same streaming flow

    Note over User,API: ⏹️ Stop

    User->>UI: stop
    Stores->>DB: save partial response
    Stores->>API: stop native resumable stream if state exists
    Stores->>Stores: abort stream and clear transient state
```
