# Probar planes y cobros en local

Guía para probar de punta a punta todo lo de `odd/tasks/planes-y-cobros.md`: planes,
créditos, cobro (Mercado Pago simulado), alta de instituciones y facturación (Factura C
simulada). Pensada para el dueño: un comando automático y, después, un paseo manual por
`http://localhost:3200` clickeando lo mismo que haría un docente o un colegio.

## Lo que necesitás antes de arrancar

- **Postgres levantado.** `docker compose up -d db` (o tu propio Postgres apuntado por
  `DATABASE_URL` en `.env`). Este worktree usa la base `koduedu_planes`.
- **Migraciones y seed al día:**
  ```bash
  npm run db:deploy
  npm run db:seed
  ```
  El seed crea el superadmin (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` de tu `.env`, por
  defecto `admin@rededucativa.edu.ar` / `Kodu.Admin.2026`) y las bandas/planes de precio
  (valores de ejemplo, editables desde `/admin/precios`).
- **Valores de `.env` que importan para probar cobros:**
  - `BILLING_PROVIDER="simulado"` — con esto, `/pago-simulado/[id]` reemplaza a Mercado
    Pago: "Aprobar pago" / "Rechazar pago" sin ninguna credencial.
  - `INVOICE_PROVIDER="simulado"` — con esto, cada pago aprobado emite una Factura C con
    un CAE *inventado pero determinístico*, sin tocar ARCA.
  - `RESEND_API_KEY=""` (vacía) — toda cuenta nueva se toma como verificada de una. Si la
    cargás, el registro con contraseña queda sin confirmar hasta seguir el enlace del
    mail (ver `odd/tasks/organizaciones.md`): para el paseo manual de abajo convién
    dejarla vacía.
  - El resto de las variables de cobro/facturación (`MP_*`, `ARCA_*`) **no hacen falta
    para nada de esta guía** — sólo entran en juego cuando se prueba contra el sandbox
    real (ver "Antes de salir a producción", al final).

## Un solo comando: `npm run test:cobros`

```bash
npm run test:cobros
```

Corre, en este orden:

1. Los chequeos unitarios sin servidor: `unidad-planes`, `unidad-creditos`,
   `unidad-pasarela`, `unidad-facturador`.
2. Arranca (si hace falta) el dev server de este worktree con `BILLING_PROVIDER=simulado`
   e `INVOICE_PROVIDER=simulado`.
3. Los e2e contra ese servidor: `planes-acceso`, `planes-alta`, `planes-cobro`,
   `planes-paginas`, `planes-superadmin`, `planes-facturacion` y `planes-recorrido` (el
   recorrido completo, individual e institución, de punta a punta).
4. Para el dev server (sólo si lo arrancó él) y muestra una tabla con el resultado y la
   duración de cada script.

Si ya tenés el dev server de este worktree corriendo a mano (por ejemplo porque estás
siguiendo el paseo manual de abajo al mismo tiempo), el script lo detecta y lo reusa en
vez de arrancar uno nuevo — pero si lo que está corriendo en el puerto es *otra cosa*
(otro proyecto, un dev server con un `.env` distinto), **el script aborta sin tocar nada**
y te lo dice. Nunca mata procesos a ciegas (nada de `pkill -f`): sólo usa
`npx astro dev stop`, y sólo cuando la corrida anterior confirmó que el puerto estaba
libre antes de arrancar.

Usa el puerto `3200` por defecto (podés cambiarlo con `PORT=3210 npm run test:cobros`).
Sale con código distinto de cero si algo falló — útil para CI o para un hook de pre-push.

### La regla de "nunca contra una base que parezca de producción"

Antes de tocar cualquier cosa, el script aborta si:

- `NODE_ENV=production`, o
- `DATABASE_URL` o `POSTGRES_DB` contienen la palabra `"prod"` (sin importar mayúsculas).

No es una lista blanca de nombres de base de desarrollo conocidos — es una lista negra
mínima para que un `.env` apuntado por error a producción nunca llegue a crear cuentas,
dropear filas o sembrar datos de prueba ahí. Si tu base de desarrollo se llama justo
`produccion_test` o algo que matchee `"prod"` sin serlo, renombrala: no hay excepciones a
esta regla ni una bandera para saltearla.

## Paseo manual

Con el dev server de este worktree corriendo (`BILLING_PROVIDER=simulado
INVOICE_PROVIDER=simulado PORT=3200 npm run dev`, o dejá que `npm run test:cobros` lo
levante y no lo pares vos), todo pasa por `http://localhost:3200`.

### A. Camino individual (docente sin institución)

1. Registrate en <http://localhost:3200/register> con cualquier email que no sea de una
   institución cargada (por ejemplo `vos@gmail.com`).
2. Entrá a **Nuevo recurso** y pedile algo simple a la IA — necesitás un motor con precio
   cargado en `/admin/motores` para que el crédito baje de verdad (si usás Alpha/MiniMax
   sin key, el costo puede quedar sin calcular; para probar el *débito* de créditos sin
   configurar un proveedor real, mirá cómo lo hace `e2e/planes-acceso.ts` o
   `e2e/planes-recorrido.ts`: dan de alta un motor que apunta a `e2e/mock-proveedor.ts`).
3. Mirá tu saldo en `/app/plan`: arranca en 100 (bienvenida) + 50 (del mes).
4. Para ver el cartel de "Te quedaste sin créditos" sin esperar a gastarlos de a poco,
   pisá tu saldo a mano (ver la consulta SQL de "vaciar el saldo" más abajo) y volvé a
   `/app/project/[id]`.
5. Andá a `/app/plan` → **Pasate a Individual** → te lleva a
   `/pago-simulado/[id]` → **Aprobar pago**. Volvés a `/app/plan` con "Plan Individual",
   el crédito Individual completo y fresco de este mes (T10: no se suma al que ya tenías
   del plan Gratis, lo reemplaza — ver `monthlyCredits` de `IndividualPlan` en
   `/admin/precios` para el número vigente) y la factura emitida (CAE) a la vista.
6. **Cancelar suscripción** en `/app/plan`: confirmá el diálogo. Seguís viendo "Plan
   Individual" — el acceso no se corta hasta el fin del período que ya pagaste.

### B. Camino institucional (colegio)

1. Andá a `/precios`, escribí `450` en el campo de alumnos: se resalta la banda
   **Mediana**.
2. Hacé clic en el botón de esa tarjeta (lleva la matrícula en la URL:
   `/instituciones/alta?alumnos=450`) — dice **"Probá N días gratis"** si la prueba
   institucional está habilitada en `/admin/precios` (T11: interruptor del superadmin,
   OFF por default — "todavía tenemos 0 clientes"), o **"Contratar"** si está apagada.
3. Si no tenés sesión, **Crear cuenta** con un email de tu colegio (algo con dominio
   propio, no gmail/hotmail/outlook/yahoo — esos quedan rechazados a propósito).
4. Completá el formulario de alta: nombre del colegio, matrícula (ya viene prellenada en
   450), y agregá un dominio extra con **+ Agregar otro dominio** si tu colegio tiene más
   de un dominio de mail. Con la prueba habilitada: **Empezar la prueba de N días** te deja
   en `/org` con el banner de prueba, como administrador de la institución. Con la prueba
   apagada: **Contratar** crea la institución igual, pero la licencia arranca
   `PENDING_PAYMENT` (sin prueba) — en `/org/plan` vas a ver "Contratá para empezar a usar
   Kodu" en vez de un banner de prueba, y los botones de pago ya están disponibles.
5. Invitá a un docente: desde `/org` (o `POST /api/org/invitaciones` si todavía no hay
   botón visible para esto en tu build) generás un enlace `/invitacion/<token>` y se lo
   pasás al docente. El docente entra a ese enlace, se registra o inicia sesión, y hace
   clic en **Unirme a <tu colegio>** — a partir de ahí ya puede generar recursos bajo la
   licencia de la institución (los docentes nunca necesitan créditos propios).
6. Andá a `/org/plan`: completá razón social, CUIT (uno válido, por ejemplo
   `20-12345678-6`) y condición frente al IVA. Vas a ver la vista previa de "Hoy pagás"
   tanto para el pago mensual como para el ciclo lectivo completo. Elegí **Pagar ciclo
   lectivo** → `/pago-simulado/[id]` → **Aprobar pago**. La licencia queda `ACTIVE` y la
   factura, `ISSUED` con CAE.
7. Como superadmin (ver más abajo cómo entrar), mirá `/admin/altas` (tu colegio aparece
   en la cola/listado) y `/admin/facturacion` (el CAE de la factura que acabás de
   aprobar).

### C. Vencimiento de la prueba (sin pagar)

1. Con una institución en `TRIAL`, movele `trialEndsAt` al pasado (ver la consulta SQL
   más abajo).
2. Un docente de esa institución ve un cartel de solo lectura ("La licencia de tu
   institución no está activa…") al intentar generar; quien la administra ve
   "Contratá para seguir usando la IA" y, en `/org/plan`, los botones de pago siguen
   disponibles para contratar de una.

### D. Prueba institucional apagada (T11)

1. En `/admin/precios`, destildá **Prueba institucional habilitada** y guardá.
2. Repetí el camino institucional (B): el formulario de alta dice **Contratar**, nunca
   promete días de prueba. Al confirmar, la licencia queda `PENDING_PAYMENT` — el
   docente/admin ve "Contratá para empezar a usar Kodu" (nunca "tu prueba terminó", porque
   nunca hubo prueba).
3. Pagar (mensual o ciclo lectivo) activa la licencia normalmente, igual que en B.
4. Si igual querés darle una prueba a esa institución puntual, andá a `/admin/altas` →
   **Extender/dar prueba** → esa licencia pasa a `TRIAL` con los días que pongas, aunque el
   interruptor global siga apagado.

### Cómo entrar como superadmin local

Usá las credenciales de `.env` (`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`, por defecto
`admin@rededucativa.edu.ar` / `Kodu.Admin.2026`) en <http://localhost:3200/login>. Desde
ahí tenés `/admin/precios`, `/admin/altas` y `/admin/facturacion`.

### Simular renovación, pago fallido, gracia, cancelación y arrepentimiento

En `/pago-simulado/[id]`, una vez que el primer pago de una **suscripción** (plan
Individual mensual, o la licencia institucional ya con período cargado) quedó resuelto,
la página ofrece dos botones nuevos en vez de "Aprobar/Rechazar":

- **Simular cobro de renovación** → `renovacion_ok`: extiende el período como si Mercado
  Pago hubiese cobrado la cuota siguiente.
- **Simular cobro fallido** → `renovacion_fallida`: la licencia institucional pasa a
  `PAST_DUE` con 7 días de gracia; pasados esos 7 días sin pagar, queda en solo lectura.

Para volver a ver esa página de un pago/suscripción que ya resolviste, repetí el checkout
(`/app/plan` o `/org/plan` ya te ofrecen "renovar" cuando faltan 30 días o menos para el
fin del período) o guardate la URL `/pago-simulado/[id]` la primera vez.

- **Cancelación** (`Cancelar suscripción` en `/app/plan`, o el botón equivalente de
  `/org/plan`): el acceso sigue hasta el fin del período ya pagado; después, vuelve a
  Gratis (individual) o a solo lectura (institución, si no renueva).
- **Arrepentimiento** (sólo plan Individual, dentro de los primeros 10 días del pago):
  `Botón de arrepentimiento` en `/app/plan` revierte a Gratis al instante y marca el pago
  para reintegro manual — no hay reintegro automático; se marca "hecho" desde
  `/admin/facturacion`.

### Viajar en el tiempo a mano (SQL para la base de desarrollo)

Pegá esto en `psql` contra `koduedu_planes` (o `npx prisma studio`). Reemplazá
`'tu-email@tucolegio.edu.ar'`/`'tu-email@gmail.com'` según el caso.

```sql
-- Vaciar el saldo de créditos de una cuenta individual (para ver "Te quedaste sin créditos" ya):
INSERT INTO "CreditLedgerEntry" (id, "userId", delta, kind, "createdAt")
SELECT gen_random_uuid(), id, -(
  SELECT COALESCE(SUM(delta), 0) FROM "CreditLedgerEntry" WHERE "userId" = "User".id
), 'ADJUSTMENT', now()
FROM "User" WHERE email = 'tu-email@gmail.com';

-- Vencer la prueba de una institución HOY MISMO:
UPDATE "OrganizationLicense"
SET "trialEndsAt" = now() - interval '1 day'
WHERE "organizationId" = (SELECT id FROM "Organization" WHERE name = 'Tu Colegio');

-- Acercar el fin del período de una licencia institucional ACTIVA a 20 días
-- (para ver el banner de renovación en /org/plan sin esperar meses):
UPDATE "OrganizationLicense"
SET "currentPeriodEnd" = now() + interval '20 days'
WHERE "organizationId" = (SELECT id FROM "Organization" WHERE name = 'Tu Colegio');

-- Lo mismo para una suscripción Individual:
UPDATE "IndividualSubscription"
SET "currentPeriodEnd" = now() + interval '20 days'
WHERE "userId" = (SELECT id FROM "User" WHERE email = 'tu-email@gmail.com');

-- Vencer directamente (sin pasar por la gracia) una licencia institucional:
UPDATE "OrganizationLicense"
SET "currentPeriodEnd" = now() - interval '10 days', "graceEndsAt" = now() - interval '3 days'
WHERE "organizationId" = (SELECT id FROM "Organization" WHERE name = 'Tu Colegio');
```

Después de cualquiera de estos UPDATE, visitá `/app/plan`, `/org/plan` o generá un
recurso: la reconciliación de estado corre al vuelo en esos caminos (no hace falta
reiniciar el servidor ni esperar un cron).

## Probado contra el sandbox real (T4c)

Hecho en cuatro fases contra credenciales de PRUEBA reales de Mercado Pago (nunca contra
producción). Resultado: los cuatro checkouts (individual mensual/anual, institucional
mensual/ciclo lectivo) funcionan de punta a punta, incluido un cobro recurrente real y la
cancelación; se encontraron y corrigieron tres bugs reales del adaptador en el camino
(colchón de `start_date`, lectura de `authorized_payments` en vez de `v1/payments` para
los cobros recurrentes, y el rediseño de `payer_email` descrito abajo).

**Verificado:**

- Los cuatro tipos de checkout (preapproval individual mensual, Checkout Pro individual
  anual, preapproval institucional mensual, Checkout Pro institucional por ciclo lectivo)
  crean el link real y, pagados con una tarjeta de prueba, activan la licencia/suscripción
  con el período, el monto y la factura (CAE simulado) correctos.
- Un cobro recurrente real (la segunda vez que Mercado Pago cobra una `preapproval`, vía
  `GET /authorized_payments/{id}`) **trae el mismo `external_reference`** que el primer
  cobro de esa misma suscripción — confirma el supuesto que quedaba abierto en T4b.
- `PUT /preapproval/{id}` con `auto_recurring.transaction_amount` SÍ cambia el monto de
  una suscripción existente, tanto si se creó con el flujo viejo (`payer_email`) como con
  el nuevo (`preapproval_plan`) — confirma el otro supuesto de T4b.
- **El bug real de producción:** `payer_email` (el email de login de Kodu) casi nunca es
  una cuenta de Mercado Pago, así que un checkout de suscripción institucional fallaba al
  crearse ("Both payer and collector must be real or test users"). Se resolvió creando un
  `preapproval_plan` por checkout en vez de un `preapproval` directo — el `init_point` que
  devuelve ESE endpoint deja que quien paga use cualquier cuenta propia de Mercado Pago,
  sin que nosotros mandemos ningún email. La contrapartida: esa `preapproval` nunca trae
  `external_reference`, así que se agregó resolución por `preapproval_plan_id`
  (`OrganizationLicense.externalPlanId`/`IndividualSubscription.externalPlanId`/
  `Payment.pendingPlanId`), con protección contra que una segunda `preapproval` reutilice
  el mismo link de pago (se cancela y se ignora, nunca pisa al primer titular).
- El webhook real llega en DOS formatos: el nuevo, firmado (`?data.id=…&type=…` +
  `x-signature`), y el IPN legado (`?topic=…&id=…`, sin firma) — Mercado Pago todavía
  manda el segundo para Checkout Pro vía `notification_url` por-preferencia. El endpoint
  procesa los dos por la misma vía seguro-por-relectura (nunca confía en el cuerpo);
  cuando falta o no valida la firma, loguea los headers (nombres, nunca valores) y aplica
  un límite de tasa por IP para acotar abuso.
- Reenviar la MISMA notificación (de cualquiera de los dos formatos) nunca duplica el
  efecto (`ya_aplicado`/`ya_reclamada`).
- Cancelar desde `/app/plan` (o el endpoint) cancela la `preapproval` real en Mercado Pago
  (`status: "cancelled"`, verificado contra la API) y mantiene el acceso hasta el fin del
  período ya pagado, igual que con el adaptador simulado.
- Una `preapproval` creada FUERA de la app (sin ningún checkout de Kodu detrás) se ignora
  de forma segura y logueada, tanto al autorizarse como al generar su primer cobro real —
  no rompe nada ni confunde a otro checkout.

**Lo que falta (fuera de alcance de esta ronda):**

- Una SEGUNDA renovación real (un segundo cobro mensual consecutivo) — sólo se confirmó
  el primer cobro recurrente de cada suscripción; falta ver que el tercer/cuarto cobro
  siga trayendo el mismo `external_reference`/se siga aplicando sin intervención.
- La primera factura real en producción (ARCA, no el adaptador simulado) — ver T8c más
  abajo, segunda tarea de esta sección.
- La UI todavía no pide el "email de Mercado Pago" en ningún checkout — no hace falta,
  porque el nuevo flujo (`preapproval_plan`) no lo necesita, pero si en el futuro se
  agrega un checkout que SÍ llama a `POST /preapproval` directo (flujo viejo, todavía
  soportado para las suscripciones ya existentes), ese problema reaparece para cuentas
  nuevas que lo usen.

**Cómo repetir esta prueba:**

1. Credenciales de prueba reales en un archivo tipo `~/.credentials/mp-kodu-test.env`
   (fuera del repo, nunca commiteado) con `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y los
   datos del vendedor/comprador de prueba — "Tus integraciones" en el panel de Mercado
   Pago. Cargarlas con `set -a; . ~/.credentials/mp-kodu-test.env; set +a` antes de
   levantar el servidor.
2. Exponer el servidor local con un túnel (`cloudflared tunnel --url http://localhost:3200`
   u otro) y setear `PUBLIC_SITE_URL` al URL del túnel — así los checkouts de Checkout Pro
   (pago único) mandan su `notification_url` por-preferencia al servidor local de verdad.
   El checkout de PREAPPROVAL (suscripción) nunca manda ahí — su notificación va a la URL
   global configurada en el panel de Mercado Pago (normalmente la de producción), así que
   para probar ese camino localmente hay que reenviar la notificación a mano (firmada o
   como IPN legado) al mismo endpoint, con el `MP_WEBHOOK_SECRET` real.
3. `POST https://api.mercadopago.com/users/test_user` (con el access token del vendedor)
   crea compradores de prueba nuevos al vuelo — no hace falta quedarse con uno solo.
4. Levantar el dev server con `BILLING_PROVIDER=mercadopago`, `MP_ACCESS_TOKEN`,
   `MP_WEBHOOK_SECRET`, `VITE_ALLOWED_HOSTS=<host del túnel>` (nunca en `.env`: todo por
   variable de entorno en el comando, así no queda nada apuntando al sandbox en el
   worktree). Dejar `INVOICE_PROVIDER=simulado` salvo que también se esté probando ARCA.

## Antes de salir a producción

`npm run test:cobros` y el paseo manual de arriba sólo cubren los adaptadores `simulado`;
la sección de arriba cubre lo que sí se probó contra el sandbox real de Mercado Pago
(T4c). `odd/tasks/planes-y-cobros.md` deja estas dos tareas abiertas (T8b, T8c):

1. **Homologación de ARCA (T8c).** Nunca se corrió contra el servicio real de ARCA (ni
   siquiera homologación) — sólo contra el adaptador `simulado`. Hace falta el
   certificado de homologación del dueño (`ARCA_CERT_PATH`/`ARCA_KEY_PATH` o sus
   variantes `_BASE64`, con `ARCA_ENV="homologacion"`) y correr un alta real para
   confirmar que WSAA/WSFEv1 responden como esperan `src/lib/billing/facturador/arca.ts`
   y `e2e/unidad-facturador.ts`.

3. **Umbral de identificación del consumidor final (T8b).** Hoy TODO pago individual sale
   facturado como consumidor final sin DNI/CUIT. No se pudo confirmar en una fuente
   oficial de ARCA a partir de qué monto una Factura C a consumidor final exige pedir
   DNI/CUIT. Confirmar ese umbral antes de facturar de verdad — si existe, falta pedir el
   dato en el checkout individual por encima de ese monto.

### Variables de entorno a cargar en Coolify (o el deploy que uses)

- `BILLING_PROVIDER="mercadopago"` (nunca dejarlo en `"simulado"` en producción: si falta
  `MP_ACCESS_TOKEN`, los endpoints de checkout se niegan solos, no simulan un cobro real).
- `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` (credenciales de PRODUCCIÓN de Mercado Pago,
  una vez probado el sandbox de arriba).
- `INVOICE_PROVIDER="arca"` (con `ARCA_ENV="produccion"` sólo cuando ya se probó
  homologación) y las `ARCA_*` (`ARCA_CUIT`, `ARCA_PUNTO_VENTA`, certificado/clave).
- `INTERNAL_CRON_SECRET` + un cron (en Coolify o el scheduler que uses) que llame
  periódicamente a `POST /api/internal/recordatorios-renovacion` con el header
  `x-internal-secret: <ese secreto>` — es el aviso de renovación a 30 y 7 días del plan
  Individual anual y del ciclo lectivo institucional (T4b). Sin este cron, nadie recibe el
  aviso antes de que se les venza el período.
- `RESEND_API_KEY` + `RESEND_FROM` si todavía no están cargadas (hacen falta para que el
  recordatorio de renovación efectivamente mande un mail, no sólo quede registrado).

### Otras dos cosas a revisar antes de cobrar de verdad

- **Precios reales ya cargados (T11).** El seed/migración carga los precios de lanzamiento
  del dueño (bandas institucionales y plan Individual) — siguen siendo editables desde
  `/admin/precios` si cambian. Confirmalos ahí ANTES de activar
  `BILLING_PROVIDER="mercadopago"` en producción, por si ya los tocaste a mano.
- **Tope del monotributo.** `BillingSettings.monotributoAnnualCapArs` (editable en
  `/admin/precios`) es el tope que dispara los avisos del 70%/90% en `/admin/facturacion`
  y en el banner global de `/admin`. Confirmar que el valor cargado es el tope vigente de
  la categoría del dueño — hoy es un valor de ejemplo.
