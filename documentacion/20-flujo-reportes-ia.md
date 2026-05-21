# 20. Reportes con Claude AI (Fase 2/3 - PENDIENTE)

## Concepto

Al inicio de cada mes, el sistema genera automaticamente un reporte mensual por proyecto con datos del mes anterior. Claude recibe JSON estructurado y devuelve markdown con analisis accionable.

## Flujo de generacion automatica

```mermaid
sequenceDiagram
    autonumber
    participant CR as Cron<br/>dia 1 de cada mes
    participant S as report.service
    participant C as Claude API
    participant DB as DB
    participant R2 as R2 (exports PDF)

    CR->>S: generateMonthlyReports()

    loop Por cada proyecto activo
        S->>DB: Agrega datos del mes anterior<br/>- leads captados<br/>- conversiones<br/>- ingresos CRM<br/>- gasto Meta/Google<br/>- trafico organico GSC<br/>- ingresos IA (Stripe)

        DB-->>S: JSON con toda la info

        S->>S: Construye prompt:<br/>system: "Eres analista de marketing..."<br/>user: JSON datos + "Genera reporte mensual"

        S->>C: messages.create<br/>model: claude-sonnet-4-5<br/>max_tokens: 4000

        C-->>S: response.content (markdown)

        S->>DB: INSERT reports<br/>(project_id, periodo, contenido_md, datos_fuente)
    end
```

## Estructura del JSON enviado a Claude

```json
{
  "proyecto": "Psiko Aprende",
  "periodo": "2026-03",
  "leads_total": 148,
  "conversiones": 23,
  "tasa_conversion": 15.5,
  "ingresos_crm": 18400,
  "gasto_meta": 2100,
  "gasto_google": 980,
  "trafico_organico_gsc": {
    "clics": 3420,
    "impresiones": 52100,
    "posicion_media": 4.2,
    "ctr": 6.6
  },
  "campanas": [
    {
      "nombre": "psiko-master-marzo",
      "gasto": 890,
      "leads_meta": 45,
      "leads_crm": 38,
      "conversiones": 8,
      "cpa_real": 111.25
    }
  ],
  "leads_por_canal": {
    "meta": 89,
    "google": 34,
    "organico": 25
  },
  "comparacion_mes_anterior": {
    "leads_delta_pct": 12.5,
    "conversion_delta_pct": -3.2,
    "ingresos_delta_pct": 8.7
  }
}
```

## Estructura del reporte que Claude devuelve

```markdown
# Reporte Mensual - Psiko Aprende - Marzo 2026

## Resumen Ejecutivo
- 148 leads captados (+12.5% vs febrero)
- 23 conversiones con 15.5% de tasa (ligero bajon del 3.2%)
- Ingresos netos de 18,400 EUR (+8.7%)

## Rendimiento por Canal
### Meta Ads
Inversion 2,100 EUR generando 89 leads (CPA promedio 23.6 EUR).
La campana "psiko-master-marzo" fue la mas eficiente...

### Google Ads
...

### Organico (GSC)
Trafico organico crecio 18% con posicion media mejorando de 4.8 a 4.2.
Keywords que convierten mejor: "master psicologia", "formacion clinica"...

## Campanas destacadas
### Mejor ROI: psiko-master-marzo
- CPA real: 111.25 EUR
- 8 conversiones a 2,500 EUR cada una
- ROAS 180%

### Peor ROI: psiko-intro-general
- 0 conversiones en 45 dias
- Recomendacion: pausar y redirigir presupuesto

## Recomendaciones
1. Aumentar inversion en Meta campana master (mejor ROAS)
2. Optimizar landing Google (CTR bajo vs promedio)
3. Crear contenido SEO para keywords emergentes...

## Efecto halo detectado
Durante la campana Meta del 15-25 marzo, el trafico organico subio un 34% para keywords relacionadas. Considerar mantener ambos activos.
```

## Chat conversacional (Fase 3)

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuario
    participant F as Frontend (chat panel)
    participant A as API
    participant CB as context.builder
    participant C as Claude API
    participant DB as DB

    U->>F: "Que campana de Fono tuvo mejor CPL en Q1?"
    F->>A: POST /api/chat/stream<br/>{message, project_id, history}

    A->>A: Rate limit check<br/>(20 msg/hora/user)

    A->>CB: buildContext(project_id, query)
    CB->>DB: Agrega datos relevantes<br/>- campanas Q1<br/>- leads por campana<br/>- costos
    DB-->>CB: datos
    CB-->>A: context JSON resumido

    A->>C: messages.create<br/>stream: true<br/>system: context + instrucciones<br/>messages: history + user_msg

    loop Por cada chunk
        C-->>A: chunk (SSE)
        A-->>F: SSE event
        F->>F: Appende al mensaje
    end

    F->>U: Respuesta completa<br/>"La campana fono-logopedia-ene fue la mejor<br/>con CPL de 18.50 EUR..."
```

## Export PDF

```mermaid
flowchart LR
    R[Reporte markdown en DB]
    R --> B[Boton 'Export PDF']
    B --> API[POST /api/reports/:id/pdf]
    API --> PUP[Puppeteer<br/>renderiza MD -> HTML -> PDF]
    PUP --> UP[Upload a R2]
    UP --> URL[Pre-signed URL]
    URL --> DL[Download en navegador]
```

## Sugerencias proactivas

Claude detecta patrones sin que se le pregunte:

```mermaid
flowchart TD
    DATA[Agrega datos mes] --> PAT[Detecta patrones:<br/>- campana sin conversion > 3 sem<br/>- keyword subiendo rapido<br/>- drop CPA en competidor]
    PAT --> ALERT[Genera alerta<br/>en el reporte]
    ALERT --> NOTIF[Notificacion in-app<br/>'Claude detecto algo importante']
```

## ERD

```mermaid
erDiagram
    projects ||--o{ reports : "genera"

    reports {
        int id PK
        int project_id FK
        string periodo "YYYY-MM"
        text contenido_md
        jsonb datos_fuente
        timestamp created_at
        string pdf_s3_key
    }
```

## Seguridad

- API key Claude encriptada en `api_credentials` (AES-256)
- Claude API expone logs con metadata (sin PII del lead)
- Rate limit: 20 mensajes/hora/user (Fase 3 chat)
- Reportes se pueden ver solo por users con acceso al proyecto

## Estado actual

**TODO PENDIENTE.**

- Fase 2: reportes mensuales automaticos (CRM-111, CRM-112, CRM-113)
- Fase 3: chat conversacional streaming (CRM-118, CRM-119)
- Fase 3: export PDF (CRM-120, CRM-121)
