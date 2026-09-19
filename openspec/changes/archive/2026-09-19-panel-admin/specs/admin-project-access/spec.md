# Admin Project Access Specification

## Purpose

An admin can open, prompt, and edit a project owned by another teacher,
through the existing workspace, visibly and attributably.

## Requirements

### Requirement: Admin bypass in the ownership gate

`findOwnedProject()` MUST be the single point granting an admin access to
a project they do not own; every project-scoped route gated by it MUST
inherit the bypass.

#### Scenario: Admin fetches a non-owned project

- GIVEN a project owned by teacher A, and an ADMIN user who is not A
- WHEN the admin requests that project through a route gated by
  `findOwnedProject()`
- THEN the request succeeds
- Verification: Playwright browser check plus DB state inspection
  (confirm no ownership row links the admin to that project)

### Requirement: Full capability while acting

An admin acting on a non-owned project MUST be able to prompt the AI and
edit code, using the existing teacher workspace — no separate read-only
admin view.

#### Scenario: Admin prompts the AI in a non-owned project

- GIVEN an admin has opened a non-owned project
- WHEN the admin sends a chat prompt
- THEN a resource is generated as it would be for the owner
- Verification: Playwright browser check

### Requirement: Visible banner while acting

The workspace MUST show a banner identifying that an admin is acting on
a project they do not own, in both themes.

#### Scenario: Banner renders during admin access

- GIVEN an admin inside a non-owned project's workspace
- WHEN the page renders
- THEN a banner is visible naming the project's owner
- Verification: Playwright browser check, both themes

### Requirement: Durable attribution mark

The system MUST leave a durable mark on the affected project or thread
so the owning teacher can later see that an admin acted on it, including
which admin and roughly when.

#### Scenario: Owner sees the mark after the fact

- GIVEN an admin acted on teacher A's project while A was offline
- WHEN A opens that project later
- THEN A sees an indicator that an admin acted on it, with admin
  identity and timing
- Verification: Playwright browser check plus DB state inspection
