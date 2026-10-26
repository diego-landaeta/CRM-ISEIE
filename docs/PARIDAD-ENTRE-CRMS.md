# Paridad entre los dos CRM (MultiCRM y CRM-ISEIE)

> **El mismo documento en los dos repositorios.** Si cambias uno, cambia el otro.
> La regla del proyecto es paridad absoluta salvo la marca (Diego, 15/10: «tienen
> que estar en ambos CRM todas las cosas»). MultiCRM es la base; ISEIE va un
> escalón detrás. Las diferencias que quedan son de tres clases: **decisiones**
> (escritas aquí con su porqué), **preguntas para Diego** y **pendientes** (se
> portan, pero no han cabido todavía).

## Estado al 26/10/2026

Comparación de los dos `origin/staging` del 26/10 (MultiCRM `bd6044c3`, ISEIE
`33cab573`) con **todas las PR fusionadas desde el 11/09** en `main` y `staging`
de los dos repos (162 del 360, 119 de ISEIE). Para cada PR del 360 se buscaron
sus líneas añadidas en el fichero equivalente de ISEIE, y lo que faltaba se miró
a mano (la numeración de migraciones y los nombres de las pruebas son distintos,
así que eso no cuenta como diferencia).

**Conclusión:** todo lo que entró en MultiCRM entre el 15/10 y el 26/10 con PR
gemela está también en ISEIE, con las adaptaciones de siempre (rutas, marca,
`enPruebas` frente a `soloEnPruebas`, su propia guarda del build). Lo que faltaba
es lo de los colaboradores externos (Diana y Hugo), que solo trabajan en
MultiCRM y cuyo traslado a ISEIE «lo hacéis vosotros».

### Portado a ISEIE el 26/10 (PR `feat/paridad-iseie-2610`)

