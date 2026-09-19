# Admin Users Specification

## Purpose

The admin's user list and per-user control surface: table, per-row
overflow menu, and a detail view with usage charts and projects.

## Requirements

### Requirement: Users table

The `/admin/usuarios` table MUST list, for every user: tokens consumed,
USD cost, project count, AI-access state, and last activity.

#### Scenario: Table renders all five fields

- GIVEN at least one user with recorded usage and projects
- WHEN an admin opens the users table
- THEN each row shows tokens, USD cost, project count, access state, and
  last activity
- Verification: Playwright browser check, both themes

### Requirement: Per-row overflow menu

Each row MUST expose an overflow menu to toggle the user's admin role
and their AI-access override. The menu MUST be fully operable by
keyboard: reachable via Tab, openable via Enter or Space, and navigable
without a mouse.

#### Scenario: Keyboard-only role toggle

- GIVEN an admin navigating with Tab only
- WHEN they reach a row's overflow menu, open it, and select "toggle
  admin role"
- THEN the target user's role changes
- Verification: Playwright browser check (keyboard-only interaction)

#### Scenario: Promotion takes effect on the user's next request

- GIVEN an admin promotes a user via the overflow menu
- WHEN that user makes their next request
- THEN it is treated as an admin request (per request-authorization)
- Verification: DB state inspection plus Playwright browser check

### Requirement: User detail view

The user detail view MUST render hand-rolled SVG charts — usage over
time and usage by model — with no charting library added to
`package.json`, and MUST list that user's projects.

#### Scenario: Charts render from the user's usage rows

- GIVEN a user with `TokenUsage` rows across multiple models and dates
- WHEN an admin opens that user's detail view
- THEN both charts render, reflecting that user's own data
- Verification: Playwright browser check, both themes

#### Scenario: No charting dependency added

- GIVEN the detail view renders charts
- WHEN `package.json` is inspected
- THEN no new charting library appears as a dependency
- Verification: direct repository inspection

### Requirement: Opening a user's project from the detail view

An admin MUST be able to open any listed project directly from a user's
detail view and act on it fully — prompt the AI and edit code — not
merely view its title or figures.

#### Scenario: Admin opens and prompts a listed project

- GIVEN an admin viewing a teacher's detail page with at least one
  project listed
- WHEN the admin opens one of those projects
- THEN the workspace loads and accepts a chat prompt
- Verification: Playwright browser check
