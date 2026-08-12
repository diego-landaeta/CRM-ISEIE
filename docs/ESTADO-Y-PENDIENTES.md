# Estado y pendientes

Al 12 de agosto de 2026. Los diagramas se dibujan solos en GitHub.

Dos CRMs con **paridad absoluta**: lo que se hace en uno se hace en el otro,
salvo la marca y las rutas.

| | MultiCRM | ISEIE |
|---|---|---|
| Producción | `360crm.tech/crm/` | `crm.iseie.com` |
| Pruebas | `360crm.tech/testeo/` | `crm.iseie.com/staging/` |
| Proyectos | 9 | 1 |

---

## Dónde está cada cosa

```mermaid
flowchart LR
  subgraph PROD["🟢 En producción · los dos CRMs"]
    direction TB
    P1["Tutores<br/>alta · cursos · simulación"]
    P2["Facturación<br/>series · proformas · cuotas"]
    P3["Prospectos · Ventas<br/>Clientes · Matrículas"]
    P4["Stripe<br/>cobros y asociación"]
    P5["Meta Ads<br/>sincronización cada 3 h"]
  end

  subgraph STAG["🟡 Solo en pruebas"]
    direction TB
    S1["WhatsApp<br/>salas · plantillas · equipo"]
    S2["Tasa de cierre<br/>una sola definición"]
    S3["Stripe: factura desde<br/>el alta del proyecto"]
  end

  subgraph FALTA["🔴 Sin construir"]
    direction TB
    F1["Cálculo real<br/>de comisiones"]
    F2["Liquidar<br/>marcar como pagadas"]
    F3["Reembolsos<br/>revertir comisión"]
    F4["Proceso comercial<br/>qué toca hoy"]
  end

  STAG -->|"validar y subir"| PROD
  FALTA -->|"construir"| STAG

  classDef verde fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef ambar fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef rojo fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  class P1,P2,P3,P4,P5 verde
  class S1,S2,S3 ambar
  class F1,F2,F3,F4 rojo
```

WhatsApp viaja en el mismo build que todo lo demás, pero **no se enseña en
producción**: `VITE_MODULOS_APAGADOS=whatsapp`. Se enciende quitando esa línea
y recompilando.

---

## Tutores · por qué todavía no paga

Está en producción y funciona, pero **es una simulación**. El dinero no existe
hasta que se cierre el camino entero:

```mermaid
flowchart TD
  A["Cobro de un alumno<br/>conversion_payments"] --> B{"¿La venta dice<br/>qué formación es?"}
  B -->|"no · 7 ventas con cobros de agosto"| X["No genera comisión<br/>y nadie se entera"]
  B -->|"sí"| C{"¿Hay un tutor<br/>en esa formación?"}
  C -->|"no"| X
  C -->|"sí"| D["Comisión = % × lo cobrado<br/>desde SU fecha de inicio"]
  D --> E["tutor_commissions"]
  E --> F["Liquidar: marcar pagada"]
  G["Reembolso en Stripe"] --> H["Revertir la comisión"]

  classDef hecho fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef falta fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef aviso fill:#fef3c7,stroke:#d97706,color:#78350f
  class A,B,C,D hecho
  class E,F,G,H falta
  class X aviso
```

**Verde** existe y está probado. **Rojo** no está escrito: `tutor_commissions`
es una tabla vacía en la que nadie escribe nunca, no hay forma de marcar una
comisión como pagada, y revertir por reembolso es imposible hoy porque
`conversion_refunds` no guarda a qué pago corresponde.

### Lo que hay que atar a mano

Como los tutores empiezan en agosto, **el histórico da igual**. Solo importan
las ventas que reciben cobros desde el 1 de agosto:

| | Ventas a atar | Dinero | De ellas, con nombre que casa con el catálogo |
|---|---|---|---|
| ISEIE | 6 | 1.347,34 € | 3 |
| MultiCRM | 1 | 133,33 € | 0 |

Las otras cuatro nombran cursos que **no existen en el catálogo**: «Apostilla de
la HAYA» (×2), «Máster trasplante capilar» y «Diplomado en Neurociencia
Aplicada». O se crean o se quedan fuera.

---

## Quién hace qué

