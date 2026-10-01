# Planes, precios y cobros

Documento vivo de la feature (flujo ODD). Espejo en Engram: proyecto `kodu`, tópico `odd/planes-y-cobros/tasks`.
Rama `feat/planes-y-cobros` (worktree `../kodu-wt/planes`), cortada de `origin/main` en `3bddaac`.
Base de datos propia `koduedu_planes` en `kodu_db_dev`, servidor en el puerto 3200.

## Objetivo

Que Kodu se pueda contratar y pagar desde la app, con precios públicos y transparentes:

- **Instituciones** (colegio o red de colegios): licencia institucional por matrícula, docentes ilimitados, pago
  mensual o por ciclo lectivo, prueba de 30 días, alta por cuenta propia.
- **Docentes individuales** (sin institución): créditos que se consumen según el costo real de la IA; plan Gratis y
  plan Individual pago.

## Problema

- No existe ningún código de cobro, planes ni créditos.
- Hoy una cuenta personal (sin organización) no puede usar la IA (`src/lib/orgs/acceso.ts`); el dueño ya había
  dicho que "más adelante tendrá precio propio". Esta feature lo implementa.
- Las organizaciones hoy solo las crea el superadmin. Tiene que existir un alta por cuenta propia sin abrir la puerta a
  que cualquiera reclame un dominio ajeno.

## Decisiones del dueño (no reabrir)

- **Se cobra en pesos con Mercado Pago.** Dólares, más adelante.
- **Instituciones: licencia por matrícula (cantidad de alumnos), docentes ilimitados.** No se cobra por docentes ni
  por uso: el costo variable desincentiva que el colegio motive a sus docentes. Nunca se bloquea el alta de docentes.
- **Bandas de matrícula:** Pequeña hasta 300, Mediana 301–800, Grande 801–1.500, más de 1.500 o redes grandes:
  "Hablemos". Una red declara la matrícula total de sus sedes.
- **Precios públicos y calculadora:** el colegio pone su matrícula y ve plan y precio. Se puede contratar solo; si
  hace falta, el dueño confirma la matrícula y los dominios por detrás sin frenar la prueba.
- **Ciclo lectivo = 1 de marzo al último día de febrero.** El plan de ciclo lectivo cuesta 10 cuotas y cubre 12
  meses. También hay pago mensual.
- **Alta a mitad de año:** de marzo a agosto se paga la parte proporcional hasta fin de febrero (a la tarifa del
  ciclo); de septiembre a diciembre se contrata el ciclo siguiente y lo que queda del año va de regalo. En enero y
  febrero se contrata el ciclo que empieza en marzo, con esos días de regalo.
- **Prueba de 30 días** para instituciones, sin tarjeta. Al terminar sin pago: solo lectura (ven sus recursos, no
  generan).
- **Individuales:** plan Gratis con 100 créditos de bienvenida (únicos) + 50 por mes (no se acumulan); plan
  Individual mensual o anual con 1.000 créditos por mes. Organizaciones no tienen créditos.
- **Redes:** varios dominios de mail, sedes, e invitaciones (ya existen en el modelo de organizaciones).
- **Los precios se editan desde el superadmin**, no quedan fijos en el código. Los valores iniciales son de ejemplo.
- **Facturación:** el dueño es monotributista; emite Factura C. No facturar no es opción (ver "Por qué").

## Decisiones de diseño (de esta sesión)

- **1 crédito = USD 0,0025 de costo real** (configurable). Un recurso nuevo ≈ 10 créditos.
- **Puertos y adaptadores** para cobro y facturación: `PaymentGateway` con adaptador `simulado` (local y e2e) y
  `mercadopago`; `Invoicer` con adaptador `simulado` y `arca` (WSFE, homologación primero). Se elige por env.
- **Dominio del creador verificado al instante** (ya verificó su mail); los dominios extra quedan pendientes hasta que
  el superadmin los confirme. Dominios públicos (gmail, hotmail, outlook, yahoo, etc.) rechazados.
- **Organizaciones existentes** (Reditinere y las creadas a mano) quedan como licencia `MANUAL` activa: nada cambia
  para quienes ya usan Kodu.
- **Pago fallido:** 7 días de gracia y después solo lectura.
- **Webhooks idempotentes**: nunca se confía en el cuerpo del webhook; se relee el recurso en el proveedor.
- **Aviso del tope del monotributo** en el superadmin (facturado en los últimos 12 meses contra un tope editable).
- **Estrategia de entrega:** `single-pr` — el dueño mergea las features enteras a `main` (así se hizo con
  organizaciones y taller). Commits por unidad de trabajo en la rama.

## Por qué

