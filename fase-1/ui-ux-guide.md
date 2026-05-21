# CRM MultiProyecto — Guia UI/UX

Guia de diseno e interaccion para el CRM interno. Documento vivo, fase 1. Complementa `docs/05-arquitectura-frontend.md` con criterios visuales, patrones de componentes y decisiones de interaccion.

Stack de referencia: React 18 + Vite + Tailwind + shadcn/ui (Radix) + Phosphor Icons + Recharts.

---

## 1. Investigacion: patrones de CRMs modernos

Resumen de los patrones que tomamos prestados de productos que hacen bien la gestion de leads/pipeline, y cuales descartamos.

| Producto | Que tomamos | Que descartamos |
|---|---|---|
| **HubSpot** | Pipeline tipo tablero Kanban con drag and drop, sidebar fijo a la izquierda, panel lateral (sheet) para edicion rapida de lead sin salir de la lista | Densidad excesiva de ajustes, navegacion en tres niveles, overhead visual |
| **Pipedrive** | Kanban como vista por defecto del embudo, KPIs en tarjetas arriba, accion principal siempre visible arriba a la derecha (Nuevo lead), atajo rapido para pasar de etapa | Paleta demasiado saturada, iconos propios inconsistentes |
| **Close** | Densidad tipo mail client, lista vertical con preview a la derecha (two-pane), telefono/email inline desde la fila, busqueda global como protagonista | Enfoque "inside sales" muy centrado en llamadas |
| **Attio** | Tablas configurables tipo Notion, inline editing directo en celdas, command palette Cmd+K como centro de navegacion, tipografia refinada | Complejidad del modelo de datos para usuarios no tecnicos |
| **Twenty CRM** | Open source, base shadcn/Radix similar a la nuestra, sheets laterales en lugar de modales grandes, detalle de lead tipo "record page" con secciones plegables | Sistema de relaciones muy flexible, innecesario en fase 1 |
| **Salesforce Lightning** | Jerarquia tipica: navbar superior + sidebar + breadcrumbs, record pages con tabs laterales, activity timeline como eje del detalle | Sobrecarga visual, curva de aprendizaje alta, personalizacion infinita |

**Decisiones clave que derivan de la investigacion:**

1. Layout canonico: sidebar fijo + navbar superior + area de contenido. Familiar, no hay que explicarlo.
2. Vista principal de leads: tabla densa por defecto, con opcion Kanban como vista secundaria.
3. Detalle de lead: sheet lateral desde la lista (edicion rapida) + record page completa en `/leads/:id` (vista profunda).
4. Command palette (Cmd+K) como shortcut de poder, no como navegacion principal.
5. Inline editing en la tabla para campos de bajo riesgo (estado, gestor asignado, etiquetas).

---

## 2. Principios de diseno

Seis principios que deben sesgar cualquier decision de UI en el CRM.

### 2.1 Densidad

La densidad debe ser mayor que la de una app tipo landing, pero menor que la de un terminal tipo Close. Objetivo: 10 a 15 filas de leads visibles sin scroll en una pantalla 1440x900.

- Altura de fila en tabla de leads: **48px** (py-3 con contenido vertical centrado).
- Altura de fila en tablas secundarias (settings, usuarios): **56px**.
- Padding de card: **p-6** (24px) en contenedores principales, **p-4** (16px) en cards secundarias.
- Espaciado entre secciones: **space-y-6** en pages, **space-y-4** dentro de cards.

### 2.2 Jerarquia

Una sola accion primaria por pantalla. Las acciones secundarias son `ghost` o `outline`. Las destructivas siempre requieren confirmacion explicita y viven separadas visualmente.

- Primaria: `<Button>` (default, fondo `primary`).
- Secundaria: `<Button variant="outline">` o `<Button variant="ghost">`.
- Destructiva: `<Button variant="destructive">` + dialog de confirmacion.

### 2.3 Escaneabilidad

El usuario escanea, no lee. Texto alineado a la izquierda, numeros alineados a la derecha (tabular-nums), fechas relativas ("hace 2 h") en vez de absolutas cuando el contexto lo permite.

```jsx
<td className="text-right tabular-nums">{formatCurrency(lead.value)}</td>
```

### 2.4 Acciones siempre claras

Cada pantalla debe responder en menos de un segundo: "que es esto y que puedo hacer aqui". Las acciones contextuales viven en un `DropdownMenu` con trigger `DotsThreeVertical` al final de cada fila.

