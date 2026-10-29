# Org admin without billing ("Admin" vs "Admin con facturación")

## Objective

An organization admin can be a coordinator who must NOT see billing. Two levels:

- **Admin**: everything on `/org` today (teachers, promote/demote admins, access, usage)
  but NO billing.
- **Admin con facturación**: also sees "Plan y facturación" (`/org/plan`), the renewal
  notice and can call `/api/billing/org/**`.

## Problem

Today every `OrganizationAdmin` row of the ROOT organization (network, or standalone
campus) can pay, change the headcount, cancel and see invoices. A school wants to name a
coordinator as admin without handing over the card.

## Scope

- `OrganizationAdmin.canManageBilling` (default `false`) + migration with a backfill.
- ONE helper decides "can manage billing of root R": superadmin, or an admin row on R with
  the flag (`alcance.ts`, extends `alcanceDeAdmin`). Used by `/org/plan`, the "Plan y
  facturación" link and renewal notice in `/org`, every `/api/billing/org/**` endpoint, the
  header plan link, the "Contratar" CTA (`esAdminOrg`) and the renewal e-mail reminder.
- Granting: self-service signup and the superadmin naming the first admin of a root grant
  it; a promotion by an org admin never does.
- Toggle: JSON endpoint + control in the teacher list (and in a new network-admins card,
  because the network view has no teacher list).
- Owner protection: a non-billing admin cannot demote / remove / move a billing holder.
- Superadmin `/admin/organizaciones/[id]`: badge on the admins list.

Out of scope: any change to prices, the checkout, plan states, the individual plans.

## Decisions (owner, final)

- Billing applies to the ROOT org. Row on the root with `canManageBilling = true`, or
  superadmin.
- Migration backfill: `true` ONLY for the creator = the EARLIEST admin row of each
  organization (min `createdAt`, tie -> min `userId`). Not every existing admin.
- A non-billing admin gets what a stranger gets: `/org/plan` redirects away, the billing
  APIs answer the same 404 `requireFreshOrgAdmin` gives a stranger.
- Cannot revoke the LAST billing holder of a root org.

## Implementation notes

- A sede admin of a network (row on the sede) never has billing: the flag only counts on
  rows of a root organization. The old read-only `/org/plan` view for sede admins goes
  away (they are redirected like any non-holder).
- "Billing holder" for protection purposes = the target has a row with the flag on a root
  the actor does not hold. The check is generic (any root), so it also covers a network
  owner who is a plain member of a sede and shows up in that sede's teacher list.
- Superadmin keeps its existing power to demote anyone; it can leave a root without a
  holder, and naming the next admin as superadmin then grants the flag again.

## Tasks

- [x] T1 — Schema + migration (column, backfill by earliest admin) applied to the scratch
  DB `kodu_orguso`; check the backfill with SQL.
- [x] T2 — Helper in `alcance.ts` (`facturacionIds`, `puedeGestionarFacturacion`,
  `requireFreshOrgBilling`) and wiring: `/org/plan`, `/org` link + renewal notice, the 5
  `/api/billing/org/**` endpoints, header plan link, `esAdminOrg`, renewal e-mails.
- [x] T3 — Granting at creation (`alta.ts`, `promoverAdmin`) and the toggle: `gestion.ts`
  (`fijarFacturacionAdmin`, owner protection in `degradarAdmin` / `quitarMiembro` /
  `moverMiembro`), `PATCH /api/org/organizaciones/[id]/admins/[userId]`.
- [x] T4 — UI: badge + toggle in `MiembrosLista` / `PanelDocentes`, network admins card in
  `/org`, badge in the superadmin admins list. 390 px and dark mode.
- [x] T5 — E2E `e2e/org-facturacion.ts` + adapt the existing e2e seeds that create billing
  admins directly in the DB; run them with `e2e/org-panel.ts` and `e2e/org-acceso.ts`.
- [x] T6 — Screenshots (owner / coordinator, 390 dark and desktop light).

## Route

Delegated direct: single writer, mapping done in the same pass. TDD: off (the repo has no
unit test runner); checks are `npm run check`, `npm run build` and the tsx e2e scripts.

## Checks

- `npx prisma migrate deploy` + `npx prisma generate` on `kodu_orguso`, SQL check of the
  backfill.
- `npm run check`, `npm run build`.
- `e2e/org-facturacion.ts`, `e2e/org-panel.ts`, `e2e/org-acceso.ts` against `PORT=3300`.
- Screenshots reviewed.

## Progress

- Branch `feat/org-admin-facturacion` from `origin/main` (155acbf).
- T1: migration `20261105000000_org_admin_facturacion`. Backfill tested with fixtures
  inserted BEFORE applying it (3 orgs, one with a createdAt tie): each org ends with
  exactly one holder, the tie goes to the smaller `userId`. It marks the earliest row of
  EVERY organization (sedes of a network included, as specified); the code only reads the
  flag on root rows (`parentId IS NULL`), so a flag on a sede row never has effect.
- T2-T4 as planned. Decisions taken while implementing:
  - Non-billing admins hitting `/org/plan` are redirected to `/app` (same as a stranger);
    billing APIs answer the same 404 as for a stranger.
  - Network admins are not in any teacher list, so the network view of `/org` got an
    "Admins de la red" card (`AdminsRed.tsx`) with the badge and the toggle.
  - `esAdminOrg` ("Contratar" CTA and the license messages), the header plan link and the
    renewal e-mail reminders follow the same rule (only holders).
  - `promoverAdmin` grants the flag only to a superadmin naming an admin of a root that has
    no holder yet; a promotion by an org admin never does.
  - Superadmin can still demote anyone (existing power); the "last holder" guard applies to
    org admins. Revoking the flag (PATCH) refuses the last holder for everybody, with a row
    lock on the organization to serialize concurrent revocations.
- T5: `e2e/org-facturacion.ts` green (13 sections). `planes-*` seeds that create billing
  admins directly now set `canManageBilling: true`; the old "sede admin sees the plan
  read-only" case in `planes-paginas.ts` now expects the redirect; `planes-alta.ts` asserts
  the creator is a holder. Also green: `org-panel`, `org-acceso`, `admin-organizaciones`,
  `planes-paginas`, `planes-alta`, `planes-cobro`, `planes-facturacion`, `planes-superadmin`.
  `planes-recorrido` has one failure unrelated to this change (the invitation link is built
  from `PUBLIC_SITE_URL`, which points at port 3000).
- T6: screenshots reviewed (owner / coordinator, desktop light and 390 dark, standalone
  school and network).