- El colegio quiere un costo fijo para su presupuesto; la IA cuesta USD 0,43–1,58 por docente activo por mes, así que
  una licencia fija cubre el costo con margen aunque la usen a fondo.
- Mercado Pago informa a ARCA lo que se cobra y los colegios necesitan la factura para registrar el gasto: no facturar
  expone a multas y a una recategorización o exclusión de oficio.

## Alcance autorizado

Modelo de datos, reglas de ciclo y bandas, créditos, acceso según estado de licencia, cobro con Mercado Pago (y
simulado), alta de instituciones, páginas `/precios`, `/app/plan`, `/org/plan`, superadmin de precios, revisión de
altas y cobros manuales, facturación Factura C, y un modo de prueba local completo. La revisión amplia de los
paneles de admin queda para después (el dueño lo pidió aparte).

## Modo TDD y chequeos

- **TDD: apagado.** Fuente: no hay configuración de TDD en el proyecto ni pedido del usuario; no hay test runner.
- **Chequeos por tarea:** `npm run check` (tsc), `npm run build`, scripts unitarios `npx tsx e2e/unidad-*.ts` y e2e
  `npx tsx e2e/<script>.ts` contra `KODU_BASE_URL=http://localhost:3200`, con el patrón de `e2e/harness.ts`.
- RDD: apagado por el usuario (global) — sin revisión nativa.

## Tareas

Ruta: todas delegadas (tocan 2+ archivos no triviales → disparador de escritor).

- [x] **T1 — Modelo y reglas.** Migración `20261012000000_planes_y_cobros`: catálogo de precios editable (bandas
  institucionales e individuales), licencia/suscripción de organización (estado, período, matrícula declarada, razón
  social, CUIT), suscripción individual, pagos, facturas, libro de créditos, estado de dominio (verificado/pendiente).
  Organizaciones existentes → `MANUAL` activa. Módulo puro `src/lib/billing/` con bandas, ciclo lectivo, prorrateo y
  regla de fin de año. Chequeo: `e2e/unidad-planes.ts`.
- [x] **T2 — Créditos individuales.** Libro de créditos (bienvenida 100, 50/mes perezoso, 1.000/mes Individual), débito
  desde `costUsd` en `recordUsage` solo para cuentas personales, gate en `puedeUsarLaIa` y endpoints, saldo en el
  encabezado y mensaje de "sin créditos". Chequeo: unidad + e2e.
- [x] **T3 — Acceso por estado de licencia.** Prueba, activa, gracia de 7 días, solo lectura; `MANUAL` siempre activa.
  Chequeo: e2e.
- [x] **T4 — Cobro.** Puerto `PaymentGateway`, adaptador simulado (página local de pago con aprobar/rechazar que
  dispara el webhook), adaptador Mercado Pago (suscripciones + pago único para el prorrateo), webhook idempotente,
  endpoints de checkout para institución e individual, cancelación y arrepentimiento. Chequeo: e2e con simulado.
- [x] **T5 — Alta de instituciones.** Formulario (nombre, colegio o red, matrícula, dominios, sedes), bloqueo de
  dominios públicos, dominios extra pendientes, arranque de la prueba, aviso al superadmin. Chequeo: e2e.
- [x] **T6 — Páginas.** `/precios` pública con calculadora y tarjetas (mensual / ciclo lectivo), `/app/plan`,
  `/org/plan`, preguntas frecuentes, en el design system de kodu. Chequeo: build + capturas.
- [x] **T7 — Superadmin.** Editor de precios, cola de revisión (confirmar dominios y matrícula), activación manual
  por transferencia, facturado contra tope del monotributo. Chequeo: e2e.
- [x] **T8 — Facturación.** Puerto `Invoicer`, adaptador simulado y ARCA WSFE (homologación), Factura C al aprobarse un
  pago, CAE guardado, reintento si ARCA falla. Chequeo: unidad + e2e con simulado.
- [x] **T2b — Débito sin precio.** Si el motor no tiene precio cargado, `costUsd` queda nulo y a una cuenta personal
  no se le descuenta nada. Descontar con una estimación conservadora por tokens (o el precio del motor por defecto) y
  avisar en el superadmin. Encontrado en T2.
- [x] **T4b — Renovación del ciclo y del anual.** Mercado Pago no garantiza (no se pudo confirmar) que una suscripción
  con `frequency: 12` cobre una vez por año, así que el ciclo lectivo y el anual individual se cobran como pago único y
  se renuevan con un nuevo checkout. Falta: aviso 30 días antes del fin (banner + mail por Resend si está configurado)
  con el enlace para pagar el ciclo siguiente.
