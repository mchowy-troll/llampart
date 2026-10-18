# Models, selection and capabilities

All providers discover models through their adapter's `listModels()` using
`GET /v1/models`. The result is not a promise of identical metadata or model
management APIs. HTTP requests below pass through the same-origin provider gateway;
the diagram abbreviates that transport. See [server-flow.md](server-flow.md).

```mermaid
sequenceDiagram
    participant UI as ModelsSelector / layout
    participant Models as modelsStore
    participant Server as serverStore
    participant Svc as ModelsService
    participant Adapter as Selected provider adapter
    participant Props as PropsService
    participant API as Backend via provider gateway

    UI->>Models: fetch() on mount / source change
    Models->>Models: Capture source context, deduplicate, clear stale list/selection
    opt llama-server and server props not loaded
        Models->>Server: fetch(context)
        Note over Server: Native props and MODEL/ROUTER role, see server-flow.md
    end
    Models->>Svc: list(context)
    Svc->>Adapter: listModels(address, key)
    Adapter->>API: GET /v1/models
    API-->>Adapter: Model IDs and any explicit metadata
    Adapter-->>Models: Model list via ModelsService
    Models->>Models: Map ModelOption list and retain raw metadata by ID
    Note over Models: Reject stale source/generation results

    alt llama-server MODEL mode
        Models->>Models: Bridge first model modalities/props from serverStore when available
        Note over UI,Models: Single model displayed from alias/path, selector opens model information
    else llama-server ROUTER mode
        UI->>Models: fetchRouterModels() after list/role, or when menu opens
        Models->>Svc: listRouter(context)
        Svc->>API: GET /v1/models
        API-->>Models: Native status.value and router metadata
        loop Loaded or sleeping model IDs
            Models->>Props: fetchForModel(context, modelId)
            Props->>API: GET /props?model=ID&autoload=false
            API-->>Models: Cache native props/modalities when available
        end
        Note over Models: One visible loaded model may be selected automatically<br/>composer can select first loaded model when no selection exists
    else vLLM / OpenAI-compatible
        Models->>Models: Restore source selection, else select first listed exact ID
        Note over Models,API: No props, router status polling, load or unload calls
    end

    Note over UI,API: User selection (default ModelsSelector path)
    UI->>Models: selectModelById(option.id)
    Models->>Models: Set exact ID/model, remember source selection, invalidate capability snapshot
    opt Native ROUTER and selected model is not loaded
        UI->>Models: loadModel(option.model) in background
        Models->>Svc: load(context, modelId)
        Svc->>API: POST /models/load with model and optional extra_args
        API-->>Models: Request accepted (not necessarily loaded yet)
        loop Until LOADED, FAILED, cancellation or 180-second timeout
            Models->>Svc: listRouter(context) via fetchRouterModels()
            Svc->>API: GET /v1/models
            API-->>Models: status.value
            Note over Models: 500 ms between unsettled checks, abort on source change
        end
        Models->>Models: updateModelModalities() through props cache/API
    end

    Note over Models: Capability refresh on selection/layout and before sending
    Models->>Models: refreshCapabilities(requestContext, model)
    Models->>Models: createCapabilitySnapshot(context, model, matching raw metadata)
    Note over Models: Supported / unsupported / unknown, with evidence and source identity<br/>No request to a universal capability endpoint

    opt Native ROUTER unload action
        UI->>Models: unloadModel(modelId)
        Models->>Svc: unload(context, modelId)
        Svc->>API: POST /models/unload with model
        loop Until UNLOADED, FAILED, cancellation or timeout
            Models->>Svc: listRouter(context)
            Svc->>API: GET /v1/models
            API-->>Models: status.value
        end
    end
```

## Selection is not universal model loading

`usesSelectableModelList` is true for native ROUTER mode and providers requiring
`model` in the chat request (vLLM and OpenAI-compatible). Native MODEL mode displays
the single server model. Compatible adapters require the exact discovered ID, not
a guessed alias or a llama.cpp model path. Selection is remembered in memory per
source (provider/address/credential hash/protocol); favorites are stored per provider.

`ModelsSelector` supports an optional `onModelChange` callback. Its default path
selects first, then initiates native router loading if needed. There is no current
`useModelChangeValidation` hook or automatic “load, validate whole conversation,
unload on modality mismatch” selection workflow. Attachment controls consult current
model capability/modalities; `ChatService` also removes historical image parts only
when native modality information explicitly says `vision === false`.
Compatible protocol builders reject explicitly unsupported media input rather than
silently assuming that all historical attachments can be serialized.

Native `isModelLoaded` treats `LOADED` and `SLEEPING` as loaded; polling after a load
waits specifically for `LOADED`. Model props use a source-scoped TTL cache and
deduplicated requests; router props are fetched only for loaded/sleeping models,
with `autoload=false`. These mechanisms do not apply to compatible providers.

## Runtime capability evidence and protocol selection

Static adapter capabilities describe implemented integration, not proof that a
particular runtime/model supports every feature. `createCapabilitySnapshot()` starts
model-dependent features at **unknown**, applies explicit model-list capability
declarations (including constraints), and tracks source generation, identity and model.
`refreshCapabilities()` reads the matching cached model metadata; it does not probe
generation or fetch an assumed `/props` on compatible backends.

- llama-server uses Chat Completions and its separate native props/modalities path.
- vLLM/OpenAI-compatible prefer Chat Completions when declared and default to it
  when evidence is absent. Responses is chosen only for a responses-only protocol
  list, `required_protocol: "responses"`, or explicit Chat denial plus Responses support.
  An explicit positive Chat declaration takes precedence. No manual protocol selector,
  generation probes, automatic protocol retries or fallback after errors are used.
- Missing modality evidence is not a negative declaration. Unknown images/audio
  remain available only where input serialization exists: compatible Chat supports
  current image/audio formats, Responses supports images but not current input audio,
  and native video representation remains llama-server-only.
- Stock vLLM model lists do not prove runtime modalities from architecture or names.
  Explicit `language_model_only: true` metadata overrides positive modality declarations.
  No `/server_info` endpoint or multimodal generation probe is used.
- Optional model context fields such as `max_model_len`/`context_length` may be
  displayed for compatible providers; GGUF details, chat template and native props
  are not assumed to exist for them.

See [chat-flow.md](chat-flow.md) for payload/stream handling and the native-only
[MODEL](data-flow-simplified-model-mode.md) / [ROUTER](data-flow-simplified-router-mode.md)
summaries.