### 2.5 Feedback

Toda accion del usuario provoca un feedback visible en < 100 ms:

- Optimistic updates donde sea seguro (cambio de estado, asignacion de gestor).
- Skeleton loaders en carga inicial.
- Toast (`sonner` o `shadcn/ui toast`) al completarse accion async, error, o deshacer disponible.
- Nunca spinners bloqueantes a pantalla completa fuera del login inicial.

### 2.6 Empty states con direccion

Cada lista vacia debe explicar que va aqui, por que esta vacio ahora, y cual es la accion siguiente. No son espacios decorativos.

---

## 3. Patrones de layout

### 3.1 Sidebar + navbar

Layout fijo heredado de `AppLayout`.

| Elemento | Ancho expandido | Ancho colapsado | Altura |
|---|---|---|---|
| Sidebar | **256px** (`w-64`) | **64px** (`w-16`) | full viewport |
| Navbar | — | — | **64px** (`h-16`) |
| Contenido | `flex-1` | `flex-1` | `min-h-[calc(100vh-64px)]` |

- Sidebar colapsable manualmente (`List` icon toggle) y automaticamente en `< lg` (1024px).
- Cuando esta colapsado: solo iconos de 20px (Phosphor `duotone`) centrados, con tooltip al hover.
- Navbar: breadcrumbs a la izquierda, `ProjectSelector` al centro-izquierda, accion de busqueda global (`MagnifyingGlass`) + avatar de usuario a la derecha.

### 3.2 Dialogs vs Sheets vs Drawers

Regla: el tipo de superficie depende del alcance de la tarea, no de la preferencia visual.

| Tipo | Cuando usarlo | Ancho | shadcn |
|---|---|---|---|
| **Dialog** | Accion corta y bloqueante: confirmar, crear entidad simple (< 6 campos) | 420-560px | `Dialog` |
| **Sheet** (lateral) | Edicion contextual de un registro sin perder la lista detras | 480px (md), 640px (lg) | `Sheet` (side=right) |
| **Drawer** (mobile) | En `< md` (768px), sustituye Sheet cuando el contenido no cabe lateralmente | full width, max-h 90vh | `Drawer` (vaul) |
| **Record page** (full) | Vista profunda de un lead, con timeline, actividades, notas, archivos | — | Route `/leads/:id` |

### 3.3 Tablas

Tablas como vista por defecto. Construidas sobre `@tanstack/react-table` + shadcn `Table`.

- Cabecera sticky (`sticky top-0 bg-background z-10`).
- Filas con hover `hover:bg-muted/50 transition-colors`.
- Columna seleccionable (`Checkbox`) opcional en el extremo izquierdo.
- Ultima columna: acciones (`DotsThreeVertical`, ancho fijo 48px).
- Ordenacion por columna: click en header con `CaretUpDown` / `CaretUp` / `CaretDown`.
- Paginacion inferior: **25 filas por defecto**, selector 25/50/100.

### 3.4 Cards

Card estandar (heredada del estilo actual de `DashboardPage`):

```jsx
<div className="bg-card p-6 rounded-3xl border border-border shadow-[0_1px_2px_0_rgb(0_0_0/0.05)] hover:shadow-md transition-shadow">
  {children}
</div>
```

- Borde redondeado **3xl** (24px) para cards de dashboard/KPI.
- Borde redondeado **xl** (12px) para cards dentro de listas o tabs.
- Sombra minima en reposo, `hover:shadow-md` en cards interactivas.

### 3.5 Forms

- Layout vertical por defecto. Horizontal solo en edicion inline.
- Grupos de campos separados por `space-y-4`, secciones por `space-y-8` y separador visual.
- Label arriba del input, helper text debajo en `text-sm text-muted-foreground`.
- Errores con `text-sm text-destructive` y borde `border-destructive` en el input.
- Validacion on blur + on submit. Nunca on change salvo campos asincronos (disponibilidad de email).

### 3.6 Detail pages

Estructura canonica de record page de un lead (`/leads/:id`):

```
[breadcrumbs]  Leads / Maria Garcia
[header] Nombre + estado badge + acciones primarias
[grid 2 col]
  [col izq 2/3]   [col der 1/3]
  - Resumen       - Info contacto
  - Timeline      - Gestor asignado
  - Notas         - Metadatos (UTMs, canal, fuente)
  - Archivos      - Historial de asignacion
```