```mermaid
flowchart TB
  subgraph D["Diego · decidir y probar"]
    D1["Probar tutores en producción"]
    D2["¿Daniela entra en el reparto<br/>de leads de Make?"]
    D3["Los 4 cursos que faltan<br/>en el catálogo"]
    D4["Rotar la contraseña de root<br/>estuvo en el historial de git"]
  end

  subgraph A["Ángel · rama feat/stripe-ia"]
    A1["Crear los proyectos IA"]
    A2["Su clave de Stripe,<br/>una por proyecto"]
    A3["El secreto del webhook<br/>hoy NINGUNO lo tiene"]
    A4["Comprobar que no entra<br/>nada anterior al alta"]
  end

  subgraph C["Claude · construir"]
    C1["Tasa de cierre en pantalla<br/>y su baremo"]
    C2["Cálculo real de comisiones"]
    C3["Liquidar y revertir"]
    C4["Proceso comercial de Carlos"]
  end

  A1 --> A2 --> A3 --> A4
  C1 --> C4
  D1 --> C2
  D3 --> C2
  C2 --> C3

  classDef diego fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef angel fill:#fce7f3,stroke:#db2777,color:#831843
  classDef claude fill:#ccfbf1,stroke:#0d9488,color:#134e4a
  class D1,D2,D3,D4 diego
  class A1,A2,A3,A4 angel
  class C1,C2,C3,C4 claude
```

---

## En qué orden, y qué depende de qué

```mermaid
flowchart LR
  T1["Probar tutores<br/>en producción"] --> T2["Atar las 7 ventas"]
  T2 --> T3["Encender el cálculo<br/>job de reconciliación"]
  T3 --> T4["Liquidar<br/>marcar pagadas"]
  T4 --> T5["Reembolsos"]

  B1["Tasa de cierre<br/>ya calculada"] --> B2["Ponerla en el panel<br/>y quitar la vieja"]
  B2 --> B3["¿De dónde sale?<br/>los sumandos pulsables"]
  B3 --> B4["Baremo<br/>sin puntuar el mes abierto"]
  B4 --> B5["Proceso comercial"]

  W1["Probar la sala<br/>30 mensajes · adjuntar"] --> W2{"¿La latencia<br/>es aceptable?"}
  W2 -->|"sí"| W3["Servidor propio<br/>y una sala por gestora"]
  W2 -->|"no"| W4["Se abandona<br/>y se vuelve a la ventana al lado"]

  classDef listo fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef curso fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef nuevo fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  class B1 listo
  class T1,W1 curso
  class T2,T3,T4,T5,B2,B3,B4,B5,W3,W4 nuevo
```

---

## Lo que muerde si no se mira

```mermaid
flowchart TD
  R1["El webhook de Stripe acepta<br/>eventos SIN comprobar la firma"] --> R1b["Ninguno de los 6 proyectos<br/>tiene webhook_secret.<br/>Quien sepa la URL puede<br/>inventarse un cobro"]
  R2["importe_pagado no cuadra<br/>con los cobros reales"] --> R2b["ISEIE declara 209.930 € de MÁS<br/>MultiCRM, 52.700 € de MENOS.<br/>Las comisiones de las gestoras<br/>salen de ese campo"]
  R3["Un tutor con sesión abierta<br/>puede pedir datos a la API"] --> R3b["El recorte es de pantalla.<br/>Las rutas de la API<br/>todavía no le niegan"]
  R4["Se puede asignar a un tutor<br/>un curso de OTRO proyecto"] --> R4b["No se valida.<br/>Salió al sembrar datos de prueba"]

  classDef riesgo fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef detalle fill:#fef2f2,stroke:#fca5a5,color:#7f1d1d
  class R1,R2,R3,R4 riesgo
  class R1b,R2b,R3b,R4b detalle
```

---

## La cola larga

Cosas medidas y anotadas, ninguna urgente:

| Qué | Cuánto |
|---|---|
| Cargos de Stripe de 2026 sin enlazar | 501 · 152.098 € |
| Más cargos enlazables por importe y fecha | 241 |
| Teléfonos que `normalizePhone` estropea | 188 |
| Leads de CETLAT con su programa sin cruzar | 382 |
| Segundas cuotas registradas como venta nueva | por barrer |
| Proformas de ICTESS que consumen número de serie | por revisar |
| Tests que fallan por datos de ejemplo | 10 de 180 |

---

## Documentos relacionados

- [`tutores-pendiente.md`](tutores-pendiente.md) — el detalle del módulo
- [`tarea-stripe-proyectos-ia.md`](tarea-stripe-proyectos-ia.md) — la tarea de Ángel
- [`PARIDAD-ENTRE-CRMS.md`](PARIDAD-ENTRE-CRMS.md) — qué se copia y qué no
