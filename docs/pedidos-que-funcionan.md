# What makes a teacher request work

Input for a future "help me write the request" mode. Everything here comes from the
blind trials on branch `exp/medicion-arnes` (`experimentos/razonamiento/RESULTADOS*.md`,
8 rounds, about 90 generated resources, DeepSeek V4.1 Flash plus other models). That
corpus has only 6 fixed requests (3 short, 3 detailed), so this is observed evidence and
not a controlled study of phrasing. Items marked **not measured** are hypotheses.

## Observed

1. **A detailed request does not fix logic; reasoning and the harness do.** The
   statistics request (D3) was the most detailed of the six, and it was the worst without
   reasoning (3/8, dragging did not work). The three short requests scored 8/8 with
   `high`. A helper should not promise that "more detail = fewer bugs".
2. **A detailed request does make the resource more complete and closer to what the
   teacher imagined.** Every reasoning level showed this (RESULTADOS.md, "¿Importa cómo
   escribe el pedido el docente?"). This is what a helper can actually improve.
3. **Explicit constraints get dropped silently.** Some examples:
   - "Tres desafíos en orden": the resource evaluated them loosely, and a blind evaluator
     still gave it 8/8.
   - "Barras de chocolate": the theme colours won until a harness rule was added.
   - "Que tomen decisiones con consecuencias": no branching appeared until round 4.
   - "Que funcione en tablet con el dedo": 34 px targets.

   Writing the constraint is necessary, but not sufficient. A helper should turn each
   constraint into a **checkable sentence**, because that is what the checklist and the
   verifier can test.
4. **Content facts are never guaranteed.** Wrong dates and roles (Moreno as a vocal of the
   Primera Junta, when he was secretary) showed up in every round, whatever the model,
   reasoning level or harness. Neither the request nor the harness fixes this. The teacher
   has to review the facts, and the verifier's "Revisá este dato" section exists for this
   reason.

## What a request should contain (derived from the above)

- **Level and topic:** "4to grado, fracciones equivalentes".
- **The central interaction, with verbs:** "el alumno elige en cuántas partes dividir y
  toca las partes para pintarlas". This had the clearest effect on completeness.
- **Numbered goals or challenges, with the order stated if it matters.** Numbered lists
  become checklist items.
- **The visual metaphor, if there is one, stated as a requirement**, for example "las
  barras tienen que parecer chocolate (marrón)", not only as a noun.
- **The facts that must be exact**, listed by the teacher when they matter, for example
  "Primera Junta: presidente Saavedra; secretarios Moreno y Paso". Not measured: giving
  the facts should beat hoping the model knows them.
- **The device:** "proyector", "tablet con el dedo".

## What does not help (observed or strongly suggested)

- Asking for "que no tenga errores" or "que funcione bien": the harness already enforces
  this, and in the trials the wording had no effect on logic.
- Long prose with the key constraint buried in the middle. Not measured, but every dropped
  constraint above was a single clause inside a paragraph.

## For the helper mode

- Ask for the 5 items above as short fields, then compose the request with numbered
  goals.
- Show the teacher the checklist the system will test ("Esto es lo que voy a probar")
  **before** generating, so they can fix a misunderstanding cheaply. Not measured.
- After generation, point at "Revisá este dato" findings as the teacher's job; do not
  present content as verified.