- Tabs horizontales cuando hay mas de 3 secciones de peso equivalente (Resumen, Actividad, Archivos, Notas).
- Siempre hay una accion primaria visible en el header (Marcar como contactado, Convertir, etc.).

---

## 4. Especificaciones de componentes

### 4.1 Lead card (vista Kanban)

Usado en la vista Kanban del pipeline. Dimensiones 260x120px aprox.

```jsx
<div className="bg-card p-4 rounded-xl border border-border cursor-grab hover:shadow-md transition-all">
  <div className="flex items-start justify-between mb-2">
    <p className="font-medium text-sm truncate">Maria Garcia</p>
    <Badge className={ESTADO_STYLES[lead.estado]}>{ESTADO_LABELS[lead.estado]}</Badge>
  </div>
  <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
  <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
    <span className="flex items-center gap-1"><User size={12} />{lead.gestor}</span>
    <span>hace 2h</span>
  </div>
</div>
```

### 4.2 Lead row (vista tabla)

| Columna | Ancho | Contenido | Alineacion |
|---|---|---|---|
| Checkbox | 40px | `<Checkbox>` | center |
| Nombre | 200px | Bold + email debajo en `text-xs text-muted-foreground` | left |
| Estado | 140px | `<Badge>` con `ESTADO_STYLES` | left |
| Canal | 120px | `<Badge>` con `CANAL_STYLES` | left |
| Gestor | 160px | Avatar 24px + nombre | left |
| Creado | 120px | Fecha relativa | left |
| Valor | 120px | Moneda, tabular-nums | right |
| Acciones | 48px | `DotsThreeVertical` trigger | center |

### 4.3 Lead detail (record page)

Secciones:

1. **Header** (80px): avatar + nombre + estado + acciones primarias (Marcar contactado, Convertir, Asignar).
2. **Info de contacto** (card): email, telefono, canal, fuente, UTMs.
3. **Timeline** (card con scroll interno max-h-96): eventos ordenados desc, agrupados por dia.
4. **Notas** (card): textarea + boton `Plus` para anadir nota.
5. **Archivos** (card): grid de dossiers/adjuntos.

### 4.4 KPI card

Pattern ya existente en `frontend/src/shared/pages/DashboardPage.jsx`. Reutilizar el componente `KpiCard` tal cual, con icono Phosphor `duotone`, label arriba, valor grande, badge de tendencia (`TrendUp`/`TrendDown`).

### 4.5 Filter bar

Barra superior sobre la tabla/Kanban. Sticky por debajo del navbar.

```jsx
<div className="flex items-center gap-2 py-3 border-b border-border bg-background sticky top-16 z-20">
  <Input placeholder="Buscar lead..." icon={MagnifyingGlass} className="max-w-sm" />
  <Select /> {/* Estado */}
  <Select /> {/* Canal */}
  <Select /> {/* Gestor */}
  <DateRangePicker />
  <div className="flex-1" />
  <Button variant="outline" size="sm"><FunnelSimple /> Mas filtros</Button>
  <Button size="sm"><Plus /> Nuevo lead</Button>
</div>
```

### 4.6 Badges de estado (6 estados)

Mapeo unico, **debe coincidir con `frontend/src/shared/pages/DashboardPage.jsx` lineas 20-25**. No crear variantes divergentes.

| Estado | Clase Tailwind |
|---|---|
| `nuevo` | `bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400` |
| `por_contactar` | `bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400` |
| `contactado` | `bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400` |
| `en_seguimiento` | `bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400` |
| `convertido` | `bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400` |
| `no_interesado` | `bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400` |

Labels: `Nuevo`, `Por contactar`, `Contactado`, `En seguimiento`, `Convertido`, `No interesado`.

### 4.7 Badges de canal (7 canales)

| Canal | Icono Phosphor | Clase |
|---|---|---|
| `web` | `Globe` | `bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400` |
| `meta_ads` | `FacebookLogo` | `bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400` |
| `google_ads` | `GoogleLogo` | `bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-500` |
| `organico` | `MagnifyingGlass` | `bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400` |
| `referido` | `Users` | `bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400` |
| `whatsapp` | `WhatsappLogo` | `bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400` |
| `otro` | `DotsThree` | `bg-slate-50 text-slate-600 dark:bg-slate-800/30 dark:text-slate-400` |

### 4.8 Timeline item

