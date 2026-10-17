# Response preferences

General settings contain a separate Response preferences frame below System
message. Nine independent booleans default to `false`: no Markdown headings,
tables, charts, diagrams, no decorations, concise answers, practical examples, numbered
procedures, and the language of the latest user message. The two labeled groups
use the existing field renderer and checkbox controls. The collapsed read-only
preview uses the same English instruction builder as requests and supports copy.
Only UI labels/help are translated into the six interface languages.

`src/lib/utils/response-preferences.ts` owns the ordered instruction constants and
request-only composition. `ChatService.sendMessage()` composes instructions for
conversation requests, including tool continuations. Auxiliary requests without
a conversation ID (notably title generation) are excluded. The technical chart
format is supplied once by the existing `withChartInstructions()` function:

1. Technical chart format, examples and limits (unchanged supported types:
   `line`, `area`, `bar`, `donut`).
2. Technical Mermaid format (four supported diagram families; see [diagrams](diagrams.md)).
3. Active response preferences, in fixed UI order.
4. Existing manual system message, unchanged.

The preference block explicitly defers to the user's instructions, including the
manual system message. This is an instruction-ordering contract, not a semantic
conflict parser or a guarantee of model compliance. Tables describe structured
comparisons; numbered steps describe procedures. Heading/decoration rules preserve
code, literal quotations and necessary Unicode. Charts need sufficient real data;
the technical format remains optional when the chart preference is disabled.

Composition is immutable and idempotent; an anchored generated block is replaced
if a composed request is passed again with a different snapshot. Neither the
editable System Message nor database messages are modified. Existing conversations
receive current global preferences from their next request, not only at creation.

The Settings draft updates checkbox state and preview immediately. Requests read
a synchronous copy of committed `config()`, never the appearance overlay. Save
uses the existing whole-form validation/commit; closing discards the draft. Reset
uses the existing confirmed reset flow. Persistence, reload, settings export and
import use the existing flat settings schema (boolean validation is derived from
defaults); no new storage, schema version, migration or dependency is needed.

Regression tests: `response-preferences.test.ts`,
`response-preferences-request.test.ts`, `settings-preview.test.ts`, and
`tests/browser/response-preferences.mjs`. Browser/provider fixtures verify request
contents, not actual model compliance. Use a local inference server for exploratory
model behavior checks and report these separately from deterministic tests.
