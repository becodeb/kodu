# Organizaciones, panel de organización y métricas de precio

Documento vivo de la feature (flujo ODD). Espejo en Engram: proyecto `kodu`, tópico `odd/organizaciones/tasks`.
Rama `feat/organizaciones` (worktree `../kodu-wt/organizaciones`), cortada de `origin/main` en `93e3504`.

## Objetivo

Vender Kodu por colegio (sede) o por red de colegios y medir si el precio cierra. Una organización da acceso a sus
docentes, tiene un admin propio que ve solo lo suyo, y el superadmin ve consumo y costo por organización y por mes,
separado por paso (generación, ajuste, checklist, corrección, verificación, versión extra).

## Problema

- Hoy el acceso a la IA sale de una lista global de dominios (`AuthorizedDomain`) más un permiso individual
  (`User.aiAccessOverride`). No existe la noción de colegio ni de red.
- El registro con contraseña no verifica el email: cualquiera puede escribir `profe@colegio.edu.ar`.
- `TokenUsage` no dice para qué fue cada llamada, así que no se puede medir el costo de un ajuste, que es el supuesto
  más débil de `experimentos/razonamiento/PLAN-produccion.md` (rama `exp/medicion-arnes`, §4 y §6.2).

## Decisiones del dueño (no reabrir)

- **Un docente pertenece a UNA sola organización** (una sede; en una red, una sede de esa red).
- **Verificación de email:** Google ya viene verificado. El registro con contraseña manda un mail de verificación por
  Resend. Mientras no haya `RESEND_API_KEY` en el entorno, toda creación de usuario se toma como verificada.
- **No hay dominios globales.** Los dominios pertenecen a una organización. Migración: se crea la organización
  **Reditinere** y se le asigna todo lo que existe hoy (dominios y usuarios).
- **Cuenta personal:** quien entra con un email que no coincide con ninguna organización tiene una cuenta personal que
  por ahora no puede usar la app (más adelante tendrá precio propio). Pasa a ser de una organización al aceptar un
  enlace de invitación o cuando la organización agrega su email a la lista blanca.
- **Admins de organización:** el superadmin crea la organización y nombra al primer admin; los admins de la
  organización pueden promover o quitar a otros admins de la suya.
- **Sin topes por organización por ahora.** Siguen los topes existentes por docente y por motor.
- **Red con dominio compartido:** quien entra por un dominio de la red elige su sede la primera vez; el admin de la
  red puede cambiarla después.

## Decisiones de diseño (tomadas en esta sesión, con la conformidad implícita del dueño)

- **Fallback sin Resend:** el usuario se asocia igual, pero se guarda el origen real de la verificación
  (`emailVerifiedAt` + `emailVerificationSource`: `GOOGLE` | `EMAIL` | `NO_PROVIDER`). `/admin` muestra un aviso
  "La verificación de email está apagada: falta `RESEND_API_KEY`" y el servidor loguea una advertencia al arrancar.
  Al cargar la key, quienes quedaron con `NO_PROVIDER` se pueden auditar; no se les quita nada.
- **El enlace de invitación nunca exige email verificado**: tener el enlace es la prueba.
- **Unirse ocurre en el momento**: al aceptar el enlace, al verificar el email, al entrar con Google, o cuando la
  organización agrega el dominio o el email a la lista blanca (a cuentas personales ya verificadas).
- **La demo queda fuera de toda organización** y sigue usando `aiAccessOverride = true`.
- **`aiAccessOverride` se conserva** como poder del superadmin: `false` corta la IA aunque la persona esté en una
  organización; `true` la habilita sin organización (lo usa la demo). `null` = decide la organización.
- **El admin de organización ve conteos, no contenido.** Ve cuántos recursos generó cada docente, pero no los
  recursos ni los chats (la galería pública sigue siendo pública).