```jsx
<div className="flex gap-3 pb-4 border-l border-border pl-4 ml-2 relative">
  <div className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-primary" />
  <div className="flex-1">
    <p className="text-sm">
      <span className="font-medium">Diego</span> cambio estado a <Badge>Contactado</Badge>
    </p>
    <p className="text-xs text-muted-foreground">hace 2 horas</p>
  </div>
</div>
```

### 4.9 Empty state

```jsx
<div className="flex flex-col items-center justify-center py-16 text-center">
  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
    <UserPlus size={32} weight="duotone" className="text-muted-foreground" />
  </div>
  <h3 className="font-semibold mb-1">Aun no hay leads</h3>
  <p className="text-sm text-muted-foreground mb-4 max-w-sm">
    Los leads apareceran aqui cuando alguien complete un formulario o llegue via webhook.
  </p>
  <Button><Plus size={16} /> Crear lead manual</Button>
</div>
```

### 4.10 Skeletons

Reglas:

- Skeleton de tabla: 8 filas por defecto, usando `animate-pulse bg-muted`.
- Skeleton de KPI: 4 cards con altura fija replicando el real.
- Nunca mostrar skeleton mas de 2 segundos: si la peticion tarda mas, mostrar indicador de carga secundario.

### 4.11 Dialogs y confirmaciones

- Confirmacion destructiva: titulo directo ("Eliminar lead?"), descripcion con consecuencia ("Esta accion no se puede deshacer"), boton primario `variant="destructive"` con verbo ("Eliminar"), cancelar a la izquierda como `ghost`.
- Confirmacion no destructiva: titulo en forma afirmativa ("Convertir lead?"), descripcion opcional, boton primario con verbo.

---

## 5. Patrones de interaccion

### 5.1 Atajos de teclado

| Atajo | Accion |
|---|---|
| `G` luego `L` | Ir a Leads |
| `G` luego `D` | Ir a Dashboard |
| `G` luego `P` | Ir a Productos |
| `G` luego `S` | Ir a Settings |
| `Cmd+K` / `Ctrl+K` | Abrir command palette |
| `N` | Nuevo lead (desde Leads) |
| `/` | Foco en search |
| `Esc` | Cerrar dialog/sheet |
| `Shift+?` | Mostrar ayuda con listado de shortcuts |
| `J` / `K` | Navegar filas arriba/abajo en tabla |
| `Enter` | Abrir lead seleccionado |

Implementacion con `react-hotkeys-hook` o `cmdk` + listeners nativos.

### 5.2 Command palette (Cmd+K)

Construir sobre `cmdk` (incluido en shadcn como `Command`). Categorias:

- **Ir a:** paginas principales (Leads, Dashboard, Productos, Settings).
- **Leads:** busqueda fuzzy por nombre o email.
- **Acciones:** Nuevo lead, Nuevo producto, Cerrar sesion.
- **Cambiar proyecto:** lista de proyectos accesibles al usuario.

### 5.3 Inline editing

En la tabla de leads, las celdas editables inline son:

- **Estado**: click abre `Select` con las 6 opciones.
- **Gestor**: click abre `Combobox` con busqueda de usuarios.
- **Etiquetas**: click abre multi-select.

El resto (nombre, email, telefono) se edita desde la sheet lateral o la record page. El hover muestra un icono `PencilSimple` sutil en la celda editable.

### 5.4 Drag and drop (Kanban)

Libreria: **@dnd-kit/core** + **@dnd-kit/sortable**. No usar react-beautiful-dnd (abandonada).

- Overlay durante el drag, la card original se queda en `opacity-50`.
- Validacion en drop: si la transicion no es valida (ej. `convertido` -> `nuevo`), revertir con toast informativo.
- Optimistic update: la card se mueve instantaneamente, la peticion se envia en background, rollback si falla.

### 5.5 Optimistic UI

Operaciones optimistas (rollback en error):

- Cambio de estado.
- Cambio de gestor asignado.
- Anadir/quitar etiqueta.
- Marcar como contactado.

Operaciones sincronas con loading (sin optimismo):

- Crear lead.
- Eliminar lead.
- Convertir lead (cambia otras entidades).
- Upload de archivos.

### 5.6 Toasts

Libreria: **sonner** (recomendada por shadcn). Posicion `bottom-right`.

| Tipo | Duracion | Cuando |
|---|---|---|
| Success | 3s | Creacion, actualizacion confirmada |
| Error | 6s | Fallo de peticion, validacion backend |
| Info | 4s | Info contextual sin accion |
| Action | 8s | Con boton "Deshacer" para operaciones reversibles |

