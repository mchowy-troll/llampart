# Reasoning contract

## One data path

```text
source + exact model metadata / native model-specific /props
    → resolveReasoningCapabilities(owner, evidence, optional user declaration)
    → ReasoningCapabilities → resolveReasoning(capabilities, ReasoningIntent)
    → composer choices / explicit unavailable warning
    → synchronous generation entry: conversation + intent + API options + OperationModel
    → immutable provider context + model + capability promise/snapshot + protocol
    → same resolveReasoning() → provider serializer → JSON
```

`ReasoningIntent` is Default/Auto, Off, On, or an **exact** effort string. Availability
and effort control each distinguish `supported`, `unsupported`, and `unknown`.
Absence is unknown, not unsupported. Default emits no override; it is not Off.
`high`, `xhigh`, and `max` are different values. No name-based model exceptions,
global level list, effort aliases, or effort-to-token-budget substitutions exist.

## Ownership and operation lifetime

ChatStore captures the conversation's intent, request options, provider context,
effective model and capability discovery **synchronously before the first await**
in send/edit/regenerate/branch operations. Existing conversations use the captured
conversation object, not a getter of the later active view. A new conversation's
intent is captured from pending preferences and its newly created ID is bound
without rereading the UI. The capability promise is started at this boundary;
available evidence and explicit declarations are captured before discovery awaits.
Snapshots and their reasoning/feature collections are frozen before publication.

The same `OperationModel` passes through every tool result and agent turn.
ChatService gives its intent priority over incidental per-call options and checks
conversation ownership. Serializers validate provider, source, model, generation,
connection identity and protocol ownership. A source change follows the existing
abort/stale-source lifecycle; it never redirects an in-flight request. A model or
view change alone cannot replace its operation's contract.

Auxiliary title generation uses the captured model/provider but creates its own
intent: confirmed Off if available, otherwise Default. It never reads the active
conversation or injects llama-specific kwargs into a compatible API.

## Evidence priority and llama-server

1. **Explicit model/server metadata.** Normalized
   `capabilities.reasoning_effort: { supported, values }`, or native
   `chat_template_caps.reasoning_effort_values` if the server actually publishes
   that extension. Upstream `supports_reasoning_effort` is a boolean, **not a level
   list**. An explicit negative declaration wins over compatibility evidence.
2. **Controlled template formatting is validation, not automatic discovery.**
   llama.cpp `/apply-template` uses the chat request parser without inference.
   A successful response alone cannot distinguish accepted effort from ignored
   effort. Differential prompts plus a rejecting invalid control can validate
   already declared values for a specific template. It cannot enumerate an
   unknown domain. The production gateway/transport allowlist does not expose
   `/apply-template`; the browser therefore does not probe it or bypass the gateway.
3. **Bounded compatibility evidence.** `llama-reasoning-compat.ts` tokenizes Jinja
   tags; it is not an interpreter. It recognizes literal list/tuple membership
   guards immediately followed by an unconditional `raise_exception` and `endif`.
   A uniquely assigned alias can refer to `reasoning_effort` or
   `reasoning_strength`, optionally through a literal `default(...)` filter; a
   uniquely assigned literal list/tuple is also allowed. This covers the observed
   alias/default/tuple shape, not just one regex spelling. Dynamic/reassigned aliases,
   conflicting guards, conditional raises, comments, raw blocks, unused macros,
   unrelated conditional scopes and error-message text do not establish levels.
   Direct output and boolean thinking branches establish only parameter/toggle
   evidence, never a guessed effort domain. Only top-level or recognized positive
   thinking scopes establish evidence. Unrecognized syntax remains unknown.
4. **Explicit advanced user declaration.** If native effort support is confirmed
   but its levels are unknown, the composer offers an advanced, clearly labelled
   declaration of exact comma-separated backend-documented values. It is not
   called detection or verification. Metadata/template evidence takes precedence.
   Values are validated (1–16 distinct names, up to 64 characters, restricted
   identifier alphabet). At most 32 contracts are retained. The key hashes the
   provider, endpoint, credential-bound connection identity, exact model,
   protocol, template, model path and server build. A changed contract cannot
   inherit the declaration. Native MODEL mode uses its wire model identity (`null`)
   plus template/path; router mode uses the exact model ID. Declarations persist
   in the central settings schema, reset with global Reset, and can be removed.
5. **Unknown:** Default/Auto, honest explanation, no manufactured levels. A boolean
   effort capability alone does not guarantee that any particular level is valid.