- **Costo congelado por organización:** `TokenUsage` guarda la sede (`organizationId`) en el momento de la llamada. Si
  un docente cambia de sede, el historial queda donde se pagó.
- **Propósito de cada llamada:** enum `UsagePurpose` (`GENERATION`, `ADJUSTMENT`, `CHECKLIST`, `CORRECTION`,
  `VERIFICATION`, `EXTRA_VERSION`), nulo para las filas históricas. Más `forNewResource` (booleano nulo) para poder
  sumar el costo total de un recurso nuevo contra el de un ajuste: las correcciones y verificaciones lo heredan de la
  última fila `GENERATION`/`ADJUSTMENT` del mismo proyecto y usuario, sin tocar el cliente.
- **Entrega:** estrategia `exception-ok`. El dueño no usa PRs y mergea ramas a `main` cuando lo aprueba; pushear a
  `main` despliega. Nada se pushea ni se mergea sin su pedido.

## Alcance autorizado

T1–T10. Fuera de alcance: topes por organización, precio de cuentas personales, SSO, tocar datos de producción.

## Restricciones

- No tocar `src/pages/api/chat/stream.ts`, `Workspace.tsx`, `ChatPanel.tsx` ni `src/pages/api/chat/cancel.ts` (los
  cambia otra sesión en `feat/generacion-simple-y-reanudable`). Excepción: SOLO las líneas de llamada a
  `recordUsage` en `stream.ts` para pasar el propósito. Avisar al dueño al cerrar para mergear con cuidado.
- Migraciones `20261010000000_*` en adelante, escritas a mano. Nunca `prisma migrate dev`. Aplicar con psql al
  contenedor `kodu_db_dev`, `npx prisma migrate resolve --applied <nombre>`, `npx prisma generate`, y confirmar que
  siguen `AiModel_un_solo_default`, `AiModel_un_solo_verificador` y `User_un_solo_demo`.
- Prisma no avisa de columnas borradas: buscar cada nombre de campo con `rg`.
- Catálogo de motores cacheado 30 s: en los e2e, cambiar flags por la API de admin.
- UI en español rioplatense con voseo; solo tokens semánticos de `src/styles/global.css` (nunca `bg-white` ni
  `bg-slate-*`); modo oscuro y celular.
- Aislamiento: el admin de una organización nunca ve datos de otra. Probado con e2e explícitos.
- Raspberry con poca RAM: e2e de a uno; el dev server es un daemon (`npx astro dev stop`).
- **Entorno aislado de la otra sesión:** esta worktree usa la base `koduedu_orgs` (clon de `koduedu` del
  2026-09-26, en el mismo contenedor `kodu_db_dev`) y el puerto 3100 (`.env` local, sin commitear). Los e2e corren con
  `KODU_BASE_URL=http://localhost:3100` y el dev server con `PORT=3100 npm run dev`. El clon trae aplicada la migración
  `20261007000000_chequeos_posteriores` de la otra rama (sus tablas sobran acá; no molestan). El mock usa el 4790,
  compartido: antes de un e2e con mock, confirmar que el puerto está libre.

## Modo de pruebas

TDD: **apagado** (no hay configuración de TDD ni test runner en el repo). Chequeos funcionales por tarea:
`npx tsc --noEmit` y scripts `npx tsx e2e/<archivo>.ts` con `node:assert` (dev server en 3000, mock en 4790).

## Pronóstico de entrega

~3.500 líneas autoradas en total (estimado). Estrategia `exception-ok` (ver arriba); commits por unidad de trabajo en
`feat/organizaciones`.

## Tareas

Ruta por defecto: escritor delegado (cada tarea toca 2+ archivos no triviales). Un escritor a la vez.
T1 y T2 van con el mismo escritor (dos commits): borrar `AuthorizedDomain` rompe `puedeUsarLaIa` y la pestaña
Dominios, así que no compilan por separado. La pestaña Dominios se quita en T2 y la reemplaza Organizaciones en T6.
Una cuenta personal conserva sus recursos (no se borran) pero no entra al editor; vuelven a estar disponibles si se
une a una organización.