---

## 6. Jerarquia de navegacion

### 6.1 Sidebar

Orden fijo. Iconos Phosphor, peso `duotone`, tamano 20px.

| Seccion | Icono | Ruta |
|---|---|---|
| Dashboard | `SquaresFour` | `/` |
| Leads | `UserPlus` | `/leads` |
| Pipeline | `Kanban` | `/pipeline` |
| Productos | `Package` | `/products` |
| Campanas | `MegaphoneSimple` | `/campaigns` |
| Reportes | `ChartLine` | `/reports` |
| Usuarios (admin+) | `Users` | `/users` |
| Settings | `Gear` | `/settings` |

Separador visual entre bloque operativo (Dashboard, Leads, Pipeline) y bloque de gestion (Usuarios, Settings).

### 6.2 Breadcrumbs

Siempre presentes en navbar para rutas de 2+ niveles. Ultimo elemento no clickable, resto con `text-muted-foreground hover:text-foreground`.

Ejemplo: `Leads / Maria Garcia`.

### 6.3 Back vs Close

- **Back** (`ArrowLeft`): cuando la pagina anterior es significativa (detalle -> lista).
- **Close** (`X`): cuando la superficie es modal/sheet/drawer.
- Nunca mezclar ambos en la misma pantalla.

### 6.4 URL structure

```
/                       Dashboard
/leads                  Lista de leads
/leads/:id              Detalle de lead
/leads/new              Crear lead (alternativa a dialog)
/pipeline               Vista Kanban
/products               Productos
/products/:id           Detalle producto + dossiers
/users                  Usuarios (admin+)
/settings               Settings del proyecto
/settings/integrations  Meta, Google, Brevo
/login                  Login
```

Query params para filtros de lista: `/leads?estado=nuevo&canal=meta_ads&gestor=3`. Persistentes en URL para compartibles.

---

## 7. Responsive

Breakpoints Tailwind por defecto, uso pragmatico:

| Breakpoint | Ancho | Comportamiento |
|---|---|---|
| `sm` | 640px | Dialogs a full width, sheet -> drawer |
| `md` | 768px | Tabla -> cards apiladas |
| `lg` | 1024px | Sidebar colapsado automaticamente |
| `xl` | 1280px | Layout canonico completo |
| `2xl` | 1536px | Max-width 1440px centrado para contenido |

### 7.1 Table-to-cards en < md

En movil, la tabla se transforma en una lista de cards:

```jsx
{isMobile ? (
  <div className="space-y-3">
    {leads.map(lead => <LeadMobileCard key={lead.id} lead={lead} />)}
  </div>
) : (
  <LeadsTable leads={leads} />
)}
```

La card movil muestra: nombre + estado arriba, email debajo, canal + gestor + fecha en fila inferior. Click abre el drawer de detalle.

### 7.2 Kanban en movil

El Kanban se convierte en un carousel horizontal de columnas, cada columna ocupa 85% del viewport. Swipe entre columnas. Drag and drop desactivado en < md, se usa un `Select` para cambiar de estado.

---

## 8. Dark mode

Variables CSS ya definidas en `frontend/src/index.css`. Usar siempre los tokens, nunca hex directos.

Tokens principales (referencia):

- `--background`, `--foreground`
- `--card`, `--card-foreground`
- `--primary`, `--primary-foreground`
- `--muted`, `--muted-foreground`
- `--border`
- `--destructive`, `--destructive-foreground`

### 8.1 Reglas para dark mode

1. Todo componente debe probarse en ambos modos antes de merge.
2. Los badges usan el patron `bg-X-50 ... dark:bg-X-950/30 ...` (opacidad 30% para fondos en dark).
3. Las sombras en dark se atenuan: usar `shadow-none` o `shadow-[0_1px_2px_0_rgb(0_0_0/0.3)]` en vez de las sombras default.
4. Imagenes con fondo blanco deben tener `dark:bg-white` para mantener contraste, o filtro si es icono.

### 8.2 Toggle

Toggle de tema en navbar (`Sun` / `Moon`), persistencia en `localStorage`, respeto inicial de `prefers-color-scheme`.

---

## 9. Accesibilidad

Nivel objetivo: **WCAG 2.1 AA**.

### 9.1 Navegacion por teclado

- Todo componente interactivo accesible via `Tab`.
- Orden logico de foco (DOM order).
- Foco visible siempre: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- Trampas de foco en dialogs y sheets (Radix lo hace por defecto).
- `Esc` cierra dialogs, sheets, drawers, dropdowns.

