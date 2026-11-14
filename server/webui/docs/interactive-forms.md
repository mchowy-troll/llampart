# llampart-form

In **Settings → Chat**, enable **Interactive AI forms** (off by default). The
model may then choose a form when several answers or choices would help. A normal
answer still uses one model request. A form proposal uses one additional,
tool-free request to describe the controls. This increases latency and token use.

Review the questions before answering. Do not enter passwords, API keys or other
secrets. Changing a field saves a local draft; only an explicit **Send** click
sends a normal user message containing the labelled answers. The usual chat
permissions still apply to subsequent assistant responses.

The button always uses the application's localized `common.send` caption (for
example **Wyślij** in Polish), ignoring the required legacy model label. There
are no form-level submission status notices; field-level validation remains.
Once a durable result owns its user message, that duplicate bubble is omitted
from chat presentation, including during generation and retry. The original
message remains in storage, exports and model context. Hiding requires the
matching usable form to be mounted on the selected branch; otherwise the answer
message remains accessible.

The proposal declares optional introductory context separately from the questions.
After successful form generation only that introduction accompanies the controls;
the question list is used for the fallback, not repeated above the form. No ordinary
Markdown is removed by content heuristics. Earlier unstructured proposals retain
their original prose rather than guessing which explanation can be discarded.

Disabling forms does not remove history. Saved questions and answers remain
readable as text. Saved drafts survive reloads, and exported conversations
include form values and status. Older llampart installations cannot import the
new conversation export envelope when it contains forms.

If sending fails, the form remains pending rather than claiming success. Retry
reuses the saved user message, not a duplicate. Pending answers cannot be edited.
If a draft cannot be saved locally, its values stay in the current session across
navigation and the browser warns before leaving. A forced reload or crash can
still lose values that storage refused to save. Concurrent edits from another
tab are rejected rather than silently overwriting its revision.

Regeneration creates a separate form identity. Branch navigation restores the
form belonging to that branch. Forks get new identities; when the result message
is not copied into the fork, the form becomes a draft with its answers retained.
Editing a form's source leaves its saved data readable but disables interaction.
Editing or deleting its user-result message releases the form back to a draft.

## Implementation boundary

- `forms/form-protocol.ts`: the unversioned first-line marker
  `[[llampart-form]]` and short capability instruction; no Markdown scanning.
- `forms/form-schema.ts`, `types/interactive-forms.ts` and
  `services/interactive-forms.ts`: closed schema, types, tree/answer/history
  validation and text projection, independent of the renderer.
- `services/chat.service.ts`: lazy catalog and bounded supplementary request;
  only a terminal, complete, valid description can become interactive. Interrupted
  requests and interrupted/reloaded format decisions retain readable questions;
  there is no background reconstruction of unfinished form descriptions.
- `stores/chat.svelte.ts`: model decision and the existing send pipeline;
  `stores/conversations.svelte.ts`: draft write queue and session recovery;
  `services/database.service.ts`: transactional persistence, revision checks,
  result reservations, branch cleanup and fork identity mapping.
- `components/app/forms/`: lazy native `@json-render/svelte` renderer and host
  controls. Components do not access the database or perform network requests.
  Only a trusted, explicit host-button activation can authorize submission.
- `utils/conversation-import-export.ts`: strict form validation and result
  ownership checks. Exports without forms keep the existing envelope format;
  form exports use the newer general conversation envelope. The form marker and
  form record themselves have no version field.

Allowed controls: text, email, number, date, textarea, checkbox, checkbox group, radio group, select and slider;
plus containers, group, heading, description and one submit button. Limits:
96 KiB UTF-8 specification, 128 nodes, tree depth 6, 64 children per node,
32 KiB serialized values and 24 options per choice. Shared boundaries are owned
by `forms/form-limits.ts`. First-phase proposals allow 20,000 question characters
within a 64 KiB UTF-8 envelope; source text is bounded to 64 KiB. Rendered answer
text allows 130 KiB, covering expanded choice labels as well as values. Whole
records allow 704 KiB, accounting for JSON escaping of source text, the spec,
both value copies and the serialized answer, with a finite safety margin.
Model-provided HTML, CSS, JavaScript, imports, expressions,
bindings, arbitrary events and tool actions are not part of the schema. All text
is rendered as text, not HTML. Validation is repeated for local history too.

Number uses the browser's numeric input, finite values within ±1e12, optional
minimum/maximum/positive step, and distinguishes zero, empty and invalid input.
Successful results contain numbers, not numeric strings. Date uses the shared
LLAMPART date input and a keyboard-accessible calendar in the existing Popover,
with optional inclusive ISO bounds. Display and manual entry follow the existing
conversation date-order preference (`DD-MM-YYYY` or `MM-DD-YYYY`, with localized
placeholder letters). Valid dates are stored as `YYYY-MM-DD` without time-zone
conversion; incomplete/invalid edits remain local text with the existing invalid
sentinel in form state, so they cannot submit a stale valid date. Changing language
or date order reformats valid ISO values without rewriting history. The calendar uses
the interface language and the current interface accent, not a native OS popup.

