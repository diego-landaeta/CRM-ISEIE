# Manual de usuario — CRM MultiProyecto

> Guia rapida para usar el CRM multiproyecto. Pensada para gestoras, admins y superadmins.

## Tabla de contenidos

1. [Acceso y proyectos](#1-acceso-y-proyectos)
2. [Dashboard](#2-dashboard)
3. [Prospectos](#3-prospectos)
4. [Pipeline](#4-pipeline)
5. [Clientes](#5-clientes)
6. [Productos](#6-productos)
7. [Campanas (Meta + Google)](#7-campanas-meta--google)
8. [Trafico organico (SEO)](#8-trafico-organico-seo)
9. [Dashboard IA (Stripe)](#9-dashboard-ia-stripe)
10. [Reportes IA](#10-reportes-ia)
11. [Audiencias](#11-audiencias)
12. [Contabilidad](#12-contabilidad)
13. [Comisiones](#13-comisiones)
14. [Chat con Claude](#14-chat-con-claude)
15. [Reportes generales](#15-reportes-generales)
16. [Configuracion](#16-configuracion)
17. [Atajos de teclado](#17-atajos-de-teclado)
18. [Roles y permisos](#18-roles-y-permisos)

---

## 1. Acceso y proyectos

**Login:** `/crm/login` con tu email y contrasena.

**Cambiar de proyecto:** desplegable arriba a la izquierda (debajo del logo). El selector cambia
**todos los datos** de la sesion al proyecto activo (prospectos, conversiones, campanas, KPIs...).

**Tipos de proyecto:**
- **CRM** — captura de prospectos, conversiones, contabilidad. Ej: Psiko Aprende, ISEIH, Fono Aprende.
- **IA** — monitor SaaS de Stripe (MRR, churn, suscripciones). Ej: Psicologo IA, Nutricionista IA, Tarot IA.

---

## 2. Dashboard

Pagina principal (`/`). Vision rapida del estado del proyecto activo.

**Secciones:**
- **Tu dia de hoy** — Pendientes (recordatorios), Nuevos hoy, Inactivos, Cobros vencidos, Ingresos hoy.
  - Cada card es **clicable** y te lleva al filtro correspondiente:
    - "Pendientes" → Prospectos > "Necesitan accion hoy"
    - "Inactivos" → Prospectos > "Sin contacto"
    - "Cobros vencidos" → Cuentas por cobrar
- **KPIs principales** — Total prospectos, Nuevos, Convertidos, Tasa conversion.
- **Charts** — Prospectos por estado y por canal.
- **Prospectos recientes** — ultimos 10 con boton "Ver todos".

---

## 3. Prospectos

`/leads` — gestion completa del pipeline pre-conversion.

### KPIs cabecera
Total, Nuevos, Por contactar, Contactados, En seguimiento, Convertidos, No interesado.
Cada KPI con borde lateral coloreado (rapida visual).

### Filtros
- **Buscador** por nombre o email.
- **Estado** del lead (multi).
- **Canal** de origen (multi).
- **Responsable** (gestor asignado).
- **Filtros rapidos** (chips) con contadores en vivo:
  - **Necesitan accion hoy** — vencidos + reminders hoy + sin contacto en estado nuevo/por_contactar.
  - **Vencidos** — recordatorios cuya fecha ya paso.
  - **Hoy** — recordatorios programados para hoy.
  - **Sin contacto** — leads nuevos/por_contactar sin ninguna interaccion.

### Columnas de la tabla
- Nombre + iniciales en avatar coloreado + badges (Reincidente, Duplicado, Inactividad).
- Email.
- Origen (canal con icono).
- Estado (badge).
- **Ultimo contacto** — fecha relativa de la ultima interaccion (`hace 2d`, `hace 1sem`, ...).
- **Proximo** — proximo recordatorio pendiente; en rojo si esta vencido.
- Gestor.
- **Acciones**.

### Acciones rapidas (por fila)
| Icono | Accion | Detalle |
|-------|--------|---------|
| 💬 | WhatsApp | Abre `https://wa.me/<telefono>` y **registra una interaccion automaticamente**. |
| ✉️ | Email | Abre cliente email y registra interaccion. |
| 📅 | Programar contacto | Dialog inline con fecha+hora+nota; atajos en 2h / manana 10am / en 3 dias / en 1 semana. |
| ✅ | Marcar contactado | Pide confirmacion "Vas a marcar a X como contactado..." |
| ⚡ | Convertir | Abre dialog inline para registrar conversion (producto + importe + metodo pago + fecha + notas). Al guardar, el lead pasa a `convertido` automaticamente. |

### Crear prospecto
- Boton **"+ Nuevo Prospecto"**: dialog con nombre, email, telefono, producto, canal, notas, custom fields.
- Asignacion automatica por **round-robin** entre gestores activos.

### Importar masivo CSV
Menu "Configurar > Importar desde CSV":
- Drag&drop o file picker.
- Maximo 200 filas por import.
- **Auto-mapeo** de columnas (detecta nombre, email, telefono, canal, producto, notas).
- Mapeo manual editable.
- Preview de 5 filas con resaltado en rojo de campos requeridos faltantes.
- Plantilla descargable (CSV de ejemplo).
- Progress bar + reporte final con primeros 5 errores.

### Custom fields y Webhook
Menu "Configurar":
- **Campos custom** — campos adicionales del proyecto (texto, numero, select, etc).
- **Webhook de captura** — endpoint para recibir leads desde formularios externos (Typeform, Wix, Meta Lead Ads, etc).

---

## 4. Pipeline

`/leads/pipeline` — vista kanban con drag&drop.

**Columnas:** Nuevo, Por contactar, Contactado, En seguimiento, Convertido, No interesado.

### Como mover un prospecto
1. Mantener click en la card.
2. Arrastrar a la columna destino.
3. La columna destino se resalta con borde de color + texto "Soltar para mover a X".
4. Soltar — el estado se actualiza automaticamente (PATCH al backend).

### Reglas especiales
- **A "Convertido"** — lleva al detalle del lead para registrar la compra (importe + metodo).
- **A "No interesado"** — pide motivo (`precio`, `tiempo`, `competencia`, `otro`).

---

## 5. Clientes

`/clients` — prospectos ya convertidos con historial de compras.

### KPIs
Total facturado · Total cobrado · Pendiente de cobro.

### Tabla
- Cliente (nombre + gestor responsable).
- Email.
- Compras (numero de conversiones).
- Facturado · Pendiente.
- Ultima compra · Ultimo contacto (fechas relativas).
- Acciones: WhatsApp, Email, **Nueva venta/upsell** (abre dialog conversion inline).

---

## 6. Productos

`/products` — catalogo del proyecto.

- **Categorias y subcategorias** organizadas en arbol.
- **Precio + SKU + Stripe price_id** (para sync con Stripe).
- **Logo del producto** (R2 storage).
- **Dossiers PDF** versionados (la anterior se marca inactiva, nunca se borra).

---

## 7. Campanas (Meta + Google)

`/campaigns` con submenu en el sidebar:

### `/campaigns` — Consolidado
- **4 KPIs sumados:** Inversion total, Clicks, Prospectos CRM, CPA real.
- **2 charts comparativos:** Inversion por plataforma, Prospectos CRM por plataforma.
- Tabla resumen con breakdown Meta vs Google.

### `/campaigns/meta` — Meta Ads
- KPIs Meta solo.
- Tabla campanas: nombre, estado, gasto, clicks, CPC, leads CRM, conv., CPA real.
- **Alerta CPA** — filas con CPA > 100 EUR se resaltan en rojo.

### `/campaigns/google` — Google Ads
- KPIs Google.
- Tabla campanas (Search, PMax, Display).
- **Top keywords** (max 20) con quality score coloreado: verde (>=8), ambar (5-7), rojo (<5).

### Periodo (compartido)
Presets 7/14/30/90 dias + custom range.

---

## 8. Trafico organico (SEO)

`/seo` — Google Search Console.

- **Banner:** "Datos con retraso de 2-3 dias" + fecha de ultima actualizacion.
- **4 KPIs:** Clicks, Impresiones, CTR medio, Posicion media.
- **Linea consolidada 12 meses:** trafico organico (verde) + trafico pagado Meta+Google (azul) + leads CRM (violeta dashed).
- **Top 20 keywords** con badge de posicion coloreado:
  - 1-3 verde (top SERP), 4-10 azul, 11-20 ambar, 20+ rojo.

---

## 9. Dashboard IA (Stripe)

`/ia-dashboard` — solo proyectos tipo IA. Solo SA/A.

### KPIs hero (con delta % vs mes anterior)
- MRR actual (verde si crece / rojo si decrece).
- Suscripciones activas.
- Churn rate mensual (alerta roja >5%).
- Cobros fallidos.

### Cards mensuales
Nuevas suscripciones (+N verde) · Cancelaciones (-N rojo).

### Charts
- LineChart MRR 12 meses.
- BarChart Churn rate con linea de referencia "Alerta 5%".
- LineChart Suscripciones activas.

---

## 10. Reportes IA

`/reports-ia` — reportes mensuales generados por Claude AI.

### Layout
- **Sidebar izquierdo (260px):** historial de reportes (max 6 meses).
- **Visor derecho:** markdown rendering con tablas, listas, blockquotes, links.

### Acciones
- **"Generar ahora"** — ejecuta Claude AI con datos del periodo (10-30s).
- **"Exportar PDF"** — genera y descarga PDF con branding del proyecto.

### Contenido del reporte
1. Resumen ejecutivo.
2. Captacion de leads (canal, conversiones, CPA).
3. Pipeline.
4. Negocio (facturacion, top productos, comisiones).
5. Trafico organico (GSC).
6. Recomendaciones tacticas.

---

## 11. Audiencias

`/leads/audiences` — crear segmentos para Meta Custom Audiences / Google Customer Match.

### Sidebar de filtros
- Atajos: "No convertidos", "Convertidos", "Solo pagado", "Organico".
- Estado (multi), Canal (multi), Fechas, Producto, Importe minimo.

### Resultado
- **Cantidad** de leads coincidentes en vivo.
- **Badge "Lista para Meta"** (verde) si >=20 leads, o warning si <20 (limite Meta).
- Nombre archivo: `audiencia_<projectslug>_<YYYY-MM-DD>.csv`.

### Acciones
- **Descargar CSV** — email/telefono hasheados SHA-256.
- **Subir a Meta** — upload directo via Marketing API. Timeline en tiempo real (preparing → uploading → processing → completed) con match rate al final.

### Historial
Tabla con audiencias subidas (audienceId, fecha, leads, match rate, estado).

---

## 12. Contabilidad

Submenu en el sidebar con:

### `/accounting` — Dashboard
- KPIs: Ingresos cobrados, Por cobrar, Egresos, Balance neto.
- Charts: Evolucion mensual ingresos vs egresos · Egresos por categoria.
- Tabla cuentas por cobrar.

### `/accounting/income` — Ingresos
Conversiones registradas: cliente, producto, total, pagado, estado.

### `/accounting/expenses` — Egresos
CRUD de gastos por categoria (salarios, alquiler, proveedores, software, publicidad, etc).

### `/accounting/receivable` — Cuentas por cobrar
Conversiones con saldo pendiente. Click → ficha del lead.

### `/accounting/payable` — Cuentas por pagar
Facturas de proveedores. Tabs por estado: Todas / Pendientes / Parciales / Pagadas / Canceladas.

---

## 13. Comisiones

`/commissions` — comisiones generadas por ventas.

### Vistas
- **Gestor:** sus comisiones (Pendiente, Pagado, Cantidad).
- **Admin/Superadmin:** vista global con filtro por gestor + reglas (% por gestor).

### Reglas (solo SA)
Modal "Reglas (% por gestor)" donde se configura el % de comision por gestora y producto.

---

## 14. Chat con Claude

Boton flotante "Pregunta a Claude" abajo a la derecha en cualquier pantalla.

### Capacidades
- Responde sobre datos del proyecto activo (leads, campanas, conversiones, contabilidad).
- **Streaming en vivo** con cursor parpadeante.
- 3 quick questions: Resumen del mes, Prospectos sin actividad, Rendimiento campanas.
- Markdown en respuestas (tablas, listas, etc).
- **Esc** cierra panel · **Enter** envia · **Shift+Enter** nueva linea.

### Limites
- 20 mensajes/hora/usuario.
- Conversacion solo durante la sesion (no persiste entre logins).

---

## 15. Reportes generales

`/reports` — reportes operativos del CRM.

- Date range selector.
- KPIs: Total leads, Tasa conversion, Ventas cobradas, Por cobrar.
- Charts: Pipeline, Ingresos mensual, Leads por canal (donut), Leads por gestor (tabla).
- Top productos por ventas.

---

## 16. Configuracion

`/settings` — solo SA.

### Tabs Globales
- **Proyectos** — CRUD de proyectos (nombre, slug, type, logo, modulos, colores).
- **Usuarios** — CRUD de gestores, admins. Asignacion a proyectos. Email de bienvenida automatico (Brevo).
- **APIs globales** — credenciales globales si aplica.

### Tabs por proyecto (al hacer click en "Configurar" sobre una card)
- **General** — nombre, emoji, tipo, alerta inactividad, terminologia personalizada (ej. "Formacion" en vez de "Producto").
- **Modulos** — toggles para activar/desactivar secciones del CRM en este proyecto (presets: CRM Formacion / Plataforma IA / Minimal).
- **Categorias** — categorias y subcategorias de productos.
- **Campos** — editor de campos custom de prospectos (text, number, select, etc) con drag-reorder.
- **Webhook** — URL del webhook + API key (regenerable).
- **APIs** — credenciales especificas (Brevo, Meta Marketing, Google Ads, Google Search Console, Stripe). Encriptadas AES-256-GCM.

---

## 17. Atajos de teclado

| Atajo | Accion |
|-------|--------|
| `Cmd/Ctrl + K` | Command palette (busqueda global) |
| `Esc` | Cerrar dialog / chat |
| `Enter` | Enviar formulario |
| `Shift + Enter` | Nueva linea en textarea |

### Command palette (Cmd+K)
Busca cualquier seccion o prospecto. 20+ rutas indexadas.

---

## 18. Roles y permisos

| Rol | Capacidades |
|-----|-------------|
| **Superadmin** | Todo. Crea proyectos, usuarios, configura APIs. |
| **Admin** | Acceso operativo completo. NO crea/desactiva usuarios. |
| **Gestor** | Solo proyectos asignados. Solo SUS prospectos. No ve Productos ni Campanas. |

### Que ve cada rol en el sidebar
| Modulo | SA | A | G |
|--------|:--:|:-:|:-:|
| Dashboard | ✓ | ✓ | ✓ |
| Prospectos | ✓ | ✓ | ✓ |
| Clientes | ✓ | ✓ | ✓ |
| Productos | ✓ | ✓ | — |
| Campanas | ✓ | ✓ | — |
| Trafico organico | ✓ | ✓ | — |
| Dashboard IA | ✓ | ✓ | — |
| Reportes IA | ✓ | ✓ | — |
| Contabilidad | ✓ | ✓ | — |
| Comisiones | ✓ | ✓ | ✓ (solo las suyas) |
| Reportes | ✓ | ✓ | — |
| Configuracion | ✓ | (limitado) | — |

---

## Tips operativos

1. **Filtra primero, actua despues.** En Prospectos usa "Necesitan accion hoy" para ver solo lo urgente.
2. **WhatsApp registra automaticamente.** El click registra la interaccion → no tienes que crearla manual.
3. **Programa el siguiente paso siempre.** Despues de cada interaccion, click en 📅 y elige "En 3 dias" si quedaste en volver.
4. **Pipeline visual rapido.** Si te pierdes, vista kanban en `/leads/pipeline` te da el panorama de un vistazo.
5. **Cmd+K es tu mejor amigo.** Busqueda instantanea de prospecto, seccion o atajo.
6. **Reportes IA mensual.** Gen automatica el dia 1 del mes; revisa para detectar campanas con CPA fuera de banda.
