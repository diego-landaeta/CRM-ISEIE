# WooCommerce — Importador con mapeo flexible

**Jira:** CRM-177
**Estado:** 📝 Backlog
**Tipo:** Epic (integracion externa)

## Contexto

Los proyectos (Psiko, ISEIH, Fono) venden sus cursos desde WordPress + WooCommerce en sus tiendas publicas. Hoy la lista de productos del CRM se crea a mano y se descincroniza. Queremos:

1. Conectar cada proyecto con su tienda WC via credenciales API
2. Extraer productos de WC e importar al CRM con sus atributos (brochure, stripe link, precio, imagen, categoria, descripcion)
3. Mapear **visualmente** cada campo WC (incluyendo meta_data con nombres custom) al campo CRM correspondiente
4. Update automatico si cambian en WC (sin duplicar)

## Por proyecto

Cada proyecto tiene su propia tienda WC y sus credenciales (guardadas encriptadas AES-256-GCM).

## Config (ProjectSettingsDialog > tab "WooCommerce")

- URL de la tienda (ej `https://psikoaprende.com`)
- Consumer Key + Consumer Secret (encriptadas)
- Estado: conectado / desconectado / error
- "Probar conexion" → `GET /wp-json/wc/v3/system_status`
- "Importar cursos" → abre el importador

## Importador con UI de mapeo

### Nombres custom en WC

Cada tienda puede tener `meta_data` con nombres no estandar. Ejemplo real:
- En Psiko el campo descripcion esta como `meta_data.estudiar`
- En ISEIH como `meta_data.long_description`
- Otras tiendas usan `short_description` o `description` estandar

La UI detecta todos los meta_data y el admin mapea visualmente:

```
┌─────────────────────────────────────────────────┐
│ Importar cursos de psikoaprende.com             │
├─────────────────────────────────────────────────┤
│ [▶ Detectar mapeo automatico]                   │
│ [📋 Copiar mapeo desde otro proyecto]           │
│                                                 │
│ CAMPO WC            | VALOR EJ     | MAPEAR A  │
│ name                | Master Neuro | nombre ✓  │
│ price               | 1200         | precio ✓  │
│ sku                 | MN-2026      | sku ✓     │
│ permalink           | https://...  | url_info ✓│
│ meta_data.estudiar  | Dominaras... | [descripcion ▾]│
│ meta_data.folleto   | https://...  | [→ dossier ▾]  │
│ meta_data.pagar_str | https://...  | [stripe_link ▾]│
│ images[0].src       | https://...  | imagen ✓  │
│                                                 │
│ PRODUCTOS:                                      │
│ ☑ Importar todos (10)                           │
│ ☐ Solo seleccionados (5)                        │
│   ☑ Master Neuroeducacion (nuevo)              │
│   ☑ Curso Mindfulness (nuevo)                  │
│   ☑ Taller Logopedia (update)                  │
│                                                 │
│ [Cancelar]        [Importar 10 productos]       │
└─────────────────────────────────────────────────┘
```

### Mapeo masivo

- "Detectar mapeo automatico" (heuristica por nombre similar: estudiar/description/descripcion, pagar/stripe/checkout, folleto/brochure/pdf, etc)
- "Copiar mapeo a todos" (aplica un mapeo a futuros products)
- "Copiar mapeo desde OTRO proyecto" (plantilla entre tiendas similares)
- Se guarda el mapeo en `projects.wc_field_mapping JSONB` para siguientes sincros

## Comportamiento del import

- **Productos ya existentes** (match `wc_product_id`): **UPDATE** con ultimos valores
- **Variaciones WC** (tallas, modalidades): se guardan como JSONB en `products.variations`, **NO** N productos
- **Categorias nuevas**: se crean automaticamente en `product_categories` del proyecto respetando el arbol completo (hasta 5 niveles segun CRM-195)
- **Brochures** → `dossier` (descarga PDF + sube a R2/local)
- **Imagenes** → `products.imagen` (descarga + sube)

## Backend

```sql
-- Migracion
ALTER TABLE products
  ADD COLUMN wc_product_id INT,
  ADD COLUMN wc_last_synced_at TIMESTAMPTZ,
  ADD COLUMN variations JSONB;

ALTER TABLE projects
  ADD COLUMN wc_url VARCHAR(500),
  ADD COLUMN wc_consumer_key_encrypted BYTEA,
  ADD COLUMN wc_consumer_secret_encrypted BYTEA,
  ADD COLUMN wc_field_mapping JSONB;

CREATE TABLE wc_import_runs (
  id SERIAL PRIMARY KEY,
  project_id INT REFERENCES projects(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  total_productos INT,
  importados INT,
  errores JSONB,
  triggered_by INT REFERENCES users(id)
);
```

## Endpoints

| Metodo | Path | Descripcion |
|---|---|---|
| POST | `/api/woocommerce/:projectId/test` | Probar conexion |
| GET | `/api/woocommerce/:projectId/preview` | Lista productos WC + diff vs CRM |
| POST | `/api/woocommerce/:projectId/import` | Ejecuta import con mapping |
| PATCH | `/api/woocommerce/:projectId/mapping` | Guarda mapping |
| GET | `/api/woocommerce/:projectId/runs` | Historial de imports |

## Fases

- **Fase 1** (MVP): config + conexion + importador manual con UI de mapeo
- **Fase 2**: cron sync cada 6h (config por proyecto) + webhook de pedidos WC → crea conversion en CRM
- **Fase 3** (backlog): bidireccional (crear producto en CRM → propaga a WC)

## Dependencias

- Requiere CRM-195 (categorias 5 niveles) antes de la fase 1
- Reusa `localStorage.service` o `r2.service` para brochures e imagenes
- Afecta: `products` schema (nuevas columnas)

## AC

- [ ] Admin conecta tienda y ve productos WC listados
- [ ] Mapea campos con nombres custom
- [ ] Importa y los productos aparecen en `/products` del CRM con brochure descargable, stripe link, imagen, precio, categoria
- [ ] Re-import actualiza (no duplica)
- [ ] Variaciones en mismo producto