The form reuses the shared visualization frame, live typography tokens and the
active wallpaper's sidebar-selection accent. Semantic `Group` sections use the
same light frame geometry as Settings section cards, with an invisible border;
Frosted Glass owns their translucent, non-accented background.
Container/Group `columns` may be 1, 2 or 3; field
`fullWidth` is optional and boolean. Container queries reduce the maximum column
count to fit the form's actual width, with no JavaScript remount or CSS reordering.
Textarea defaults to full width. Only these bounded layout properties are allowed,
never model-supplied CSS. Select uses the existing accessible LLAMPART primitive;
number retains its native browser input and keyboard stepping, with themed
increase/decrease buttons instead of OS-rendered spinner chrome. Explicit steps
use native stepping; unrestricted numbers advance by one, within min/max.
Date, range and selection controls are
owned by shared UI primitives; the form supplies only field semantics and values.

Every field has label, control and feedback tracks. Row subgrids align controls
across mixed field types and wrapped labels; a single boolean checkbox has an
empty, hidden-from-accessibility label slot, not a duplicate visible label.
The host places the compact Submit at the end of the root container, right-aligned
at every column count, including for older saved descriptions. There is no fixed
AI notice or separate horizontal section rule. Each section has its own surface
inside the shared outer visualization frame.
Controls use shared semantic neutral border tokens; Frosted Glass adapts their
contrast to transparent surfaces without changing border thickness.
Control focus uses one thin, 1px wallpaper-accent border, without another outline,
ring or glow; keyboard focus remains visible and does not shift the layout.
Radio keeps its neutral surface and a nominal 9px accent dot painted by a centered
radial gradient in the outer circle's border-box, avoiding independent pixel snapping
of the dot at fractional control sizes.
Submit has no visible border, including on hover/focus; keyboard focus changes
its fill instead, retaining the same geometry.
The shared Settings range owns track/thumb geometry; the form changes only the
active track accent and gives its thumb a darkened wallpaper accent. Other range
callers keep their previous thumb color. The outer form and its sections share one semantic material:
Frosted Glass uses the existing `--llampart-glass-white-110` fill. Section fill
multiplies that material's current alpha by 1.25 (capped at opaque), preserving
its tint and response to Settings without changing the outer frame, blur or shadows.
The opt-in calendar and form Select share a translucent, high-opacity popup fill,
neutral border and interface typography; other application menus are unchanged.
The calendar uses seven equal columns, wider-than-tall day cells and a responsive
23em popup (about 1.35:1 for a five-week month); six-week months remain fully visible.
Relative typography uses 1.08×/semibold section titles, 1× labels and values, and
0.92× secondary help text, all based on the user's actual interface font size.

The host validates through `validateFormValues` and renders localized errors in
each field's feedback track. An invalid Submit focuses the first invalid control
in reading order, after controls are re-enabled. Native constraint metadata is
retained. The host is a `novalidate` form, suppressing native hover validation hints;
`invalid` events are also canceled locally to suppress explicit `reportValidity()`
bubbles. Native submission is prevented; the existing authorized Submit action
still performs application validation. Hovering an invalid field previews its
localized validation message through the shared Tooltip primitive, even before
Submit, without setting inline errors or saving values. Correct fields have no
validation tooltip. Correcting the value closes the tooltip; Submit still owns
inline errors and focus on the first error. Disabled fields have no preview.
Tooltip appearance is exactly the same as the response's Download Markdown action.
Calendar icon actions use that same Tooltip component and localized labels, not
native `title` attributes. The submit caption and field errors react to language
changes without modifying model-authored questions.

`Checkbox` is a boolean (for example accepting terms). `CheckboxGroup` explicitly
represents multiple independent choices, with 2–24 unique options. It stores an
array of selected option values in declaration order, with no duplicates or
unknown values. An optional group allows `[]`; a required group needs at least
one selection, not every checkbox checked. Results, reload, history projection,
fork and import/export preserve this array; the sent text lists selected labels.
Older boolean questions are not guessed or reconstructed from their wording.

Form generation has a 210-second timeout and a 12,000-token output limit. Native
llama-server requests use JSON-object output and disable template thinking for
this auxiliary request only; other adapters receive plain JSON instructions.
No automatic repair or retry request is made when a description is invalid.
Submission requires the browser's Web Locks API (a secure context); if unavailable,
the operation fails closed. Remote provider integration and multi-device
synchronization are not implied by local Chromium validation.