- [ ] **T4c — Probar con el sandbox real de Mercado Pago.** Credenciales de prueba del dueño + túnel para el webhook.
  Confirmar dos supuestos no verificados: que `PUT /preapproval` cambia el monto, y que cada cobro recurrente trae el
  mismo `external_reference` (de eso depende distinguir primer cobro de renovación en `aplicar.ts`).
- [ ] **T10 — Créditos al pasarse a Individual.** Hoy el pago completa la asignación del mes hasta 1.000 contando los 50
  gratis ya dados: quien gastó sus 50 y paga recibe 950. Propuesta: dar 1.000 nuevos al pagar. Pendiente de decisión.
- [ ] **T8b — Umbral de identificación del consumidor final.** No se pudo confirmar en fuente oficial el monto desde el
  cual una Factura C a consumidor final exige DNI/CUIT. Hoy todo pago individual sale como consumidor final. Confirmar
  antes de facturar de verdad con ARCA.
- [ ] **T8c — Probar ARCA en homologación** con el certificado del dueño (nunca se ejecutó contra ARCA real).
- [x] **T9 — Prueba local.** `docs/probar-cobros.md` con el paso a paso manual y un e2e del recorrido completo
  (individual e institución).

## Progreso y evidencia

- 2026-09-30: worktree, base `koduedu_planes` con migraciones al día, `npm run check` verde en la base.
- T1 (delegada, disparador de escritor): `8eb8a9d` modelo + migración + seed, `436d2cb` módulo `src/lib/billing/`.
  Chequeos: migrate deploy OK, seed ×2 idempotente, `npm run check` verde, `unidad-planes.ts` 39/39 (re-corrido por el
  orquestador), `unidad.ts` 77/77. Semántica: créditos mensuales vencen al cambiar de mes (entrada `EXPIRY`), bienvenida
  nunca vence; débito con `ceil`, mínimo 1; prorrateo con `Math.round` sobre días inclusivos; Argentina como UTC-3 fijo.
  La licencia vive solo en la organización raíz (convención, no forzada en la base); `IndividualSubscription` solo
  existe para el plan pago (sin fila = Gratis). Licencias `MANUAL` con `declaredStudents = 0`.
- T2 `11cd423` y T3 `c154510` (delegadas juntas: ambas tocan el acceso). `resolverAccesoIa` en `src/lib/orgs/acceso.ts`
  devuelve una razón legible por máquina; `puedeUsarLaIa` queda como envoltorio. Raíz sin licencia → `license_missing`
  (falla cerrado y se loguea). Solo lectura deja abrir el editor con un aviso. Chequeos: check verde, build verde,
  `unidad-planes` 39/39, `unidad` 77/77, `unidad-creditos` 9/9 (re-corrido por el orquestador), `planes-acceso` 8/8,
  `org-acceso` 7/7, `consumo-proposito` 8/8 (se les agregó licencia `MANUAL` a sus organizaciones de prueba y se
  actualizaron dos escenarios que suponían "cuenta personal = siempre bloqueada").
- T4 y T2b (delegadas): `0d746dc`, `cd8666e`, `ac4e811`, `8842083`, `d0b29be`. Puerto `PaymentGateway` con adaptadores
  `simulado` (página `/pago-simulado/[id]`, solo con `BILLING_PROVIDER=simulado`) y `mercadopago` (fetch, sin SDK),
  webhook con `x-signature` que relee el recurso y es idempotente, `src/lib/billing/aplicar.ts` como único lugar que
  aplica efectos. Mensual = suscripción; ciclo lectivo y anual = pago único (ver T4b). El arrepentimiento marca el pago
  para reintegro manual (no hay reintegro automático). Hechos de Mercado Pago confirmados por búsqueda, no por la
  página oficial (daba 404 a WebFetch). Chequeos: check y build verdes; re-corrido por el orquestador `unidad-planes`
  45, `unidad` 77, `unidad-pasarela` 14, `unidad-creditos` 9 — todos verdes; `planes-cobro` 12/12 y `planes-acceso`
  8/8 según el escritor.
- T5 (delegada): `dc3bfa4`, `c0ed331`, `901b528`. `src/lib/billing/alta.ts` (alta atómica, rama "Hablemos" con
  `InstitutionLead`), `src/lib/billing/revision.ts` (cola para el superadmin, con contador en `AdminLayout`), la
  resolución por dominio ignora dominios `PENDING`. Una cuenta personal existente con el dominio nuevo se une en su
  próximo login (misma regla `unirSiCorresponde` de siempre), no al crear la institución. Cambios colaterales: el
  default de `OrganizationDomain.status` pasó a `VERIFIED` (si no, el alta manual del superadmin y los fixtures
  quedaban pendientes) y `astro.config.mjs` permite el destino real de un `node_modules` symlinkeado (worktrees; sin
  efecto en un checkout normal). Chequeos: check, build, `planes-alta` 11/11 + capturas claro/oscuro, `planes-acceso`
  8/8, `planes-cobro` 12/12, `org-acceso` 7/7, `org-invitaciones` 16/16 según el escritor; `unidad-planes` re-corrido
  por el orquestador.
