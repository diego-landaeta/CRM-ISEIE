# Qué le falta a cada CRM para parecerse al otro

Inventario verificado el **30/07/2026** comparando código y esquema de base de
datos de los dos repos. Los datos de esquema salen de las bases de staging, que
son copia exacta de producción.

La regla del proyecto es paridad absoluta. La realidad es que han derivado:
**91 de los 232 ficheros que comparten nombre tienen contenido distinto**, y las
historias de migraciones se separaron pronto (solo 55 nombres coinciden de 119 y
102). Perseguir una paridad literal de todo el código no compensa; lo que sigue
está ordenado por lo que de verdad duele.

---

## Grupo A · Cosas rotas (esto no es paridad, es que está mal)

Arreglar primero, y en los dos.

| Qué | Dónde | Efecto |
|---|---|---|
| `/sales/gestores-stats` y `/sales/por-asesora` sin `roleGuard` | los dos | Cualquier gestora puede pedir por API las ventas, lo facturado y las metas de **todo el equipo**. La tabla se esconde en pantalla, pero el endpoint está abierto |
| `reminderScheduler.js:39` genera `link_path: /leads/:id` | ISEIH | Allí la ruta es `/prospectos/:id` → **las notificaciones de recordatorio llevan a un 404** |
| `sequence.controller.js:48` lee `req.user.id` | ISEIH | El token trae `userId`, no `id` → al crear una secuencia, `created_by` se guarda vacío |
| `FinanzasLayout.tsx` no está enrutado | ISEIE | Código muerto con 13 entradas de menú apuntando a rutas que no existen |
| Menú: «Conversiones» → `/accounting/conversions` y «Análisis IA» → `/reports/ia` | ISEIE | Enlaces pulsables que no llevan a ninguna parte. La página de Conversiones sí existe: está en `/revenue` |
| **Pagos Stripe no está en el menú** | ISEIE | La página existe y la ruta `/accounting/pagos-stripe` funciona, pero **ninguna entrada del menú lleva a ella**: solo se llega escribiendo la URL. En ISEIH sí está, dentro de Finanzas. Es donde se asocian los 50 cobros de Stripe sin cliente, así que quien no sepa la URL no puede hacer ese trabajo |
| 7 rutas `/prueba_ui*` y `/dev/components` | ISEIH | Maquetas accesibles en producción para quien conozca la URL |
| 12 tablas `_bak_*` | ISEIE | Redes de seguridad de las correcciones de datos de esta semana. Se pueden tirar cuando el owner dé por buenos los cambios |

---

## Grupo B · Funcionalidad que uno tiene y el otro no

### Le falta a ISEIE

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

### Le falta a ISEIH

- **`expenses` y `accounts-payable` como módulos propios** de frontend (las
  páginas existen dentro de `accounting`, pero la estructura no coincide).
- **`/leads/dashboard-summary`** y su hook `useDashboardSummary`.
- **2 columnas en `products`**: `brochure_url` e `image_key`.
- `EnrollSequenceModal` integrado en la ficha del lead.

---

## Grupo C · Diferencias estructurales (caras y no urgentes)

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

## Qué haría, por orden

1. **Grupo A entero.** Son fallos, no diferencias. Poco trabajo y quitan riesgo
   real: la fuga de `sales` es de la misma familia que la de Facturación que ya
   cerramos.
2. **Plantillas de WhatsApp en ISEIE.** Y de paso subirlas a base de datos en
   los dos: hoy viven en el `localStorage` del navegador, así que no se comparten
   entre gestoras ni sobreviven a un cambio de equipo.
3. **Las columnas y el endpoint que faltan** (`products`, `wc_credentials`,
   `dashboard-summary`). Son migraciones de una línea.
4. **El bloque de IA y mensajería en ISEIE**: es la diferencia grande de verdad.
   Decisión de producto, no técnica — ¿ISEIE lo necesita?
5. **Grupo C solo si molesta.** Unificar rutas y sidebar es caro y rompe enlaces.

## Cómo evitar que vuelva a pasar

Todo lo nuevo va a los dos a la vez y con el **mismo número de migración**. Las
dos colas terminan hoy en `117`, así que a partir de aquí vuelven a estar
sincronizadas: la `118` puede ser idéntica en ambos.

Conviene repetir esta comparación cada cierto tiempo — los scripts están en
`c:/tmp/paridad_esquema.py` y `c:/tmp/paridad_codigo.py`.