### 9.2 ARIA

- Usar primitivas de Radix (via shadcn) siempre que sea posible. Ya traen ARIA correcto.
- Botones con solo icono: `aria-label` obligatorio.
- Listas con seleccion: `role="list"` + `aria-selected` en items.
- Tablas: `<caption>` o `aria-label` a nivel tabla describiendo el contenido.

### 9.3 Contraste

- Texto normal: ratio >= 4.5:1.
- Texto grande (>= 18px o 14px bold): ratio >= 3:1.
- Iconos funcionales: ratio >= 3:1 con el fondo.
- Verificar los badges de canal (sobre todo `whatsapp` verde y `google_ads` amarillo) en ambos modos.

### 9.4 Reduced motion

Respetar `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Animaciones de drag, fade de toasts y transitions de sheet se desactivan o acortan drasticamente.

### 9.5 Anuncios dinamicos

- Cambios de estado importantes via `aria-live="polite"` en una region oculta.
- Errores de formulario vinculados al campo con `aria-describedby` al mensaje de error.

---

## 10. Prioridad de implementacion

Cinco fases incrementales. Cada fase es un release internamente utilizable.

### Fase 1 — Foundations (semana 1-2)

Objetivo: base visual consistente para todo lo que venga despues.

- Definir y congelar paleta en `index.css` (claro y oscuro).
- Migrar componentes shadcn base: Button, Input, Select, Dialog, Sheet, Table, Badge, DropdownMenu, Tooltip, Toast (sonner).
- Implementar `AppLayout` definitivo: sidebar colapsable + navbar + area contenido.
- Setup de tema dark/light con toggle persistente.
- Crear `Badge` con los 6 estados + 7 canales ya mapeados.
- Empty states y skeletons reutilizables.

### Fase 2 — Lead core UX (semana 3-4)

Objetivo: la operacion diaria (gestionar leads) es comoda y rapida.

- Tabla de leads con ordenacion, paginacion, filtros en URL.
- Sheet lateral de detalle rapido (edicion inline).
- Record page completa en `/leads/:id` con tabs.
- Crear lead (dialog).
- Inline editing de estado y gestor en la tabla.
- Toast con "Deshacer" en cambios de estado.

### Fase 3 — Pipeline y dashboards (semana 5-6)

Objetivo: visualizacion del embudo y metricas.

- Vista Kanban en `/pipeline` con drag and drop (@dnd-kit).
- Dashboard con KPIs y graficos (Recharts), reutilizando el `KpiCard` existente.
- Filtros de fecha globales en dashboard.
- Exportacion CSV de leads filtrados.

### Fase 4 — Productividad (semana 7)

Objetivo: atajos y eficiencia para usuarios avanzados.

- Command palette (Cmd+K).
- Todos los keyboard shortcuts (`G L`, `N`, `/`, `J`/`K`, etc.).
- Dialog de ayuda con `Shift+?`.
- Busqueda global en navbar.
- Bulk actions en tabla (seleccionar multiples + cambio de estado masivo).

### Fase 5 — Polish (semana 8)

Objetivo: pulido final antes de onboarding.

- Pase completo de accesibilidad WCAG AA (navegacion teclado, contraste, ARIA).
- Reduced motion.
- Responsive completo incluyendo Kanban en movil.
- Optimizacion de performance: virtualizacion de tablas > 100 filas, memoizacion de componentes pesados.
- Revision de microcopy (empty states, confirmaciones, errores).
- Tests de snapshot de componentes criticos.

---

## Referencias cruzadas

- `docs/05-arquitectura-frontend.md` — arquitectura general de rutas y layouts.
- `frontend/src/shared/pages/DashboardPage.jsx` lineas 20-25 — mapa canonico de colores de badges de estado. **Cualquier nuevo mapeo debe replicar exactamente estas clases.**
- `frontend/src/index.css` — variables CSS del tema claro y oscuro.
- `frontend/src/shared/components/ui/` — primitivas shadcn ya instaladas.
- `frontend/src/shared/components/layout/Sidebar.jsx` — implementacion actual del sidebar.
- `CLAUDE.md` — convenciones de codigo (no cambiar stack, no anadir libs sin justificacion).

---

Documento fase 1. Proximas revisiones cuando se incorporen modulos de campanas, reportes avanzados, y cuando Angel valide el diseno desde Figma.
