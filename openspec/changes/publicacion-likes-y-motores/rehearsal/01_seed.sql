-- Rehearsal seed for 20260925000000_publicacion_likes_y_motores.
-- Run against a disposable clone of the dev DB (koduedu_rehearsal), never
-- against the real dev DB. Seeds the three pre-migration row shapes named in
-- tasks.md 2.1.

INSERT INTO "Project" (
  id, title, slug, "currentHtml", "screenshotUrl", "isInGallery",
  "userId", "createdAt", "updatedAt"
) VALUES
  -- (a) screenshotUrl set + isInGallery true
  ('rehearsal-a', 'Rehearsal A', 'rehearsal-a', '<html></html>',
   'https://example.com/a.png', true,
   (SELECT id FROM "User" LIMIT 1), now(), '2026-09-01 10:00:00'),
  -- (b) screenshotUrl set + isInGallery false
  ('rehearsal-b', 'Rehearsal B', 'rehearsal-b', '<html></html>',
   'https://example.com/b.png', false,
   (SELECT id FROM "User" LIMIT 1), now(), '2026-09-02 11:00:00'),
  -- (c) screenshotUrl null + isInGallery true (pre-existing coverless-published case)
  ('rehearsal-c', 'Rehearsal C', 'rehearsal-c', '<html></html>',
   NULL, true,
   (SELECT id FROM "User" LIMIT 1), now(), '2026-09-03 12:00:00');