There is no background probing, inference for discovery, private message upload,
new gateway endpoint, or per-dropdown network scan. Existing source/model `/props`
caching and stale-result protection remain responsible for metadata lifecycle.

Native requests use confirmed `chat_template_kwargs.reasoning_effort`; older
strength-only templates use their confirmed `reasoning_strength` variable.
Caps-aware llama.cpp binds the canonical variable to its template aliases.
`enable_thinking` is independent and requires evidence. A selected effort also
enables an independently confirmed toggle, so it cannot inherit a disabled template
default. `--reasoning` (on/off/auto), `--reasoning-effort` (template choice), and
`--reasoning-budget` (token limit) are distinct contracts.

## vLLM and OpenAI-compatible

- **vLLM:** explicit per-model declarations, never native Jinja parsing. Chat
  Completions uses `reasoning_effort`; declared Responses uses `reasoning.effort`.
  `enable_thinking` requires explicit support for both it and kwargs. With a
  confirmed independent toggle, an effort sends `true`, Off sends only `false`.
  Without such evidence, only effort is sent. Current vLLM Chat code automatically
  derives thinking from effort when no explicit toggle is supplied; older versions
  need their actual contract declared. No kwargs are copied from llama.cpp.
- **OpenAI-compatible:** the same distinct protocol shapes, gated by actual
  model capabilities, not provider branding. No automatic native toggle kwargs.
  A declared `none` can establish effort-based Off, but is not assumed everywhere.
- Responses builds common non-reasoning fields through the Chat builder, then
  serializes reasoning **once**, in the Responses adapter. It never translates a
  secretly added Chat effort or adds an unconfirmed `summary: auto` requirement.
  Exact provider/source/model/protocol binding of encrypted continuation remains.

Ordinary vLLM/OpenAI-compatible model lists often omit reasoning domains. This is
not treated as proof of unsupported reasoning, nor as permission to emit arbitrary
automatic values. The native advanced declaration is intentionally not a global
override for other providers or models.

## Persistence, unavailable preferences and Custom JSON

Legacy `thinkingEnabled` and `reasoningEffort` are read without rewriting history:
false is Off, an exact saved effort stays exact, true without an effort is On.
New preferences use the optional conversation `reasoning` field. A saved unsupported
choice remains visible in the tooltip and an explicit localized warning; a new
request is rejected until the user chooses a supported option or Default. It is
never silently converted to Default or another effort. Existing running operations
remain unchanged. New UI messages are localized in all six supported languages.

The shared serializer boundary rejects contradictory/multiple Custom JSON reasoning
representations, known unsupported features/values, and protocol-inappropriate
shapes. Native managed controls retain their conflict policy even in Default.
With Default and unknown support, explicit Custom JSON retains the existing opt-in
extension policy; this does not promote it to discovered capability. Unrelated
kwargs remain intact. vLLM's extension mapper cannot overwrite reasoning through
an unchecked options-level kwargs path. Malformed JSON is not silently ignored.

## Validation boundaries

Unit/integration tests capture **serialized requests** after a controlled A→B
navigation, both before first generation and after a paused tool execution, for
native Chat, vLLM Chat/Responses and compatible Chat/Responses. They also cover
metadata precedence, exact domains without `high`, explicit unsupported, unknown,
independent toggles, declaration isolation and source/protocol contamination.

`tests/unit/reasoning-live-backend.test.ts` is opt-in with
`LLAMPART_LIVE_REASONING_URL=http://127.0.0.1:8000`; normal unit runs skip it. It
uses only constant synthetic messages, bounded formatting requests and one short
generation (8 output tokens). No server restart/model switch is performed. Its
output explicitly distinguishes a real effort request from a current backend
without discoverable levels. Mock success is not real backend compatibility proof.

During this review, llama-server b11554-966baae76 exposed an alias/tuple domain
`xhigh, medium, low`; real `/apply-template` produced distinct prompts and rejected
an invalid value. The externally managed server briefly changed to another model
with explicit effort=false (the first integration attempt correctly failed to
discover levels). It later exposed the original contract again; the next opt-in
test accepted an actual serialized `xhigh` + confirmed `enable_thinking: true`
generation, limited to eight output tokens. No server changes were made by the
test. No live vLLM or compatible server compatibility claim is made from mocks.

References: llama.cpp server README and `tools/server/server-common.cpp`,
`tools/server/server-context.cpp` (`post_apply_template`), `common/chat.cpp`
(canonical template binding); vLLM Chat/Responses protocol request processing.
