# Reasoning contract

LLAMPART receives, renders and persists reasoning. The backend, model and chat
template decide whether and how much reasoning to generate. There is no composer
effort selector, preference inheritance, template level discovery or automatic
reasoning request override, including title generation and pre-encode.

## Explicit Custom JSON

Custom JSON is the only application-level opt-in. Chat Completions accepts an
explicit `reasoning_effort`; Responses uses `reasoning.effort`. Template kwargs
remain explicit backend extensions. Validation checks JSON, types, protocol
location, contradictory representations and protected request fields. Known
unsupported provider parameters are rejected. A discovered list of effort values
is not an authoritative restriction on a user's explicit backend parameter.

No automatic `reasoning_format`, `reasoning_control`, `enable_thinking`, effort or
budget is sent. The former `disableReasoningParsing` setting has been retired;
the backend owns extraction/formatting. Raw inline text is displayed as text:
LLAMPART does not claim it can reliably recover a separate reasoning section.

## Reception and persistence

Chat Completions parsers preserve structured reasoning chunks and non-stream
messages. Compatible APIs support `reasoning`, `reasoning_content` and
`reasoningContent`; native llama-server supports `reasoning_content`. Responses
preserves reasoning text/summary events, final output items and opaque encrypted
reasoning used by continuation. `include: ['reasoning.encrypted_content']` requests
continuation context, not an effort level.

`reasoningContent` remains separate from the final message. Streaming status,
Markdown rendering, collapse/expand, statistics, abort, resumable checkpoints,
tool turns and database persistence are independent of generation controls.
`renderReasoningContentAsMarkdown` and `excludeReasoningFromContext` remain active;
the latter controls history/pre-encode content, not model generation.

## Ownership

Operations retain their captured conversation, provider, source generation, exact
model and immutable capability snapshot through persistence and tool awaits.
Changing the active view cannot redirect an operation. Historical control
preferences are ignored; conversation/message content is not deleted or migrated.

Synthetic protocol tests are not proof of live inference compatibility.