| Qué | PR del 360 | Issue ISEIE | Notas |
|---|---|---|---|
| MCP: `cuentas_publicitarias`, `resumen_publicidad`, `campanas_publicitarias` (#235) | #347 | #207 | Mismo código. Solo super admin y admin; nunca el token. Sin migración: las tablas de Publicidad (071, 072) ya estaban |
| MCP: `actividad_por_comercial` (#203, parte A) | #348 | #195 | Mismo código; `wa_mensajes` (128) y `lead_interactions` ya estaban |
| Configuración → Usuarios: la tabla no se sale por la derecha (#221) | #451 | #202 | **Adaptado**: la tabla de ISEIE es otra (cuatro columnas, en `SettingsPage.jsx`); se arregla su caja (`overflow-x-auto`) y las acciones no se parten. Prueba `__smoke__/usuariosTablaAncho-202` |

Pruebas: `publicidadEnClaude`, `actividadEnClaude`, `mcpAmbito`, `mcpIntegracion`
(106/106 contra una base local nueva) y la del frontal (falla sin el arreglo).

**Queda detrás:** la PR #484 del 360 (correcciones del QA del 22/10 en la
publicidad de Claude: gasto por el campus de la fila diaria, índice en
`lead_utms.utm_campaign` —migración 224 del 360— y tope de 8 s) sigue **abierta**.
Cuando se fusione allí, se trae igual.

### Ya estaban en los dos (11/09 → 26/10)

Cada PR del 360 tiene su gemela en ISEIE: #251/#252 → #88 · #254 → #86 ·
#256 → #89 · #263 → #90 · #264 → #91 · #266 → #93 · #268 → #95 · #283 → #97 ·
#287 → #99 (sin la parte de Sistema → Correos, que ISEIE no tiene: pregunta 2) ·
#288 → #102 · #296 → #109 · #297 → #110 · #302 → #113 · #308 → #114 ·
#309 → #115 · #314 → #117 · #316 → #118 · #321 → #121 · #323 → #123 ·
#324 → #124 · #327 → #125 · #328 → #126 · #329 → #127 · #330 → #128 ·
#331 → #129 · #333 → #130 · #339 → #133 · #337 → #131 · #340 → #134 ·
#342 → #136 · #293/#303/#304/#305/#319/#320/#332 (#202) → #140 ·
#300/#306/#312/#334 (Certifex) → #142 · #350 → #143 · #356 → #146 ·
#359 → #148 · #361 → #150 · #363 → #152 · #364 → #153 · #366 → #155 ·
#367 → #156 · #369 → #158 · #373 → #162 · #375 → #166 · #376 → #167 ·
#380 → #221 · #402 → #224 · #420 → #227 · #421 → #228 · #425 → #232 ·
#428 → #235 · #431 → #238 · #438 → #244 · #441 → #242 · #443 → #247 ·
#447 → #250 · #456 → #254 · #458 → #256 · #487 → #259 · #494 → #263. Las de
Fabián del 02/10 (#152 Convocatorias, #154 Próximos cobros, #155 cola del día,
#156 atajos) también están (salvo `ProximosCobros`, que va con la «cabecera de
cobros» de Clientes, pendiente desde el 15/10). Las de `main` (#174, #181–#183,
#201, #205 —ISEIE no tenía el fallo—) también.

**De ISEIE a MultiCRM no hay nada nuevo desde el 15/10**: #135 (Actividad, módulo
que solo tiene ISEIE y que en MultiCRM cubre el Registro) y #164 (la versión junto
al logo, que MultiCRM ya enseñaba).

### No aplica en ISEIE (diferente a propósito o por estructura)

| Qué | PR del 360 | Por qué |
|---|---|---|
| «Árbol de categorías» apuntaba a una ruta muerta (#79) | #414 | En ISEIE `/configuracion/categorias-arbol` **sigue viva** (ruta, menú y prueba de humo): no hay enlace roto |
| Logos rotos y subtítulo de Configuración → Proyectos (#222) | #452 | ISEIE no tiene esa pantalla ni logos por proyecto (la marca va en Configuración → Marca). Su gemela ISEIE #203 no tiene nada que arreglar |
| Remitente «MultiCRM» por defecto en tres trabajos (#308) | #308 | Marca |
| Tareas / tablero (#210 y lo nuevo: por empresa, supervisor, Meta solo lectura) | #249, #282, #292, #294, #307, #313, #315 | Lo lleva otro trabajo en curso; no se ha tocado aquí |
| Permisos por acción (#423) | #489 | Lo lleva otro trabajo en curso (gemela ISEIE #230); no se ha tocado aquí |
| Permiso «Diplomas · Ver/Emitir» (#384, #437) | #402, #438 | Ya está en ISEIE, con su propio `PermisoDiplomas.tsx` en Roles (MultiCRM lo tiene dentro de su editor de permisos). Entra en la #230 |

### Para que decida Diego (no portado)

Son bloques grandes, con migraciones, y los cuatro tienen **correcciones de QA
abiertas** en el 360 (PR #482 a #485, del QA del 22/10). Portarlos ahora sería
portar dos veces.

1. **Consultas de alumnos** (#187–#190; PR del 360 #353, #354, #355, #358;
   gemelas ISEIE #189–#192). Unas 8.000 líneas: módulo `consultas`, cliente de
   Moodle, `tutor.campus.js`, migraciones 208–211 del 360, seis trabajos
   programados (`consultas*Scheduler`, `tutoresCampusScheduler`) y pantallas en
   Tutores. La épica #185 dice que ISEIE se replica **cuando esté validado en
   MultiCRM**; la #483 (QA) sigue abierta.
2. **Matrículas: solicitudes y webhook de admisión** (#198, #199; PR del 360 #341,
   #436, #449; gemelas ISEIE #193, #194). Migraciones 212–213 del 360, descarga de
   documentos desde URL de terceros (con su defensa contra SSRF), `MatriculasFiltros`.
   La #449 dice «para QA en /testeo, no para producción»; la #482 (QA) sigue abierta.
3. **Formularios con el mismo formato** (#106; PR del 360 #352, #454; gemela ISEIE
   #177). 42 ficheros del frontal, entre ellos los de dinero (`ConversionDialog`,
   `RegisterSaleDialog`, `InvoiceCreatePage`) y Tutores. Se apoya en las
   primitivas del rediseño (#32), que ISEIE no tiene. La #485 (QA) sigue abierta.
4. **El rediseño del frontal**: usuarios como módulo (#31, PR #58), el marco
   —cabecera fija, apartados, menú denso— (#33, PR #69) y los tokens y primitivas
   (#32, cerrada en MultiCRM el 07/10). Gemelas ISEIE #12, #13 y #14, abiertas.
   Ya estaban en la lista del 15/10 como «pendiente» / «estructural».

### Gemelas abiertas en ISEIE con la del 360 ya cerrada (más antiguas)

Para revisar una a una; ninguna es de las últimas seis semanas salvo la #13:
ISEIE #6 (= 360 #25, plantillas de WhatsApp compartidas), #12 (#31), #13 (#32),
#14 (#33), #21 (#40, filtros en Clientes y Matrículas), #28 (#49, rutas en
español), #29 (#50, tipografía de administración), #31 (#4, selectores de
Documentos) y #32 (#5, botón del Chat IA en el dock: la IA sigue aparcada en
ISEIE, ver pregunta 1).

### Migraciones (26/10)

Ninguna. Lo portado no toca el esquema. (La numeración libre en ISEIE empieza en
**235**: la 234 la usa ya la rama `feat/equipo-tareas-empresa`.)

---

## Estado al 15/10/2026

Comparación de los dos `origin/staging` del 15/10. Lo de este día entró por los PR
`feat/paridad-resto` de los dos repos; el tablero de tareas (#210) y las facturas
de colaboradores (#202) entraron en ISEIE por sus propios PR (#139 y #140).

### Módulos que solo tenía uno

| Qué | Dónde estaba | Decisión | Motivo / dónde está escrito |
|---|---|---|---|
| Certifex · Diplomas (#272), programa oficial al emitir, A3, «Editar», «terminaron sin pedir» | MultiCRM | **Portado** a ISEIE | Migración ISEIE **230** (= 199 de MultiCRM). Pruebas `certifexDiplomas`, `certifexEmisiones`, `__smoke__/certifexDiplomas` |
| #312 «Sincronizar módulos con el producto» | MultiCRM | **Portado** | `products/temario.js` + CRUD `/products/:id/modules` (ISEIE no lo tenía) |
| #334 (Certifex#96): enlaces locales, modalidad, resultado de cada diploma del lote | MultiCRM | **Portado** | Mismo código en los dos |
| `registro` (Sistema → Registro, #111) | MultiCRM | **Portado** | Migración ISEIE **231** (= 144). Pruebas `registro`, `registroContraLaBase` |
| `messages` (Sistema → Mensajes, chat del equipo) | MultiCRM | **Portado** | Migración ISEIE **232** (= 064). Prueba nueva en los dos: `mensajesDelEquipo` |
| `client-errors` (errores del navegador al servidor) | ISEIE | **Portado** a MultiCRM | Prueba nueva en los dos: `erroresDelNavegador` |
| `/api/health/detailed` | ISEIE | **Portado** a MultiCRM | — |
| Límite de intentos en `/auth/set-password` | ISEIE | **Portado** a MultiCRM | 8 cada 15 min por IP |
| `pasoVencidoScheduler`, `estado-prospecto.service` (`avanzarPorContacto`) | MultiCRM | **No portado** | **Decisión**: en ISEIE los cambios de estado del prospecto los hace una persona; en MultiCRM los mueve el contacto apuntado. (Diego, 30/09; no estaba escrito en el repo y queda aquí.) En producción de MultiCRM el job de las 3:00 va apagado (`PASO_VENCIDO_DISABLED=1`) |
| `claude-chat`, `ia-analisis`, `gastoIA.service`, frontal `ai-chat` (Chat IA) | MultiCRM | **No portado** | **Decisión**: aparcado. `Sidebar.jsx` de ISEIE (#226): «en MultiCRM la pantalla existe pero está aparcada —fuera de su menú hasta la fase 5— y depende de la API de Claude». En ISEIE sale como «Próximamente» |
| `audiences`, `ia-monitor`, `reports-ia` y sus pantallas | MultiCRM | **No portado** | **Decisión**: `docs/DIFERENCIAS-CRM-HERMANO.md` §1 de ISEIE (módulos del modo IA; las migraciones 013 y 028 «nunca se portan»). Ver pregunta 1 |
| `campaigns` (Campañas) | MultiCRM | **No portado** | **Decisión**: en MultiCRM va con datos inventados (`USE_MOCKS`); en ISEIE «Próximamente» (#226, `Sidebar.jsx` de ISEIE; `DIFERENCIAS-CRM-HERMANO.md` §7) |
| `correos` (Sistema → Correos, #146), `correoEntranteScheduler`, envío por el buzón propio y copia en «Enviados» | MultiCRM | **Pregunta 2** | Necesita tres dependencias que ISEIE no tiene (`imapflow`, `mailparser`, `nodemailer`), las migraciones 166 y 171 de MultiCRM y un buzón por campus |
| `users` (Configuración → Usuarios como módulo, #31) | MultiCRM | **Pendiente** | ISEIE gestiona usuarios dentro de `shared/pages/SettingsPage.jsx` con el mismo backend. El de MultiCRM son 2.672 líneas de frontal (buscador, filtros, paginación, enlace de invitación): va en un PR propio |
| `avisoTutorScheduler` | MultiCRM | **No portado** (pregunta 3) | En MultiCRM **no lo arranca nadie** (solo lo usa la vista previa de correos): es código muerto |
| `dev`, `ui-preview`, `suitedash-preview` | MultiCRM | **Fuera** (pregunta 4) | Maquetas y pruebas de /testeo y /testeo2, detrás de `UI_PREVIEW_ENABLED`, `IS_TESTEO2_BASE` y modo dev |
| `accounts-payable` como módulo del frontal | ISEIE | Estructural | En MultiCRM la misma pantalla vive en `accounting`; no cambia nada para quien la usa |
| Actividad (`/activity`, `/users/activity-log`) | ISEIE | Se queda | En MultiCRM lo cubre el Registro, que ahora también está en ISEIE |

### Arreglos que uno tenía y el otro no (portados el 15/10)

**A ISEIE, de MultiCRM:** la API no se cae por una promesa rechazada sin capturar
(a5087a0e) y recupera los adjuntos de WhatsApp al arrancar · `req.user.id` → `userId`
en documentos, formularios, nóminas, tokens de webhook, WooCommerce, matrículas y
facturas (c0d23456) · `reassign-pending` ya no reparte fichas borradas ni spam
(93bdf4a7) · preferencias de vista sin 403 (ff35f0d6) · cambiar contraseña sin
contraseña puesta (86c5be82) · categorías del listado de productos (apagadas desde el
arranque) · proyectos: `update` guarda y el listado devuelve las columnas que ya
existían · el cliente no repite un POST tras un 502 (518f6b81) · el chat de WhatsApp
no se rompe (bd6c78ce) · Comisiones: % y base · `/products/${proyecto}` en Cursos
pendientes, reglas de comisión y pipeline (116757f4) · DOMPurify en la ficha de
producto · tutorial del webhook de Stripe (6d7e1942) · buscador de formación sin
tildes (22cf5ee5) · la campana solo cuenta lo no leído · `ConfirmDialog` y
`PromptDialog` accesibles · enlace de Emisiones a `/leads/:id`.

**A MultiCRM, de ISEIE:** `client-errors`, `/api/health/detailed`, límite en
`set-password`, filtro de fechas en hora local (no UTC), y `pdf-parse` cargado al leer
el primer PDF (si faltara el paquete, la API ya no deja de arrancar).

**En los dos:** la clave del límite de `client-errors` y de documentos era
`ipKeyGenerator(req)` (el objeto, no la IP: un cupo para todos) → `req.ip`; el
ErrorBoundary manda a `API_BASE_URL` (en ISEIE, desde /staging iba a la API de
producción); en MultiCRM, el buscador (Ctrl+K), «g a» y la campana llevaban a
`/accounting/…`, `/revenue`, `/commissions` y `/payroll`, que allí no existen.

**CI de ISEIE (PR aparte):** en rojo desde el 13/10. Se crea el rol
`crm_iseie_user` en la base de la CI (la 052 le da permisos), se traen los
`eslint.config.js` de MultiCRM y se arreglan los 13 errores de tipos. El linter
cazó cinco fallos reales: `reservarNumero` no existía (cambiar el número de una
factura daba 500), `toast` sin importar en Reportes, importar CSV reventaba al
terminar, «Reportar spam» desde la lista no pasaba la ficha, y el `useCallback`
del chat. Cinco pruebas desfasadas del código se sustituyen por las de MultiCRM.

### Diferencias dentro de módulos comunes que quedan (por importancia)

**Le falta a ISEIE (con backend por portar):**

- **Facturación**: número de factura elegido a mano al emitir y al registrar la
  venta, aviso de factura duplicada, bloqueo de emisor sin CIF (30df5fd8, 809da5e4)
  y `numera_al_convertir` (migración 158). Ver pregunta 5.
- **Prospectos**: filtros rápidos y contadores en el servidor (`/leads/quick-counts`,
  `qf`, #132; en ISEIE se cuentan sobre la página cargada y salen mal), repaso mensual
  (`/leads/revision`, migración 155), avisos `lead_asignado`/`lead_reasignado`,
  panel «último lead de cada gestora», etiquetas de WhatsApp en la ficha.
- **Notificaciones agrupadas y apagables** por tipo (#111, `tipos.js`, `/read-group`,
  `/preferences`); la tabla `avisos_apagados` ya existe en ISEIE.
- **Credenciales por entorno**, revelar con registro, paridad (#80, migración 137) y
  la pantalla Claves y variables.
- **Tutores**: «Avisar tutor» (#145, migración 160) y validación de IBAN.
- **Configuración del proyecto** (10 pestañas): en ISEIE es un «Próximamente» que
  abren «Más → Campos» y «Más → Webhook» de Prospectos.
- **Roles → Vista** y «Mi vista» (el backend ya está en ISEIE).
- **Permisos en botones** (#7 parte 3) y el vocabulario de permisos del frontal
  (`leads.read/update` frente a `leads.view/edit` del servidor).
- **Productos**: editar y desactivar desde la lista, árbol de categorías, sincronizar
  WooCommerce con progreso.
- **Clientes**: cabecera de cobros, «Registrar venta» y upsell.
- **Comisiones**: configurar las reglas de % por gestora (el diálogo existe, ninguna
  pantalla lo abre).
- **Secuencias de email al entrar un lead o cambiar de estado**: en ISEIE
  `triggerSequences` es un stub vacío del arranque. Ver pregunta 6.
- **Proceso**: plantillas propias por paso (`paso_clave`), el repaso de fin de mes que
  ya no saca a nadie del CRM (5801fd30), la frase automática del «cuándo» (#87).
- **Menú**: contadores (prospectos nuevos, spam, mensajes sin leer) y aviso de llamada
  de WhatsApp (el backend `/whatsapp/sonando` ya existe en ISEIE).
- Otros: «Ayer y hoy» en el Dashboard, «N ventas sin facturar» antes de descargar
  Reportes, exportación universal (XLSX, columnas, plantillas), atajos de teclado.

**Le falta a MultiCRM:**

- Límite de intentos en los formularios públicos y en el webhook de Make. Ver pregunta 7.
- Base «Contabilidad» en la tabla de asesoras (53c778c) y filtro «Estado de cuotas»
  en Clientes (`installmentStatus`).
- WooCommerce: estrategia `wp_pages` y opciones `stripe_link`/`brochure_url`.
- Tutores: campo «Banco» y avisos de datos que faltan (en MultiCRM se quedaron en
  otra rama, 292af46d y 46783c0c).
- «Enrolar en secuencia» en la ficha completa del prospecto.
- `useConfirm` en lugar de `confirm()`/`alert()` nativos.
- «Archivados» (restaurar prospectos borrados): pero antes hay que arreglar el backend
  de ISEIE, que acepta `archived` y lo ignora.

**Distinto a propósito o por estructura** (no se tocan sin pedirlo): rutas
(`/prospectos` y `/finanzas/*` frente a `/leads` y `/accounting/*`), multi-proyecto
frente a proyecto único, módulos por `installation_bundles` (en ISEIE `app.js` monta
todos; el manifest ya es el mismo en los dos), la marca, auto-factura al cobrar
(ISEIE factura al cobrar) e IVA incluido por defecto (`true` en MultiCRM, `false` en
ISEIE; ver pregunta 8).

### Preguntas para Diego

1. **IA en ISEIE.** `DIFERENCIAS-CRM-HERMANO.md` (22/05) deja fuera de ISEIE las
   audiencias, el monitor de IA, los reportes IA y el chat; el 16/06 dijiste que nada
   se elimina de ISEIE aunque no aplique. ¿Se portan (con sus tablas, apagados) o
   sigue la decisión del 22/05?
2. **Correos (#146) en ISEIE.** Hay que instalar `imapflow`, `mailparser` y
   `nodemailer`, aplicar las migraciones del cuerpo del correo y del correo recibido,
   y configurar un buzón IMAP/SMTP. ¿Lo hago?
3. **Aviso al tutor.** El job diario no lo arranca nadie en MultiCRM y el botón
   «Avisar tutor» necesita la migración `avisado_at` en ISEIE. ¿Se activa en los dos,
   se porta solo el botón, o se borra el job?
4. **Maquetas** (`dev`, `ui-preview`, `suitedash-preview`): ¿se quedan solo en
   MultiCRM?
5. **Facturación a mano en ISEIE** (número elegido, aviso de duplicada, emisor sin
   CIF): ¿se porta, sabiendo que ISEIE factura al cobrar?
6. **Secuencias al entrar un lead / cambiar de estado en ISEIE**: activarlas manda
   correos que hoy no salen. ¿Se encienden?
7. **Límites en formularios públicos y webhook de Make en MultiCRM**: los envíos de
   Make salen todos de las IP de Make; un límite por IP (120/min en ISEIE) podría
   frenar una ráfaga legítima de nueve campus. ¿Se ponen?
8. **IVA incluido por defecto en el servidor** (`true` en MultiCRM, `false` en ISEIE):
   afecta a lo que crea ventas sin pasar el campo (Make, MCP, automáticas). ¿Se iguala?
9. **Módulos por `installation_bundles` en ISEIE**: ¿se enciende el corte (un bundle
   apagado da 404) como en MultiCRM? Antes hay que revisar `installation_bundles` en
   las bases de ISEIE.

### Migraciones (15/10)

- **ISEIE**: 230 (`certifex_solicitudes_diploma`), 231 (`registro_tareas`),
  232 (`mensajeria_interna`). Reaplicables, con dueño = el de `leads` y GRANT a
  `crm_user` / `crm_iseie_user` si existen. **No aplicadas en ningún servidor.**
- **MultiCRM**: ninguna nueva en este bloque.

### Cómo comprobarlo otra vez

Comparar los árboles `backend/src/modules`, `frontend/src/modules`, `backend/src/jobs`
y `shared/` de los dos `origin/staging` (`diff -r`, con `--strip-trailing-cr`: los dos
repos tienen `core.autocrlf=true`). Cualquier módulo en uno y no en el otro está en la
tabla de arriba o es una diferencia nueva que hay que decidir.

---

## Inventario del 30/07/2026 (histórico)

Lo que sigue es la primera comparación. Varias cosas ya están resueltas (Egresos, #227;
Registro y Mensajes en ISEIE, 15/10); se deja como estaba para no perder el contexto.

### Qué le falta a cada CRM para parecerse al otro

Inventario verificado el **30/07/2026** comparando código y esquema de base de
datos de los dos repos. Los datos de esquema salen de las bases de staging, que
son copia exacta de producción.

La regla del proyecto es paridad absoluta. La realidad es que han derivado:
**91 de los 232 ficheros que comparten nombre tienen contenido distinto**, y las
historias de migraciones se separaron pronto (solo 55 nombres coinciden de 119 y
102). Perseguir una paridad literal de todo el código no compensa; lo que sigue
está ordenado por lo que de verdad duele.

---

#### Grupo A · Cosas rotas (esto no es paridad, es que está mal)

Arreglar primero, y en los dos.

| Qué | Dónde | Efecto |
|---|---|---|
| `/sales/gestores-stats` y `/sales/por-asesora` sin `roleGuard` | los dos | Cualquier gestora puede pedir por API las ventas, lo facturado y las metas de **todo el equipo**. La tabla se esconde en pantalla, pero el endpoint está abierto |
| `reminderScheduler.js:39` genera `link_path: /leads/:id` | ISEIH | Allí la ruta es `/prospectos/:id` → **las notificaciones de recordatorio llevan a un 404** |
| `sequence.controller.js:48` lee `req.user.id` | ISEIH | El token trae `userId`, no `id` → al crear una secuencia, `created_by` se guarda vacío |
| `FinanzasLayout.tsx` no está enrutado | ISEIE | Código muerto con 13 entradas de menú apuntando a rutas que no existen |
| Menú: «Conversiones» → `/accounting/conversions` y «Análisis IA» → `/reports/ia` | ISEIE | Enlaces pulsables que no llevan a ninguna parte. La página de Conversiones sí existe: está en `/revenue` |
| **Pagos Stripe no está en el menú** | ISEIE | La página existe y la ruta `/accounting/pagos-stripe` funciona, pero **ninguna entrada del menú lleva a ella**: solo se llega escribiendo la URL. En ISEIH sí está, dentro de Finanzas. Es donde se asocian los 50 cobros de Stripe sin cliente, así que quien no sepa la URL no puede hacer ese trabajo |
| Chunks de las maquetas en el build de producción | ISEIH | **No es un agujero**: las rutas `/prueba_ui*` están detrás de `UI_PREVIEW_ENABLED`, que en el build de producción vale `false` (la base es `/crm/`, no `/testeo/`), así que no se registran. Lo que sí viaja son los ficheros JS huérfanos y sus títulos en el mapa de páginas. Cosmético, no urgente |
| 12 tablas `_bak_*` | ISEIE | Redes de seguridad de las correcciones de datos de esta semana. Se pueden tirar cuando el owner dé por buenos los cambios |

---

#### Grupo B · Funcionalidad que uno tiene y el otro no

##### Le falta a ISEIE

**Plantillas de WhatsApp.** `useWhatsappTemplates.ts` es un **stub vacío**:
devuelve lista vacía y `fillTemplate` no sustituye nada. En ISEIH funcionan (4
plantillas por defecto, sustitución de variables). Es lo que más se echa en falta
de este grupo, porque afecta al trabajo diario de la gestora.

**Todo el bloque de IA y mensajería** — 9 tablas, 5 módulos de backend y 10 de
frontend:

- Tablas: `ai_conversations`, `ai_messages`, `conversations`,
  `conversation_participants`, `messages`, `ia_metrics_snapshots`,
  `platform_users`, `reports`, `meta_uploads`
- Backend: `audiences`, `claude-chat`, `ia-monitor`, `messages`, `reports-ia`
- Frontend: `ai-chat`, `campaigns`, `messages`, `reports-ia`, `status`,
  `webhooks`, `reports`, `dev`, `ui-preview`, `suitedash-preview`

**Detalles menores**: `KpiCard` sin animación, y le faltan 3 columnas en
`wc_credentials` (`wp_meta_endpoint`, `wp_query_token`, `wp_query_token_param`).

##### Le falta a ISEIH

- **`accounts-payable` como módulo propio** de frontend (la página existe
  dentro de `accounting`, pero la estructura no coincide). **Egresos ya está
  emparejado (#227, 13/10):** el mismo módulo `expenses` en los dos CRM, backend
  y frontend, en `/api/expenses` (con `/api/accounting/expenses` como alias).
- **`/leads/dashboard-summary`** y su hook `useDashboardSummary`.
- **2 columnas en `products`**: `brochure_url` e `image_key`.
- `EnrollSequenceModal` integrado en la ficha del lead.

---

#### Grupo C · Diferencias estructurales (caras y no urgentes)

Aquí es donde están las grandes diferencias de tamaño. Cambiarlas es un refactor,
no un arreglo:

| Fichero | ISEIH | ISEIE |
|---|---|---|
| `Sidebar.jsx` | 51.850 | 21.885 |
| `ProductsPage.tsx` | 21.154 | 9.625 |
| `ExportDialog.tsx` | 15.034 | 7.123 |
| `CommissionsPage.tsx` | 22.985 | 16.605 |
| `WooCommercePage.tsx` | 43.781 | 49.156 |
| `App.jsx` | 18.941 | 14.200 |

Y las rutas son distintas de raíz: **ISEIH** usa `/prospectos` y `/finanzas/*`
con layouts anidados; **ISEIE** usa `/leads` y `/accounting/*` planas. Unificarlas
cambia todas las URLs de uno de los dos y rompe los enlaces guardados.

---

#### Qué haría, por orden

1. **Grupo A entero.** Son fallos, no diferencias. Poco trabajo y quitan riesgo
   real: la fuga de `sales` es de la misma familia que la de Facturación que ya
   cerramos.
2. **Plantillas de WhatsApp en ISEIE.** En ISEIH ya están en base de datos
   (migración 122, tarea #25, 21/08/2026): compartidas por proyecto, con ámbito
   `compartida` / `personal`, y editables desde `/whatsapp/plantillas`. Queda
   subirlas igual en ISEIE, donde el hook sigue siendo un stub vacío — hasta
   entonces la diferencia entre los dos CRMs es mayor, no menor.
3. **Las columnas y el endpoint que faltan** (`products`, `wc_credentials`,
   `dashboard-summary`). Son migraciones de una línea.
4. **El bloque de IA y mensajería en ISEIE**: es la diferencia grande de verdad.
   Decisión de producto, no técnica — ¿ISEIE lo necesita?
5. **Grupo C solo si molesta.** Unificar rutas y sidebar es caro y rompe enlaces.

#### Cómo evitar que vuelva a pasar

Todo lo nuevo va a los dos a la vez y con el **mismo número de migración**. Las
dos colas terminan hoy en `117`, así que a partir de aquí vuelven a estar
sincronizadas: la `118` puede ser idéntica en ambos.

Conviene repetir esta comparación cada cierto tiempo — los scripts están en
`c:/tmp/paridad_esquema.py` y `c:/tmp/paridad_codigo.py`.
