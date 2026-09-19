# App Settings Specification

## Purpose

A single-row settings store for app-wide switches — starting with the
demo-mode toggle — so a toggle has somewhere to write without a
redeploy.

## Requirements

### Requirement: Singleton row

The system MUST persist exactly one `AppSettings` row. Reads and writes
MUST target that row; no operation may create a second row.

#### Scenario: Concurrent writes leave one row

- GIVEN the singleton `AppSettings` row already exists
- WHEN two admin writes to `AppSettings` happen close together
- THEN exactly one row exists afterward, reflecting the later write
- Verification: DB state inspection

### Requirement: Settings are read fresh per request

App-wide switches stored in `AppSettings` (such as demo mode) MUST be
read per request, or through a short-lived cache, and MUST NOT be cached
for the lifetime of a session JWT.

#### Scenario: A toggle change reflects on the next request

- GIVEN an admin changes a switch in `AppSettings`
- WHEN any user makes their next request
- THEN the new value is in effect, without waiting for token expiry
- Verification: Playwright browser check (concretely exercised by the
  demo-mode toggle scenario)