- T6 (delegada): `a81e980`, `3e4dce1`, `7633a43`, `211273d`. `/precios` (calculadora, bandas desde la base,
  mensual/ciclo lectivo, docentes, tabla comparativa, 10 preguntas), `/app/plan`, `/org/plan` (vista previa de
  `firstCharge` antes de pagar; admin de sede solo lectura), endpoints `org/preview` y `org/matricula`, link "Precios"
  en la navegación (se arregló un desborde a 390 px). Chequeos según el escritor: check, build, `planes-paginas`,
  `planes-acceso` 8/8, `planes-cobro` 12/12, `planes-alta` verdes; capturas 1280/390 claro/oscuro. El orquestador
  revisó la captura de `/precios` a 1280 claro.
- T7 y T4b (delegadas): `7de0bd5`…`7b167a3` (8 commits). `/admin/precios` (precios y ajustes con auditoría; los
  rangos de las bandas no se editan porque son decisión del dueño), `/admin/altas` (verificar/quitar dominios, matrícula,
  extender prueba, marcar revisada, leads), activación manual por transferencia, `/admin/facturacion` (pagos, facturas,
  reintento cableado a T8, tope del monotributo con avisos al 70% y 90%). Renovación: aviso 30 días antes, checkout de
  renovación sin solapar ni regalar dos veces, mails a 30 y 7 días idempotentes vía `/api/internal/recordatorios-renovacion`
  (pide `INTERNAL_CRON_SECRET` y un cron en el deploy). El escritor no hizo el e2e: lo hizo un segundo escritor,
  `89dc0f3` `e2e/planes-superadmin.ts`, todo verde, sin defectos de producto.
- **Defecto encontrado por el orquestador:** la migración de T7 se llamaba `20261001005436_…` (fecha real del reloj) y
  se ordenaba ANTES de `20261012000000_planes_y_cobros`, cuyas tablas modifica: un `migrate deploy` desde cero (producción)
  fallaba. Renombrada a `20261014000000_admin_billing_t7_t4b` en `4436730`; probado `migrate deploy` en una base vacía y
  `migrate diff` contra el schema sin diferencias. Regla: las migraciones de esta rama van de `20261012…` en adelante.
- T8 (delegada): `4d6041c`, `cf67af0`, `fe283f8`. Puerto `Invoicer` con adaptadores `simulado` y `arca` (WSAA con
  `openssl cms`, WSFEv1 por SOAP, Factura C tipo 11, Concepto 2 con fechas del período, `CondicionIVAReceptorId`
  obligatorio desde RG 5616). Nueva condición frente al IVA en la licencia, pedida en `/org/plan`. La emisión corre fuera
  de la transacción del webhook; el bloqueo `PENDING|FAILED → ISSUING` evita emitir dos veces. Sin `INVOICE_PROVIDER` en
  producción las facturas quedan pendientes con aviso. Chequeos según el escritor: check, build, `unidad-facturador`
  13/13 (incluye firma real con openssl), `planes-facturacion` 7/7, regresiones verdes.
- T9 (delegada): `1c609c6`, `14e2259`, `840dddc`, `6fa7ecf`. `npm run test:cobros` (11 scripts, levanta y baja su propio
  servidor, se niega a correr contra una base que parezca de producción), `e2e/planes-recorrido.ts` (recorridos
  completos en navegador), `docs/probar-cobros.md` + link en el README. El escritor corrigió 5 problemas de los tests
  (hidratación, URL absoluta de invitación, selectores, dos aserciones mal planteadas); ninguno del producto.
- **Verificación independiente del orquestador (2026-10-01):** `npm run test:cobros` 11/11 verde en 332,8 s;
  `migrate deploy` en base vacía + `migrate diff --exit-code` sin diferencias; con el servidor en 3200: `org-acceso`,
  `consumo-proposito`, `org-invitaciones`, `admin-organizaciones`, `admin-metricas` verdes.

## Próximo paso

Que el dueño pruebe en local con `docs/probar-cobros.md`. Pendientes antes de producción: T4c (sandbox de Mercado
Pago), T8b (umbral de identificación), T8c (ARCA homologación), precios reales en `/admin/precios`, y decidir T10.
