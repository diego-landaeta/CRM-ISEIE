# Seed demo — datos realistas Psiko + Psicologo IA

**Jira:** CRM-193
**Estado:** ✅ Implementado
**Tipo:** Chore / Testing data

## Contexto

Tras el reset DB de CRM-187, ambos proyectos quedaron vacios. Para probar features de forma realista (reportes, comisiones, cuentas por cobrar, pipeline) hace falta data representativa.

## Archivo

`backend/seeds/beta_demo.sql` — idempotente (TRUNCATE previo de tablas transaccionales, mantiene users y projects).

## Data generada

### Psiko Aprende (project_id=1, CRM)
- **3 categorias + 4 subcategorias** (Formaciones Online, Talleres Presenciales, Masters → Cursos Cortos, Programas Largos, Fin de semana, Intensivos)
- **6 productos/formaciones**: Master Neuro (1200€), Curso Psicologia Infantil (299€), Taller Mindfulness (89€), Programa Coaching (850€), Taller Neuro Docentes (150€), Curso Gestion del Aula (180€). Todos con stripe_link, sku, duracion, url_info
- **12 leads** en todos los estados: 5 convertidos, 2 en_seguimiento, 2 contactado, 1 por_contactar, 1 nuevo, 1 no_interesado
- **UTMs realistas** en 6 leads (google/facebook/instagram cpc y organic)
- **6 commission rules** (Laura + Carlos en distintos productos con 10-20%)
- **5 conversions**: 2 pagadas completas, 2 parciales (50%), 1 fraccionada
- **5 commissions** generadas, 2 marcadas como pagadas
- **5 egresos** (alquiler, software, publicidad, proveedores, servicios)
- **2 cuentas por pagar** con 1 parcial (Mailchimp pendiente, Imprenta parcial con payment)

### Psicologo IA (project_id=4, IA)
- **3 planes** (Basico 9.90€, Premium 29.90€, Anual 299€) con stripe_link
- **6 leads** todos convertidos (usuarios suscritos)
- **6 conversions** con pagos completos (suscripciones)
- **3 egresos** (OpenAI API, hosting, dominio)

## Ejecucion

```bash
scp backend/seeds/beta_demo.sql root@187.124.128.126:/tmp/
ssh root@187.124.128.126 "sudo -u postgres psql -d crm_test_db -f /tmp/beta_demo.sql"
```

## Totales resultantes

| Tabla | n |
|---|---|
| projects | 2 |
| product_categories | 7 |
| products | 9 |
| leads | 18 |
| lead_utms | 6 |
| conversions | 11 |
| conversion_payments | 11 |
| commission_rules | 6 |
| commissions | 5 |
| expenses | 8 |
| accounts_payable | 2 |
| accounts_payable_payments | 1 |

## AC

- [x] Psiko tiene flujo completo: leads → conversion → comisiones → egresos → AP
- [x] Psicologo IA tiene suscripciones simples como modelo alternativo (sin pipeline)
- [x] Script idempotente (TRUNCATE previo)
- [x] Datos realistas (nombres, importes plausibles, UTMs reales)

## Notas

- UTMs van en `lead_utms` (tabla separada), no en `leads.canal`
- Commissions de las conversions de Psiko se generan con SELECT...JOIN para respetar las reglas reales
- Las 2 primeras commissions (Maria Garcia + Juan Perez) estan marcadas pagadas para probar el estado pagado
