# Delta for AI Model Catalog

## MODIFIED Requirements

### Requirement: Ordering, enable/disable, and teacher visibility are distinct controls

The system MUST let an admin reorder models and hold exactly one model
marked as default at any time, and MUST expose two independent boolean
controls per model: `selectableByTeacher` (governs whether the model appears
in the teacher-facing selector) and `enabled` (governs whether the model may
be used at all, including as a link in the fallback chain). Toggling one
control MUST NOT alter the other. It MUST remain possible to configure
`selectableByTeacher: false` with `enabled: true` — never pickable by a
teacher, always reachable by fallback. When an admin disables `enabled` on a
model that another model's `fallbackModelId` references, the system MUST
warn the admin, naming the affected model(s).

(Previously: a single "enable/disable" toggle existed without an explicit
statement of teacher-selector versus fallback-chain effects, and no
fallback-target warning.)

#### Scenario: Turning off selectableByTeacher hides the engine from teachers while fallback still resolves

- GIVEN an enabled model shown in the teacher selector, with
  `selectableByTeacher: true`
- WHEN an admin turns `selectableByTeacher` off, leaving `enabled: true`
- THEN it no longer appears in the teacher selector
- AND `cadenaDeMotores()` traversal still reaches it as a fallback target
- Verification: Playwright browser check + integration check

#### Scenario: DeepSeek-style configuration remains expressible

- GIVEN a model configured with `selectableByTeacher: false` and
  `enabled: true`
- WHEN the teacher selector renders and a fallback traversal runs
- THEN the model is absent from the selector but resolves correctly when
  used as a fallback target
- Verification: DB state inspection + integration check

#### Scenario: Disabling a fallback target warns first

- GIVEN model B is set as model A's `fallbackModelId`, and B's `enabled` is
  true
- WHEN an admin turns off B's `enabled`
- THEN the admin sees a warning naming model A before or at the moment of
  the change
- Verification: Playwright browser check, both themes

#### Scenario: Setting a new default unsets the previous one

- GIVEN model A is the current default
- WHEN an admin sets model B as default
- THEN exactly one row has the default flag, and it is B
- Verification: DB state inspection

### Requirement: Teacher-facing selector is a dropdown with hover description

The model selector in the workspace MUST render as a single dropdown control
listing every model with `enabled: true` and `selectableByTeacher: true`, in
the admin's configured order, showing each model's friendly name; the
friendly name MUST NOT expose the provider-side model id. Each model's
admin-facing description MUST be revealed on hover over its dropdown option,
and MUST also be reachable via keyboard focus.

(Previously: rendered as a segmented button group, one button per model,
with the selected model's description shown as a paragraph beneath the
group; did not filter on `selectableByTeacher`.)

#### Scenario: Selector renders as a dropdown with hover description

- GIVEN two models with `enabled: true` and `selectableByTeacher: true`, with
  distinct friendly names and descriptions
- WHEN a teacher opens the dropdown and hovers an option
- THEN the option's friendly name is visible and its description appears on
  hover, in configured order
- Verification: Playwright browser check, both themes

#### Scenario: Selector excludes models not selectable by teacher

- GIVEN a model with `enabled: true` and `selectableByTeacher: false`
- WHEN a teacher opens the dropdown
- THEN that model does not appear
- Verification: Playwright browser check
