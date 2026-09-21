# Delta for AI Cost Accounting

## MODIFIED Requirements

### Requirement: Teacher-facing cost indicator

The workspace MUST show a discreet, per-project consumption indicator as a
qualitative level ("Consumo bajo" / "medio" / "alto"), with no currency and
no invented unit, and MUST NOT reveal the exact USD amount to a teacher
under any interaction — hover, tap, click, or keyboard focus. The term
"ficha" MUST NOT be used for consumption: in this app "Ficha" already names
the resource's title-and-description card and its workspace tab, and the
two meanings would collide on the same screen.

(Previously: the qualitative level was shown by default and the exact USD
amount revealed on hover, tap, or keyboard focus, with the reveal control
required to be keyboard-reachable. The reveal is removed for teachers in
this change; admin visibility is unaffected and unconditional, per the
unchanged "Admin cost visibility is unconditional" requirement.)

#### Scenario: Default reading is neutral

- GIVEN a project with recorded usage
- WHEN the teacher views the workspace
- THEN the indicator shows a qualitative consumption level with no currency
  and no invented unit
- Verification: Playwright browser check, both themes

#### Scenario: No interaction reveals a dollar amount to a teacher

- GIVEN the neutral indicator is visible to a teacher viewing their own
  project
- WHEN they hover, tap, click, or focus-and-activate it
- THEN no USD figure appears at any point
- Verification: Playwright browser check (mouse and keyboard-only
  interaction)
