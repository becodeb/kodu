-- La regla global sembrada "Librerías permitidas por CDN" mandaba cargar Tailwind y
-- Lucide a mano y usar confetti en cada acierto. Con el kit de diseño eso contradice
-- el prompt base, y como las reglas globales llegan como "obligatorias", ganaba la regla.
--
-- Se actualiza SOLO si conserva el texto original del seed: si un admin la editó desde
-- el panel, su versión manda y esta migración no la toca.
UPDATE "CustomRule"
SET "content" = 'Usá únicamente estas librerías, siempre por CDN desde jsdelivr o unpkg: KaTeX para fórmulas matemáticas, Chart.js para gráficos y canvas-confetti sólo al terminar una actividad. Tailwind CSS, las tipografías y los íconos Lucide ya vienen con el kit de KoduEdu (<meta name="kodu-tema">): no los cargues aparte. No incorpores otras dependencias externas.'
WHERE "isGlobal" = true
  AND "title" = 'Librerías permitidas por CDN'
  AND "content" = 'Usá únicamente estas librerías, siempre por CDN: Tailwind CSS (cdn.tailwindcss.com), KaTeX para fórmulas matemáticas, Chart.js para gráficos, canvas-confetti para refuerzos positivos y Lucide Icons para iconografía. No incorpores otras dependencias externas.';
