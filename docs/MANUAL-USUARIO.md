# Manual de usuario — CRM ISEIE

> **Versión:** 1.0 · **Última actualización:** 2026-05-22 · **URL:** [https://crm.iseie.com](https://crm.iseie.com)

Bienvenido al CRM de ISEIE. Este manual está pensado para que cualquier
persona del equipo — desde un comercial nuevo hasta un administrador —
pueda usar el sistema con confianza y sin depender del soporte para tareas
del día a día.

Si vienes con prisa: ve directamente a **[§4 Primer día](#4-primer-día-en-el-crm)**
y vuelve al resto cuando necesites un detalle.

---

## Índice

1. [Qué es el CRM ISEIE](#1-qué-es-el-crm-iseie)
2. [Roles y permisos](#2-roles-y-permisos)
3. [Acceso e inicio de sesión](#3-acceso-e-inicio-de-sesión)
4. [Primer día en el CRM](#4-primer-día-en-el-crm)
5. [Tour de la interfaz](#5-tour-de-la-interfaz)
6. [Dashboard](#6-dashboard)
7. [Prospectos (leads)](#7-prospectos-leads)
8. [Pipeline de ventas](#8-pipeline-de-ventas)
9. [Conversión a venta](#9-conversión-a-venta)
10. [Clientes](#10-clientes)
11. [Productos y categorías](#11-productos-y-categorías)
12. [Matrículas](#12-matrículas)
13. [Contabilidad](#13-contabilidad)
14. [Comisiones](#14-comisiones)
15. [Nóminas](#15-nóminas)
16. [Documentos](#16-documentos)
17. [Formularios públicos](#17-formularios-públicos)
18. [Captación: WooCommerce y Make](#18-captación-woocommerce-y-make)
19. [Email automatizado (secuencias y plantillas)](#19-email-automatizado-secuencias-y-plantillas)
20. [Reportes](#20-reportes)
21. [Notificaciones y actividad](#21-notificaciones-y-actividad)
22. [Configuración general](#22-configuración-general)
23. [Roles y administración de usuarios](#23-roles-y-administración-de-usuarios)
24. [Atajos de teclado](#24-atajos-de-teclado)
25. [Buenas prácticas](#25-buenas-prácticas)
26. [Resolución de problemas](#26-resolución-de-problemas)
27. [Glosario](#27-glosario)
28. [Soporte](#28-soporte)

---

## 1. Qué es el CRM ISEIE

El CRM ISEIE es la herramienta central donde el equipo gestiona **todo el
ciclo del estudiante**:

- Captación de **prospectos** (leads) desde formularios web, redes sociales,
  WhatsApp, WooCommerce y otras fuentes.
- Seguimiento comercial (asignación automática a gestores, recordatorios,
  pipeline visual, conversaciones).
- **Matrícula y conversión a venta** con generación de documentos.
- Gestión de **cobros, comisiones, nóminas y contabilidad** del instituto.
- Reportes operativos y financieros consolidados.

El CRM trabaja con un único proyecto **ISEIE** que consolida toda la
actividad comercial (prospectos, productos, ventas, cobros, gestores).

### Lo que no encontrarás aquí

- El CRM **no envía mensajes por WhatsApp directamente**; te abre el chat
  pre-rellenado para que tú lo envíes. Esto es intencional, no un bug.
- El CRM **no cobra a través de pasarela propia**: los cobros se registran
  manualmente o vía integraciones (WooCommerce, link de pago externo).
- El CRM **no edita el sitio web de ISEIE**; sólo recibe los leads que
  llegan desde la web.

---

## 2. Roles y permisos

Cuatro roles definen qué puede ver y hacer cada usuario:

| Rol | Para quién | Puede |
|---|---|---|
| **Superadmin** | Dirección + equipo técnico | Todo el CRM: usuarios, roles, integraciones, datos sensibles, auditoría completa. |
| **Admin** | Coordinación general | Leads, productos, precios, contabilidad, comisiones, nóminas y configuración. |
| **Gestor** | Comerciales / asesores | Sus prospectos asignados, conversión, ventas; sin acceso a contabilidad ni administración. |
| **Soporte** | Atención al alumno post-venta | Lectura amplia (ve todos los leads/clientes), sin permisos de edición masiva ni finanzas. |

> **Convención**: si una sección de este manual aparece con la marca
> 🔒 *(admin / superadmin)*, los gestores no la verán en su menú.

---

## 3. Acceso e inicio de sesión

### 3.1 Primer acceso

Cuando un administrador crea tu cuenta, recibirás un email con asunto
**"Establece tu contraseña — CRM ISEIE"**.

1. Abre el email y pulsa el enlace **"Establecer contraseña"**.
2. Crea una contraseña de mínimo 10 caracteres con al menos una mayúscula,
   una minúscula y un número.
3. Serás redirigido al login automáticamente.

> El enlace caduca a las **24 horas**. Si ha caducado, pide a tu
> administrador que te lo reenvíe (un solo clic desde **Roles → Usuarios →
> Reenviar invitación**).

### 3.2 Login diario

1. Abre [https://crm.iseie.com](https://crm.iseie.com).
2. Introduce tu **email corporativo** y tu contraseña.
3. Pulsa **Iniciar sesión**.

La sesión se mantiene abierta durante **30 días** salvo que cierres sesión
manualmente o cambies de equipo. El token de acceso se renueva
silenciosamente cada 15 minutos.

### 3.3 He olvidado mi contraseña

1. En la pantalla de login, pulsa **¿Has olvidado tu contraseña?**.
2. Introduce tu email.
3. Recibirás un enlace de restablecimiento válido por 1 hora.

Si no recibes el email en 5 minutos, revisa la carpeta de spam o pide
ayuda a tu admin.

### 3.4 Cerrar sesión

Desde el sidebar inferior izquierdo → tu avatar → **Cerrar sesión**.
Esto invalida tu refresh token; en cualquier otro dispositivo donde
estuvieras conectado/a también caducará.

---

## 4. Primer día en el CRM

Un checklist de 10 minutos para tu primer login:

- [ ] **Cambia el tema** (claro / oscuro) desde tu menú de usuario si te
  resulta más cómodo.
- [ ] **Revisa tu perfil** → `/profile`: comprueba nombre, email, avatar.
- [ ] **Explora el Dashboard** para ver el estado del CRM.
- [ ] **Abre Prospectos** → filtra por "Asignados a mí" si eres gestor.
- [ ] **Abre el manual** desde `/manual` para tener una referencia visual.
- [ ] **Anota tus dudas** y consúltalas a tu coordinador en lugar de
  improvisar — el CRM tiene atajos y convenciones que ahorran mucho
  tiempo.

---

## 5. Tour de la interfaz

```
┌─────────────────────────────────────────────────────────────────┐
│ [LOGO ISEIE] [Beta]   ⛶                                          │
│ 🔍 Buscar… [Ctrl K]   ← spotlight (próximamente)                 │
│ ─────────                                                        │
│ PRINCIPAL                                                        │
│  ▸ Dashboard                                                     │
│  ▸ Prospectos ▾                                                  │
│      Listado · Pipeline                                          │
│  ▸ Matrículas                                                    │
│ CAPTACIÓN                                                        │
│  ▸ Email seguimiento  🔒                                         │
│  ▸ Captación ▾  🔒                                               │
│      Formularios · Make / Webhooks                               │
│ CATÁLOGO                                                         │
│  ▸ Productos ▾                                                   │
│      Catálogo · Árbol · Cursos pend. · Categorías · WooCommerce  │
│  ▸ Documentos 🔒                                                 │
│ FINANZAS                                                         │
│  ▸ Contabilidad ▾                                                │
│      Ventas · Egresos 🔒 · Cuentas x pagar 🔒 · Comisiones ·     │
│      Nóminas 🔒                                                  │
│ ANÁLISIS                                                         │
│  ▸ Reportes  🔒                                                  │
│  ▸ Actividad                                                     │
│ SISTEMA                                                          │
│  ▸ Notificaciones · Roles 🔒 · Status · Mi cuenta · Config       │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ [👤] Tu nombre   ⏷                                  [🔔]   │  │
│ │      Rol                                                   │  │
│ └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.1 Componentes clave

- **Logo + badge BETA**: estamos en versión 1.0 productiva pero esperamos
  feedback continuo. Si ves algo raro, repórtalo (§29).
- **Búsqueda global**: el atajo `Ctrl K` está reservado; el spotlight se
  añadirá próximamente.
- **Sidebar colapsable** (escritorio): pulsa la flecha junto al logo para
  ganar espacio.
- **Drawer móvil**: en pantallas pequeñas, pulsa el icono **☰** arriba a
  la izquierda. Cierra con Escape, fuera del drawer o tocando un enlace.
- **Menú de usuario**: tu avatar abajo izquierda abre Mi cuenta,
  Configuración, Cambiar tema y Cerrar sesión.
- **Campanita de notificaciones**: pendientes que requieren acción
  (recordatorios vencidos, leads sin contactar, etc.).

### 5.2 Modo oscuro

ISEIE tiene una paleta corporativa **navy + verde**. El modo oscuro está
optimizado para reducir fatiga visual en jornadas largas.

---

## 6. Dashboard

`/dashboard` · disponible para todos

Es la pantalla de inicio. Resume el estado del CRM en un período
seleccionable (7, 30, 90, 365 días).

### Bloques

- **Hero de bienvenida**: saludo según hora del día, anillo de tasa de
  conversión y avatar con tu rol.
- **4 KPIs con sparklines** (tendencia semanal):
  - **Prospectos nuevos**: leads creados en el período.
  - **Ventas cerradas**: conversiones con estado `pagado` o `parcial`.
  - **Ingresos**: total facturado (sumatorio de `importe_total`).
  - **Tasa de conversión**: % leads → ventas.
- **Actividad reciente**: últimos eventos.
- **Accesos rápidos**: atajos a Prospectos, Catálogo y Comisiones.

### Tips

- El selector de período afecta sólo a los KPIs, no al feed de actividad.
- El badge de tendencia (▲ verde / ▼ rojo) compara con el período
  anterior equivalente. Un `--` significa "sin datos del período previo".
- Si todos los KPIs están a 0, probablemente aún no hay actividad en el
  período seleccionado.

---

## 7. Prospectos (leads)

`/leads` · disponible para todos los roles

### 8.1 Listado

Pantalla principal con tabla de leads + filtros rápidos por estado:

| Estado | Significado |
|---|---|
| **Nuevo** | Acaba de entrar, sin contactar todavía. |
| **Por contactar** | Asignado pero pendiente de primer contacto. |
| **Contactado** | Hubo al menos una interacción. |
| **En seguimiento** | En proceso comercial activo. |
| **Convertido** | Pagó (parcial o total). Ya es cliente. |
| **No interesado** | Descartado. Se mantiene por historial. |

**Filtros disponibles**:

- Buscador (nombre, email, teléfono).
- Estado (chips arriba).
- Más filtros: canal, responsable, producto interés, fecha, etiquetas.

**Acciones por fila**:

- Clic en el nombre → ficha de detalle.
- Hover muestra acciones rápidas (WhatsApp, email, ver detalle).

### 8.2 Crear lead manual

1. Pulsa **+ Nuevo** arriba a la derecha.
2. Rellena: nombre (obligatorio), email o teléfono (al menos uno),
   producto interés, canal de origen, notas.
3. Si tu rol lo permite, asigna responsable; si no, el sistema lo asigna
   automáticamente por **round-robin** entre los gestores del proyecto.
4. Guarda.

### 8.3 Importar leads desde CSV

🔒 admin / superadmin

1. Pulsa **Importar CSV**.
2. Descarga la plantilla de ejemplo.
3. Sube tu archivo. La validación muestra qué filas se importarán y
   cuáles tienen errores.
4. Confirma. Los leads se asignan también por round-robin.

> Las columnas obligatorias son `nombre` y `email` (o `telefono`). El
> resto son opcionales y se omiten si no existen.

### 8.4 Ficha de detalle

Cuatro pestañas:

- **Resumen**: contacto, asignación, estado, producto interés, etiquetas.
- **Timeline**: histórico cronológico (creación, cambios de estado,
  emails enviados, conversiones, notas).
- **Conversiones**: ventas asociadas (ver §10).
- **Documentos**: archivos subidos por el cliente o generados (contratos,
  facturas).

Acciones en la cabecera de la ficha:

- **WhatsApp**: abre la conversación pre-rellenada con un mensaje
  inicial editable.
- **Email**: abre tu cliente de email (mailto:) con el destinatario y
  asunto pre-cargados.
- **+ Conversión**: registrar la venta (§10).
- **Recordatorio**: programar un recordatorio para cierta fecha.
- **Cambiar estado**: drop-down con los estados disponibles.
- **Reasignar**: cambiar el gestor responsable. 🔒 admin
- **Eliminar (soft-delete)**: archiva el lead. 🔒 admin

### 8.5 Recordatorios

Cada lead puede tener múltiples recordatorios. Si pasa la fecha y no se
marca como completado, el sistema:

1. Envía un email al gestor responsable.
2. Aparece en su campanita de notificaciones.
3. Sale destacado en el Dashboard.

El recordatorio se lanza cada **15 minutos** (configurable por el admin
técnico).

### 8.6 Asignación automática (round-robin)

Cuando entra un lead por formulario web o webhook, el CRM lo asigna al
siguiente gestor de la cola del proyecto. La cola es transaccional —
nadie se queda con más leads que sus compañeros salvo que tenga la
prioridad explícita configurada en Roles.

---

## 7. Pipeline de ventas

`/leads/pipeline` · misma fuente de datos que el listado pero vista
**Kanban** por estado.

- Arrastra y suelta las tarjetas entre columnas para cambiar el estado.
- Cada tarjeta muestra: nombre, producto interés, fecha del último
  cambio, etiquetas.
- El recuento por columna se actualiza en vivo.

**Cuándo usarlo**: en reuniones comerciales, para tener visión global del
embudo. **Cuándo no**: cuando trabajas masivamente sobre muchos leads,
el listado va más rápido.

---

## 7. Conversión a venta

Una **conversión** representa una venta cerrada de un lead. Convertir
implica:

- Asociar uno o varios **productos** a un precio acordado.
- Establecer un **método de pago**: tarjeta, transferencia, efectivo o
  **fraccionado**.
- Si es fraccionado, generar el calendario de cuotas.

### 10.1 Cómo registrar una conversión

Desde la ficha del lead → **+ Conversión**.

1. Selecciona producto principal (filtrable por SKU/nombre).
2. Importe total (€). Auto-rellena con el precio del producto pero puedes
   editarlo (ej. descuentos pactados).
3. Si aplicas descuento, marca la casilla y especifica % o importe.
4. Método de pago:
   - **Tarjeta / Transferencia / Efectivo**: cobro único.
   - **Fraccionado**: indica número de cuotas y fecha de la primera. El
     CRM genera el calendario distribuyendo el total (la última cuota
     compensa redondeos).
5. Si el producto tiene **link de pago** (configurado en su ficha),
   puedes copiarlo al portapapeles para enviárselo al cliente. También
   admite un link custom.
6. Notas internas (opcional).
7. Guarda.

El lead pasa automáticamente a estado **Convertido** y aparece en el
módulo Clientes.

### 10.2 Estados de pago

| Estado | Significado |
|---|---|
| **Pendiente** | Conversión registrada, sin cobros aún. |
| **Parcial** | Cobrado < importe total. |
| **Pagado** | Cobrado >= importe total. |
| **Vencido** | Hay cuotas con fecha pasada sin pagar. |
| **Reembolsado** | Anulado. |

### 10.3 Registrar un cobro / pago de cuota

Desde la ficha del cliente → pestaña **Pagos** → **+ Registrar pago**:

- Fecha del pago.
- Importe.
- Método.
- Referencia (nº de transferencia, último 4 dígitos de tarjeta…).

El estado de la conversión se actualiza automáticamente.

---

## 7. Clientes

`/clients` · disponible para todos

Esta sección muestra los leads que ya pasaron a estado **Convertido**.

### Vista

Tabla con: nombre, contacto, responsable, número de compras, total
facturado, cobrado, pendiente, fecha de última compra, último contacto.

### Acciones

- **WhatsApp / Email**: misma lógica que en leads.
- **Upsell / Nueva venta**: registra otra conversión sobre el mismo lead.
  No crea un cliente nuevo — todo queda en el historial del mismo.
- **Exportar CSV**: descarga el listado filtrado.
- **Eliminar**: soft-delete (lo archiva, no se pierde el historial).

### Ficha de cliente

Similar a la del lead, con más énfasis en:

- Histórico de compras y pagos.
- Comisiones generadas (para el gestor responsable).
- Documentos firmados.

---

## 7. Productos y categorías

`/products` · todos los roles ven el catálogo; sólo admin/superadmin
edita.

### 12.1 Catálogo

Vista en cuadrícula o lista (toggle arriba a la derecha). Filtros por
categoría, estado (activo/inactivo) y búsqueda por nombre/SKU.

Cada producto tiene:

- **Nombre** y **SKU** (identificador único).
- **Categoría** (jerárquica — ver §12.3).
- **Precio** en la moneda del proyecto (EUR, MXN, COP, etc.).
- **Activo / inactivo**: los inactivos no aparecen al crear conversiones
  pero se conservan para histórico.
- **Links de pago** preconfigurados (Stripe, Mercado Pago, etc.) para
  enviar al cliente con un clic.
- **Notas internas** y **descripción pública** (para web).

### 12.2 Cursos pendientes

🔒 admin / superadmin

Vista filtrada del catálogo con productos marcados como "cursos en
preparación" — útil para coordinación pedagógica.

### 12.3 Árbol y categorías

`/products/tree` y `/configuracion/categorias-arbol`.

Las categorías son jerárquicas (carpeta → subcarpeta → …). Casos típicos:

```
ISEIE Académico
├── Máster Universitario
│   ├── Salud
│   └── Educación
├── Curso Experto
└── Diplomado
```

La vista de árbol permite arrastrar productos entre categorías.

### 12.4 Sincronización con WooCommerce

🔒 admin

Si un proyecto vende también a través de una tienda WordPress con
WooCommerce, los productos pueden sincronizarse automáticamente. Ver §19.

---

## 7. Matrículas

`/matriculas` · disponible para gestores

Una **matrícula** es la formalización académica de una conversión: ya no
es sólo "se vendió un curso" sino "el estudiante está inscrito en la
edición X que empieza el Y".

### Cada matrícula contiene

- Estudiante (lead convertido).
- Producto / programa.
- Edición (cohorte de inicio).
- Estado: pendiente, activa, finalizada, abandonada.
- Documentos académicos (expediente, título, contrato).
- Notas de soporte.

### Crear matrícula

Desde la ficha del cliente → **+ Matrícula** o desde `/matriculas` →
**+ Nueva**.

### Importar matrículas externas

🔒 admin

Si tienes un Excel histórico de alumnos antes del CRM, puedes importarlo
en lote desde el botón **Importar**.

---

## 7. Contabilidad

🔒 admin / superadmin · `/accounting`

Hub financiero del proyecto activo.

### 14.1 Dashboard de contabilidad

Cuatro KPIs en el período seleccionable (por defecto, año en curso):

- **Ingresos cobrados** — suma de pagos recibidos.
- **Por cobrar** — pendiente de las conversiones activas.
- **Egresos** — suma de gastos del período.
- **Balance neto** — ingresos − egresos.

Más:

- Gráfica de evolución mensual (ingresos vs egresos, 12 meses).
- Egresos por categoría (gráfica de barras horizontal).
- Tabla de **cuentas por cobrar** con vencimiento — los vencidos van en
  rojo con icono ⚠.

### 14.2 Ingresos

`/accounting/income` — listado de conversiones pagadas o parcialmente
pagadas. Exportable a CSV.

### 14.3 Cuentas por cobrar

`/accounting/receivable` — lo opuesto: lo que está pendiente. Las
columnas críticas son **importe pendiente** y **vencimiento**.

### 14.4 Egresos

`/expenses` — gastos del proyecto.

Cada egreso tiene:

- Fecha, categoría (sueldos, marketing, impuestos, servicios, compras,
  otros), proveedor, concepto, importe, notas.
- Documento adjunto (factura) opcional.

### 14.5 Cuentas por pagar

🔒 admin · `/accounting/payable` — facturas recibidas pendientes de
pagar. Aparte de la categorización de egresos, lleva un seguimiento
explícito de vencimientos y estado de pago.

---

## 7. Comisiones

`/commissions`

Las comisiones se calculan automáticamente sobre las conversiones del
gestor responsable, según las reglas configuradas por el admin.

### Tipos de regla

- **% sobre venta** (por defecto). Ej. 10 % del importe total.
- **Importe fijo por venta**.
- **Por escalones**: 5 % hasta 10k facturado, 10 % de 10-30k, 15 % a
  partir de 30k.

### Estados

- **Devengada**: la conversión existe pero el cobro no se ha cerrado.
- **Generada**: lista para pagar.
- **Pagada**: incluida en la nómina.

Un gestor sólo ve sus propias comisiones. Admin ve las de todo el
equipo.

---

## 7. Nóminas

🔒 admin · `/payroll`

Cada mes el admin "cierra" la nómina del proyecto:

1. El sistema suma comisiones generadas + salario base de cada gestor.
2. El admin aprueba la nómina (esto la marca como pagada).
3. Se genera un PDF nómina por empleado, archivado en su documentación.

> El CRM **no transfiere dinero**. Calcula importes y deja registro.
> La transferencia real la hace contabilidad por su canal habitual.

---

## 7. Documentos

🔒 admin · `/documentos`

Repositorio centralizado de documentos del proyecto:

- Contratos firmados por los estudiantes.
- Facturas emitidas y recibidas.
- Documentación académica (títulos, expedientes).
- PDFs generados desde plantillas (cartas de aceptación, certificados).

### Plantillas

`/documentos/config` permite definir **plantillas HTML** con variables
(`{{lead.nombre}}`, `{{producto.nombre}}`, `{{conversion.importe}}`…)
para generar documentos automáticamente al cambiar el estado de un lead
o convertirlo.

### Almacenamiento

Los archivos se guardan cifrados en **Cloudflare R2** (S3 compatible).
Para verlos, el CRM genera URLs temporales (15 minutos de vigencia) — si
abres un PDF y compartes el link, expirará pronto.

---

## 7. Formularios públicos

🔒 admin · `/forms`

Crea formularios web embebibles que generan leads automáticamente.

### Flujo típico

1. Crea un formulario con los campos que quieras (nombre, email,
   producto interés, comentarios…).
2. Configura: a qué proyecto pertenece, qué estado inicial dar al lead,
   si activar una **secuencia de email** (§20) al recibirlo.
3. Copia el **código embed** (un `<iframe>` con un ID único) y pégalo
   en la web de ISEIE.
4. Cada envío crea un lead en el proyecto correspondiente y notifica al
   gestor asignado por round-robin.

### Vista previa

Desde la ficha del formulario, pulsa **Previsualizar** para ver cómo se
renderiza con el branding del proyecto.

---

## 7. Captación: WooCommerce y Make

🔒 admin

### 19.1 WooCommerce

`/woocommerce`

Si vendes desde una tienda WordPress + WooCommerce, conecta tu site:

1. URL del site + Consumer Key + Consumer Secret (Ajustes → REST API en
   WordPress).
2. Mapea productos WooCommerce → productos CRM (1 a 1).
3. El **scheduler** corre cada 5 minutos y trae nuevos pedidos como
   conversiones automáticas.

### 19.2 Make (antes Integromat)

`/make-webhooks`

Cada webhook genera un endpoint público que recibe POST con datos de
leads. Lo configuras en Make.com como destino, y cada vez que se dispare
un escenario en Make, llegará un lead al CRM.

Casos típicos:

- Lead de Facebook Lead Ads → Make → CRM.
- Inscripción Eventbrite → Make → CRM.
- Mensaje Instagram DM (vía herramienta de terceros) → Make → CRM.

Cada webhook tiene un token de seguridad. Si alguien lo descubre y abusa
del endpoint, rotas el token y vuelves a copiar a Make.

---

## 7. Email automatizado (secuencias y plantillas)

🔒 admin

### 20.1 Plantillas

`/email-templates` — plantillas HTML reutilizables con variables. Pruebas
de envío disponibles desde la ficha.

### 20.2 Secuencias (drip campaigns)

`/email-sequences`

Una secuencia es un conjunto ordenado de envíos automáticos a partir de
un disparador (lead creado, lead convertido, lead inactivo X días…).

**Ejemplo de bienvenida**:

| Paso | Cuándo | Plantilla |
|---|---|---|
| 1 | inmediato | Bienvenida + presentación instituto |
| 2 | +2 días | Vídeo testimonial + CTA matrícula |
| 3 | +5 días | Oferta limitada |
| 4 | +14 días | Si no convirtió: encuesta de objeciones |

El scheduler de secuencias revisa cada **2 minutos** quién toca enviar.

### 20.3 Quitar un lead de una secuencia

Desde la ficha del lead → pestaña **Email** → **Cancelar secuencia**.
Útil cuando el lead pide explícitamente no recibir más comunicaciones.

---

## 7. Reportes

🔒 admin / superadmin · `/reports`

Informes operativos:

- **Embudo de conversión**: % de leads en cada estado y tasa de paso.
- **Comparativo gestores**: leads recibidos, contactados, convertidos,
  importe medio, % cierre.
- **Cohortes**: agrupación de leads por mes de captación y su evolución
  posterior.
- **Análisis ROI por canal**: cuánto te cuesta un lead de cada canal y
  cuánto factura.
- **Forecast**: proyección de cierres del trimestre basado en el ritmo
  actual.

Todos los reportes se exportan a CSV/Excel.

---

## 7. Notificaciones y actividad

### 22.1 Notificaciones

`/notifications` (campanita arriba derecha del sidebar)

- Recordatorios vencidos.
- Leads asignados sin contactar > 24h.
- Pagos vencidos.
- Menciones en notas.
- Cambios en tus matrículas.

Marca una como **leída** con un clic; el badge rojo desaparece cuando
quedan 0.

### 22.2 Actividad

`/activity` — feed cronológico completo del proyecto: quién hizo qué y
cuándo. Filtros por usuario, tipo de evento, fecha.

> Este feed alimenta también la **auditoría legal** del CRM: cualquier
> cambio sensible (eliminar lead, modificar precio, cerrar nómina) queda
> registrado con IP, usuario y timestamp.

---

## 7. Configuración general

`/settings`

Pestañas verticales:

- **Perfil del proyecto** 🔒 admin: nombre, slug, color primario, logo,
  emoji, descripción.
- **Canales de captación**: define los canales internos (Web, Facebook,
  Instagram, WhatsApp, Recomendación…) y su orden.
- **Atajos personalizados**: configura accesos rápidos para tu rol.
- **Campos personalizados** 🔒 admin: añade campos extra a los leads
  (`fecha_nacimiento`, `nivel_estudios`, etc.). Soporta texto, número,
  fecha, opción, multi-opción.
- **Integraciones** 🔒 admin: credenciales API de Brevo, R2, Stripe,
  Meta Ads, Google Ads. Las credenciales se guardan **cifradas
  AES-256** en la base de datos.
- **Preferencias** 🟢: idioma, formato de fecha, zona horaria.

---

## 7. Roles y administración de usuarios

🔒 admin / superadmin · `/roles`

### 24.1 Crear usuario

1. **+ Nuevo usuario**.
2. Email, nombre, rol, proyectos a los que tiene acceso.
3. El sistema le envía el correo de "Establecer contraseña".

### 24.2 Editar permisos

Cada rol tiene permisos por defecto, pero un admin puede ajustar
excepciones puntuales (ej. dar a un gestor concreto acceso de lectura a
egresos).

### 24.3 Desactivar usuario

Nunca se elimina realmente — se **desactiva**. El histórico de leads,
ventas y comisiones se conserva, pero el usuario no puede entrar al CRM.

### 24.4 Auditoría

`/roles` → pestaña **Auditoría** muestra el log completo de accesos y
acciones del proyecto. Filtros por usuario, acción, fecha.

---

## 7. Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl K` | Abrir buscador global (próximamente). |
| `Esc` | Cerrar drawer, modal o menú abierto. |
| `g` luego `d` | Ir a Dashboard. |
| `g` luego `l` | Ir a Prospectos. |
| `g` luego `c` | Ir a Clientes. |
| `n` luego `l` | Nuevo lead. |
| `n` luego `c` | Nueva conversión (en ficha de lead). |
| `?` | Mostrar este listado en pantalla. |

> Si estás escribiendo en un input, los atajos de navegación se
> desactivan automáticamente para no interferir.

---

## 7. Buenas prácticas

### Para gestores

- **Contacta a los leads nuevos en menos de 1 hora**. La tasa de
  conversión cae > 50 % pasadas las 24 h.
- **Actualiza el estado en cuanto cambia**. Un pipeline desactualizado
  no sirve a nadie.
- **Usa los recordatorios** en lugar de tu memoria. El CRM existe para
  esto.
- **Anota lo importante en notas internas**. Si tú dejas el proyecto,
  el siguiente gestor agradecerá tener el contexto.
- **Etiqueta los leads con criterio**: temperatura (caliente/templado/
  frío), objeción principal, fuente fina.

### Para admins

- **Revisa la auditoría una vez al mes**. Detectar usos raros temprano
  ahorra disgustos.
- **Cierra las nóminas a tiempo**. Si quedan abiertas, las comisiones
  generadas se acumulan y distorsionan los KPIs.
- **No edites precios masivamente sin avisar a tus gestores**: los
  cálculos de comisiones pueden cambiar retroactivamente.
- **Rota tokens (Make, WooCommerce, Brevo) cada 6 meses** como mínimo.

### Para todos

- **No copies tokens ni passwords en notas** del CRM. Es lectura por
  varios roles, no es un gestor de secretos.

---

## 7. Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| "Algo se ha roto" tras abrir una página | Bundle nuevo + cache del navegador | Ctrl + F5 (recarga forzada). |
| No veo un proyecto que debería | Falta de asignación | Pide a tu admin que te añada en Roles → tu usuario → Proyectos. |
| El email de "Establecer contraseña" no llega | Cola Brevo o spam | Revisa spam; si nada, pide reenvío. |
| Un lead que creé no aparece | Filtros activos | Limpia filtros del listado (botón "Limpiar"). |
| WhatsApp abre sin número | Lead sin teléfono | Edita la ficha del lead y añade el teléfono con prefijo internacional. |
| La conversión no me deja guardar | Producto inactivo seleccionado | Vuelve a Productos y reactívalo, o elige otro. |
| Cuotas no cuadran al céntimo | Redondeo del fraccionamiento | Es esperado — la última cuota compensa los céntimos del reparto. |
| 401 / sesión expirada inesperada | Cookie de refresh borrada o cambio de IP/red | Vuelve a hacer login. |
| Los KPIs del dashboard salen a 0 | Periodo sin actividad o proyecto recién creado | Cambia el período (365 días) o el proyecto activo. |

### Cuando reportar un bug

Si lo anterior no resuelve, abre **Soporte** (§29) con:

1. Captura de pantalla del error o de la página en blanco.
2. URL exacta donde sucedió.
3. Qué intentabas hacer.
4. Hora aproximada (a la hora) para que podamos cruzar con logs.

---

## 7. Glosario

- **Lead / Prospecto**: persona interesada que aún no compró.
- **Conversión**: registro de una venta cerrada sobre un lead.
- **Cliente**: lead en estado Convertido.
- **Matrícula**: inscripción formal en un programa.
- **Round-robin**: asignación rotatoria justa entre gestores.
- **Cuota**: cada uno de los pagos parciales en una venta fraccionada.
- **Secuencia / Drip campaign**: emails enviados automáticamente en
  fechas relativas a un evento (creación del lead, conversión, etc.).
- **Webhook**: URL pública del CRM a la que otros sistemas envían POST
  con datos para crear leads.
- **SKU**: código único de producto.
- **R2**: servicio de almacenamiento de archivos (Cloudflare).
- **Token**: clave de acceso a una API externa.
- **Soft-delete**: archivado sin borrado real, recuperable.

---

## 7. Soporte

| Canal | Para qué | Tiempo de respuesta |
|---|---|---|
| **Email** `soporte@iseie.com` | Bugs, dudas, mejoras | < 24 h laborales |
| **WhatsApp interno** del equipo | Incidencias urgentes | inmediato (horario laboral) |
| **`/soporte`** en el CRM | Abrir ticket trazable | < 24 h |
| **`/status`** | Comprobar estado del sistema | en vivo |

### Antes de reportar

1. Reproduce el problema en otra pestaña / navegador.
2. Comprueba en `/status` que el sistema esté operativo.
3. Adjunta captura + URL + lo que intentabas hacer.

> El CRM ISEIE está en versión **1.0 productiva (beta)**. Tu feedback es
> esencial para que sea cada vez mejor. Gracias por usarlo con ojo
> crítico.

---

*Manual mantenido por el equipo técnico de ISEIE. Sugerencias y
correcciones: `soporte@iseie.com`.*
