# Native llama-server ROUTER mode — simplified data flow

This is llama.cpp's native multi-model router integration. vLLM and OpenAI-compatible
model selection does not invoke native load/unload or `/props`. Services/adapters
and the same-origin gateway (Vite development or installed Caddy) are omitted here.
See the general [chat](chat-flow.md), [models](models-flow.md) and
[server](server-flow.md) flows for all three providers.

```mermaid
%% Native llama-server ROUTER mode (multi-model)
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
    API-->>Stores: {role: "router"}
    Stores->>API: GET /v1/models
    API-->>Stores: models[] with native status.value
    loop each loaded or sleeping model
        Stores->>API: GET /props?model=X&autoload=false
        API-->>Stores: modalities (vision/audio)
    end

    Note over User,API: 🔄 Model Selection (see: models-flow.md)

    User->>UI: select model
    Stores->>Stores: set selection
    alt model not loaded
        Stores->>API: POST /models/load
        loop poll status
            Stores->>API: GET /v1/models
            API-->>Stores: check if loaded
        end
        Stores->>API: GET /props?model=X&autoload=false
        API-->>Stores: cache modalities
    end
    Note right of Stores: Attachment actions consult explicit modalities<br/>unknown does not mean unsupported

    Note over User,API: 💬 Chat Flow (see: chat-flow.md)

    User->>UI: send message
    UI->>Stores: sendMessage()
    Stores->>DB: save user message
    Stores->>API: POST /v1/chat/completions {model: X}
    Note right of API: router forwards to model
    loop streaming
        API-->>Stores: SSE chunks + model info
        Stores-->>UI: reactive update
        Stores->>DB: persist stream checkpoint
    end
    API-->>Stores: done + timings
    Stores->>DB: save assistant message + model used

    Note over User,API: 🔁 Regenerate (optional: different model)

    User->>UI: regenerate
    Stores->>DB: create message branch
    Note right of Stores: same streaming flow

    Note over User,API: ⏹️ Stop

    User->>UI: stop
    Stores->>DB: save partial response
    Stores->>API: stop native resumable stream if state exists
    Stores->>Stores: abort stream and clear transient state

    Note over User,API: 🗑️ Backend-managed cache eviction

    Note right of API: Eviction policy belongs to llama-server,<br/>not the browser stores
    User->>UI: select unloaded model
    Note right of Stores: triggers load flow again
```