- [ ] **T1 — Esquema y migración.** Modelos `Organization` (`CAMPUS` | `NETWORK`, `parentId` para sedes de una red),
  `OrganizationDomain` (reemplaza a `AuthorizedDomain`, patrón único global), `OrganizationAllowedEmail` (email único
  global), `OrganizationInvite` (hash del token, vencimiento y cupo opcionales, usos, revocado),
  `OrganizationAdmin` (usuario ↔ organización que administra), `EmailVerificationToken`. En `User`:
  `organizationId`, `emailVerifiedAt`, `emailVerificationSource`. En `TokenUsage`: `organizationId`, `purpose`,
  `forNewResource`. Backfill: Reditinere, sus dominios, todos los usuarios no demo, `TokenUsage.organizationId`
  histórico, `emailVerifiedAt` para cuentas de Google. Borrar `AuthorizedDomain` y todas sus referencias.
  Check: migración aplicada, 3 índices parciales presentes, `tsc` limpio.
- [ ] **T2 — Membresía y acceso.** `src/lib/orgs/`: resolver la organización de un email (dominio / lista blanca),
  unir en el momento, nueva regla `puedeUsarLaIa` (override → organización), gate de cuenta personal en `/app` y en
  las APIs de trabajo (pantalla "cuenta personal"). Check: e2e de acceso.
- [ ] **T3 — Verificación de email.** Cliente de Resend por `fetch` (sin dependencia nueva), token de verificación,
  registro con contraseña sin verificar, endpoint de verificación, fallback `NO_PROVIDER` sin key, aviso en `/admin`.
  Check: e2e con y sin key (key falsa contra un mock local).
- [ ] **T4 — Invitaciones y elección de sede.** Página `/invitacion/[token]` (aceptar con sesión o registrarse),
  vencimiento, cupo, revocación; selector de sede para quien entra por un dominio de red. Check: e2e.
- [ ] **T5 — Propósito del consumo.** `recordUsage` recibe `purpose` y calcula la sede y `forNewResource`; tocar solo
  las líneas de llamada en `stream.ts`, más `autocorreccion.ts` y `verificar.ts`. Check: e2e con el mock que
  confirme el propósito de cada fila.
- [ ] **T6 — Superadmin: organizaciones.** Pestaña Organizaciones (reemplaza a Dominios): alta de colegio, red y sede;
  dominios; lista blanca; nombrar al primer admin; mover docentes. Actualizar el conteo de pestañas de
  `e2e/m1-admin-shell.ts`. Check: e2e.
- [ ] **T7 — Superadmin: métricas de precio.** Por organización y mes: docentes registrados, activos, recursos
  creados, turnos, tokens y USD; costo promedio por recurso nuevo y por ajuste; costo por docente activo; filas sin
  precio marcadas como incompletas (nunca sumar NULL como 0). Check: e2e con filas sembradas y cifras calculadas a mano.
- [ ] **T8 — Panel de la organización.** `/org`: docentes (lista, baja → cuenta personal, lista blanca, enlaces,
  admins), recursos por docente, tokens y costo por docente y por mes, desglose por sede en una red. Móvil y modo
  oscuro. Check: e2e de navegador.
- [ ] **T9 — Aislamiento.** e2e explícitos: el admin de A no ve ni muta nada de B (páginas y APIs, ids ajenos
  adivinados); el admin de una sede no ve la sede hermana; el de la red ve solo sus sedes; un docente no entra a `/org`.
- [ ] **T10 — Cierre.** Docs, regresión de las suites existentes afectadas (m1, m5, m6, m7), aviso de merge de
  `stream.ts`.

## Progreso

- 2026-09-26: exploración y decisiones del dueño. Documento creado.

## Siguiente paso

T1.
