-- The three Claude 5.5 presets were created with a 32,000-token output cap,
-- but Haiku, Sonnet and Opus 5.5 accept up to 128,000 when streaming (kodu
-- always streams). Thinking tokens count against the same cap, so a long
-- resource was cut off mid-write and rejected as truncated.
--
-- Only rows still at the old preset value are raised: a cap the owner typed
-- by hand in /admin/motores is left alone.
UPDATE "AiModel"
SET "maxOutputTokens" = 128000
WHERE "presetKey" IN ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5')
  AND "maxOutputTokens" = 32000;
