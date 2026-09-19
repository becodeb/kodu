# Request Authorization Specification

## Purpose

Per-request identity resolution for role and AI-access flags, read from the
database instead of the 168-hour JWT claim, plus shared guards and route
protection for `/admin` and `/api/admin`.

## Requirements

### Requirement: Per-request role resolution

The system MUST re-read a user's role from the database on every request
that reaches a protected route, rather than trusting the role baked into
the session JWT.

#### Scenario: Promotion takes effect on the next request

- GIVEN a user with role `USER` is promoted to `ADMIN` in the database
- WHEN that user, still holding their existing session cookie, requests
  `/admin`
- THEN the request succeeds without a new login
- Verification: DB state inspection (confirm role differs from any cached
  JWT claim) combined with a Playwright browser check of the resulting
  page

#### Scenario: DB read failure degrades to the JWT claim

- GIVEN the per-request role query fails
- WHEN a request reaches a protected route
- THEN the system falls back to the role stored in the JWT rather than
  hard-failing the request
- Verification: direct inspection of the fallback code path (no test
  runner exists for fault injection in this repo)

### Requirement: Shared authorization guards

The system MUST expose `requireUser()` and `requireAdmin()` as shared
guards used by both `/admin` pages and `/api/admin` routes.

#### Scenario: Unauthenticated request is redirected

- GIVEN no active session
- WHEN a request hits any `/admin/*` page
- THEN the response redirects to login
- Verification: Playwright browser check

#### Scenario: Authenticated non-admin is denied

- GIVEN a logged-in user with role `USER`
- WHEN that user requests `/admin/*` or `/api/admin/*`
- THEN the response is a 403 or redirect, never the protected content
- Verification: Playwright browser check

### Requirement: Middleware route protection

`src/middleware.ts` MUST intercept the `/admin` and `/api/admin` prefixes
and enforce `requireAdmin()` before any page or route handler runs.

#### Scenario: Admin request passes through

- GIVEN a logged-in ADMIN user
- WHEN that user requests any `/admin/*` or `/api/admin/*` path
- THEN the request reaches the underlying page or handler and returns 200
- Verification: Playwright browser check

#### Scenario: Non-admin prefixes are unaffected

- GIVEN the existing `/app/*` prefix
- WHEN a regular authenticated user requests `/app/*`
- THEN the new middleware guard does not alter existing behavior
- Verification: Playwright browser check
