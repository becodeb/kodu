# Gallery Likes Specification

## Purpose

A teacher can mark a published resource as liked. Likes are visible to
everyone, restricted to logged-in teachers to cast, and drive the gallery's
default ordering.

## Requirements

### Requirement: One like per teacher per resource

A `ProjectLike` row MUST be uniquely keyed on `(userId, projectId)`. Only an
authenticated teacher MAY create or remove a like. Liking MUST be idempotent
from the teacher's perspective: toggling like on an already-liked resource
removes the like, and a duplicate like request MUST NOT create a second row.

#### Scenario: Teacher likes a resource

- GIVEN a logged-in teacher viewing a published resource with 0 likes
- WHEN they click the heart
- THEN a `ProjectLike` row is created and the count shows 1, the heart filled
- Verification: DB state inspection + Playwright browser check

#### Scenario: Teacher unlikes a resource

- GIVEN a logged-in teacher who has liked a resource
- WHEN they click the filled heart again
- THEN the `ProjectLike` row is removed, the count decreases by 1, and the
  heart is unfilled
- Verification: DB state inspection + Playwright browser check

#### Scenario: Double-like from a double-click is not double-counted

- GIVEN a logged-in teacher rapidly double-clicks the heart on an unliked
  resource
- WHEN both requests reach the server
- THEN exactly one `ProjectLike` row exists for that pair, never two — the
  second request either no-ops or is rejected by the unique constraint
- Verification: DB state inspection

### Requirement: Anonymous visitors see the count but cannot like

An unauthenticated visitor MUST see the heart and the current like count on
every gallery card. The heart MUST render unfilled regardless of any prior
activity, and clicking it MUST redirect to login rather than creating a
like.

#### Scenario: Anonymous visitor sees count and unfilled heart

- GIVEN an unauthenticated visitor on the gallery page
- WHEN a card renders
- THEN the heart is unfilled and the like count is visible
- Verification: Playwright browser check (no session)

#### Scenario: Anonymous click goes to login

- GIVEN an unauthenticated visitor
- WHEN they click the heart on a gallery card
- THEN they are redirected to the login page and no `ProjectLike` row is
  created
- Verification: Playwright browser check (no session)

### Requirement: Gallery lists most-liked first

The gallery query MUST order published projects by like count descending,
computed via `orderBy: { likes: { _count: 'desc' } }` rather than a
denormalized counter column. When two projects have an equal like count, the
tiebreak MUST be `updatedAt` descending — the ordering already in use before
this change.

(Rationale: the gallery takes a bounded 60-row page; a `_count` join costs
nothing measurable at this scale and can't drift out of sync the way a
denormalized counter could.)

#### Scenario: More-liked project sorts first

- GIVEN project A has 5 likes and project B has 2 likes, both published
- WHEN the gallery renders
- THEN project A appears before project B
- Verification: Playwright browser check + DB state inspection

#### Scenario: Equal like counts fall back to recency

- GIVEN project A and project B both have 3 likes, with A's `updatedAt` more
  recent than B's
- WHEN the gallery renders
- THEN project A appears before project B
- Verification: DB state inspection

### Requirement: Likes schema migration is additive and unattended

The migration introducing `ProjectLike` MUST be pure SQL (`CREATE TABLE`
plus its unique index on `(userId, projectId)`), applied by `prisma migrate
deploy` with no manual post-deploy step.

#### Scenario: Migration runs unattended on deploy

- GIVEN a push-to-main deploy triggers the production migration step
- WHEN `prisma migrate deploy` runs
- THEN the `ProjectLike` table and its unique index exist afterward with no
  manual intervention
- Verification: deploy log inspection / migration dry-run
