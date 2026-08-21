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

## Media pantalla: lo que se ve pero no funciona

Son las peores, porque **nadie las reporta como error**: se usan, parece que van,
y no hacen nada. Todas comparten la misma causa — el frontal guarda en el
navegador de cada persona porque el backend no existe.

```mermaid
flowchart LR
  subgraph S["Soporte"]
    S1["La gestora abre un ticket"] --> S2["Se guarda en SU navegador"]
    S2 --> S3["No le llega a nadie<br/>ni sale un correo"]
  end
  subgraph W["Plantillas de WhatsApp"]
    W1["Escribe una plantilla"] --> W2["Solo la ve ella"]
    W2 --> W3["Nadie puede revisarlas<br/>ni compartirlas"]
  end

  classDef ve fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef roto fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  class S1,S2,W1,W2 ve
  class S3,W3 roto
```

**Soporte** tiene 836 líneas de pantalla —formulario, lanzador, listado— y
**ningún módulo en el backend**. Su propio código lo dice: «cuando exista
`/api/tickets`…». Falta: tabla, endpoints, envío por Brevo al correo de destino,
adjuntos, y las métricas de cuánto se tarda en responder y en cerrar.

Las **plantillas de WhatsApp** ya están resueltas en la migración 122, pero esa
migración **no se ha aplicado en producción** porque WhatsApp está en espera.

---

## Automatismos de correo · nada de esto existe

Hay siete tareas programadas —Meta, Stripe, WooCommerce, secuencias,
recordatorios…— pero **ninguna de aviso interno**:

| Qué | A quién | Cuándo |
|---|---|---|
| Resumen del día | Gestora y administración | Al cerrar el día |
| Resumen semanal | Dirección | Lunes |
| Aviso de lead sin contactar | Gestora | A los 30 minutos |
| Plan de mañana | Gestora | Por la noche |

Se apoyan en Brevo, que ya está montado en los dos CRMs.

---

## Lo que quedó a medias

| Qué | Estado real |
|---|---|
| **Filtros en Clientes y Matrículas** | Prospectos guarda sus filtros en la URL; Clientes y Matrículas **no tienen ninguno**. Hay que replicar el juego entero |
| **Proformas: asociar a una venta ya creada** | Se puede elegir al emitir; falta el botón para las que ya existen |
| **Menú de Finanzas** | Plan aprobado y sin ejecutar: fusionar Ventas e Ingresos, y Conversiones como pestaña de Análisis |
| **Documento al convertir** | En pruebas de ISEIE; falta validarlo y subirlo a producción en los dos |
| **Modo BETA de ISEIE** | Aplicar el mismo corte al menú cuando se conecte WordPress |
| **Certificados de matrícula** | Usar los textos importados de los productos (módulos, profesores, horas) para el PDF |

---

## La cola larga

Medido, anotado y sin urgencia:

| Qué | Cuánto |
|---|---|
| Cargos de Stripe de 2026 sin enlazar | 501 · 152.098 € |
| Más cargos enlazables por importe y fecha | 241 |
| Teléfonos que `normalizePhone` estropea | 188 |
| Leads de CETLAT con su programa sin cruzar | 382 |
| Segundas cuotas registradas como venta nueva | por barrer |
| Proformas de ICTESS que consumen número de serie | por revisar |
| Tests que fallan por datos de ejemplo | 10 de 180 |
| Carlos no entra desde su WiFi fija | probar por IP directa |

---

## Por dónde seguir

Ordenado por lo que más duele, no por lo que más cuesta:

```mermaid
flowchart TB
  A["1 · Repositorios en privado<br/>y rotar las claves"] --> B["2 · Soporte de verdad<br/>hoy los tickets no le llegan a nadie"]
  B --> C["3 · Tutores: encender el cálculo<br/>y poder liquidar"]
  C --> D["4 · Tasa de cierre en pantalla<br/>y el baremo de Carlos"]
  D --> E["5 · Avisos por correo<br/>resumen del día y SLA"]
  E --> F["6 · Filtros en Clientes<br/>y lo que quedó a medias"]

  classDef urge fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pronto fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef luego fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  class A,B urge
  class C,D pronto
  class E,F luego
```

**Por qué en ese orden.** Lo primero no es negociable y no es código. Lo segundo
es lo único que hoy **engaña a quien lo usa**: una gestora escribe un ticket,
ve que se guarda, y no llega a ningún sitio. Lo tercero mueve dinero. Lo demás
mejora, pero nada de lo que hay hoy miente.

---

## Documentos relacionados

- [`tutores-pendiente.md`](tutores-pendiente.md) — el detalle del módulo
- [`tarea-stripe-proyectos-ia.md`](tarea-stripe-proyectos-ia.md) — la tarea de Ángel
- [`PARIDAD-ENTRE-CRMS.md`](PARIDAD-ENTRE-CRMS.md) — qué se copia y qué no

---

## Dónde nos quedamos · 21 de agosto, noche

**En producción, funcionando:** WhatsApp unificado con el panel del admin,
historial de ventas del tutor, rutas en español con redirección, el menú nuevo,
los profesores de Psiko dados de alta con sus comisiones de agosto, y tres
ventas duplicadas de ISEIE cuadradas.

**En pruebas, esperando visto bueno:** el trabajo de Fabián (#31) y el de Ángel
(#45), fusionados sin conflictos. `/testeo` tiene además su propio WhatsApp, con
sesiones `testeo-uN` que no pueden tocar las de producción.

**Esperando a Diego:**
- Las migraciones **129 y 130** en producción. Aplicadas solo en pruebas.
- Las peticiones de cambios **#51** (Ángel) y **#52** (nuestra) contra `main`.
- Qué se hace con `main`, que en MultiCRM quedó adelantada y en ISEIE no.

**Corrige Ángel, no nosotros** — todo anotado en la #45: el aviso que nombra
variables de entorno, el recorrido que llega tarde y no salta pasos, la imagen
que se manda sin vista previa, la nota de voz sin aviso de envío y con la
duración equivocada.

**Lo nuestro, por orden:** recuperar contraseña (#37), Soporte de verdad (#38),
tasa de cierre de Carlos (#39), filtros en Clientes (#40) y la limpieza de datos
(#41, #42).

---

<!-- INDICE-TAREAS -->

## Todas las tareas abiertas

Sacado de GitHub, no escrito a mano: **50 abiertas**. Para volver a
generarlo, `scripts/indice_tareas.py`.

### Fase 1 · Desbloquear · 5

| | Qué | Quién | |
|---|---|---|---|
| [#20](https://github.com/diego-landaeta/CRM/issues/20) | Mandar el origen del lead desde Make | Diego | **bloquea a otros** |
| [#21](https://github.com/diego-landaeta/CRM/issues/21) | Aplicar la migración 122 (plantillas de WhatsApp) | Diego | **bloquea a otros** · lleva SQL |
| [#22](https://github.com/diego-landaeta/CRM/issues/22) | Clave de IA y tope de gasto | Diego | **bloquea a otros** |
| [#23](https://github.com/diego-landaeta/CRM/issues/23) | Usuario del CRM de pruebas para Fabián | Diego | **bloquea a otros** |
| [#24](https://github.com/diego-landaeta/CRM/issues/24) | Decidir qué pasa con main | Diego |  |

### Fase 2 · Construir · 20

| | Qué | Quién | |
|---|---|---|---|
| [#25](https://github.com/diego-landaeta/CRM/issues/25) | WhatsApp · plantillas compartidas y registro del contacto | Ángel |  |
| [#26](https://github.com/diego-landaeta/CRM/issues/26) | Página de estado del sistema | Ángel |  |
| [#27](https://github.com/diego-landaeta/CRM/issues/27) | El envío de correo del CRM · la tubería | Ángel |  |
| [#28](https://github.com/diego-landaeta/CRM/issues/28) | Recordatorios por correo | Ángel |  |
| [#29](https://github.com/diego-landaeta/CRM/issues/29) | Reporte semanal por correo | Ángel |  |
| [#30](https://github.com/diego-landaeta/CRM/issues/30) | Análisis de datos con IA | Ángel |  |
| [#31](https://github.com/diego-landaeta/CRM/issues/31) | Terminar la administración de usuarios | Fabián |  |
| [#32](https://github.com/diego-landaeta/CRM/issues/32) | Rediseño · tokens y primitivas | Fabián |  |
| [#33](https://github.com/diego-landaeta/CRM/issues/33) | Rediseño · el marco: menú, cabecera y estructura | Fabián |  |
| [#34](https://github.com/diego-landaeta/CRM/issues/34) | Rediseño · las 82 pantallas, por bloques | Fabián |  |
| [#35](https://github.com/diego-landaeta/CRM/issues/35) | Proceso de ventas editable | Diego | lleva SQL |
| [#36](https://github.com/diego-landaeta/CRM/issues/36) | Search Console | Diego |  |
| [#37](https://github.com/diego-landaeta/CRM/issues/37) | Recuperar la contraseña por correo | Yo |  |
| [#38](https://github.com/diego-landaeta/CRM/issues/38) | Soporte de verdad | Yo | lleva SQL |
| [#39](https://github.com/diego-landaeta/CRM/issues/39) | Tasa de cierre y baremo · lo de Carlos | Yo |  |
| [#44](https://github.com/diego-landaeta/CRM/issues/44) | Sincronizar los proyectos de IA con el CRM · Ángel y Fabián | Ángel | compartida |
| [#45](https://github.com/diego-landaeta/CRM/issues/45) | WhatsApp · el aviso, el tutorial y pulir lo que falta | Ángel |  |
| [#47](https://github.com/diego-landaeta/CRM/issues/47) | WhatsApp · llamadas: registrarlas, y el manual | Ángel |  |
| [#48](https://github.com/diego-landaeta/CRM/issues/48) | Recibir el origen de los leads (ChatGPT incluido) y categorizarlo | Diego |  |
| [#50](https://github.com/diego-landaeta/CRM/issues/50) | Tipografía e iconos del apartado de administración (estilo formal) | Fabián |  |

### Fase 3 · Cerrar · 5

| | Qué | Quién | |
|---|---|---|---|
| [#40](https://github.com/diego-landaeta/CRM/issues/40) | Filtros en Clientes y Matrículas | Yo |  |
| [#41](https://github.com/diego-landaeta/CRM/issues/41) | Ventas sin formación identificada · 321 | Yo |  |
| [#42](https://github.com/diego-landaeta/CRM/issues/42) | Los otros datos que no cuadran | Yo |  |
| [#43](https://github.com/diego-landaeta/CRM/issues/43) | Lo que quedó a medias | Yo |  |
| [#49](https://github.com/diego-landaeta/CRM/issues/49) | Rutas en español, con redirección desde las viejas | Yo |  |

### Fase 4 · Medir · 5

| | Qué | Quién | |
|---|---|---|---|
| [#53](https://github.com/diego-landaeta/CRM/issues/53) | Meta Ads: del gasto a la venta, no al lead | Diego |  |
| [#54](https://github.com/diego-landaeta/CRM/issues/54) | Google Ads: traer campañas y gasto al CRM | Diego |  |
| [#55](https://github.com/diego-landaeta/CRM/issues/55) | Google Analytics: lo que pasa antes del lead | Diego |  |
| [#56](https://github.com/diego-landaeta/CRM/issues/56) | Panel de canales: dónde poner el dinero | Yo |  |
| [#57](https://github.com/diego-landaeta/CRM/issues/57) | Pedirle a Daniela sus reportes de publicidad y ventas | Diego |  |

### sin fase · 15

| | Qué | Quién | |
|---|---|---|---|
| [#2](https://github.com/diego-landaeta/CRM/issues/2) | Frontend: Dropdown categorías searchable + niveles separados cascade | molinangel |  |
| [#3](https://github.com/diego-landaeta/CRM/issues/3) | Frontend: Sidebar por secciones colapsables con persistencia | molinangel |  |
| [#4](https://github.com/diego-landaeta/CRM/issues/4) | Frontend: Documentos/Certificados — selectores de programa, alumno y módulos auto | molinangel |  |
| [#5](https://github.com/diego-landaeta/CRM/issues/5) | BUG: Dock flotante perdió el botón de Chat IA | molinangel |  |
| [#6](https://github.com/diego-landaeta/CRM/issues/6) | Frontend: Panel UI de conectores con preview + mapping visual | molinangel |  |
| [#7](https://github.com/diego-landaeta/CRM/issues/7) | Frontend: Sistema completo de vistas por rol (sidebar dinámico + landing por rol) | molinangel |  |
| [#8](https://github.com/diego-landaeta/CRM/issues/8) | Frontend: Settings — separar Categorías/Campos/Columnas por entidad (Leads/Clientes/Productos) | molinangel |  |
| [#9](https://github.com/diego-landaeta/CRM/issues/9) | Frontend: Pipeline Kanban arrastrable en /leads | molinangel |  |
| [#10](https://github.com/diego-landaeta/CRM/issues/10) | Frontend: Settings — completar TODOS los paneles faltantes | molinangel |  |
| [#11](https://github.com/diego-landaeta/CRM/issues/11) | Frontend: Panel 'próximo gestor' en /leads — visualizar round-robin | molinangel |  |
| [#12](https://github.com/diego-landaeta/CRM/issues/12) | Frontend: LeadDrawer popup mejorado + enrolar en secuencia desde lista | molinangel |  |
| [#13](https://github.com/diego-landaeta/CRM/issues/13) | Backend: Activity feed (tabla + endpoint para 'qué pasó hoy') | esos2dev-oss |  |
| [#14](https://github.com/diego-landaeta/CRM/issues/14) | Backend: WooCommerce orders sync + cron flexible (manual/diario/semanal) | esos2dev-oss |  |
| [#15](https://github.com/diego-landaeta/CRM/issues/15) | Backend: Project types extension (educacion/ecommerce/servicios/inmobiliaria) | esos2dev-oss |  |
| [#18](https://github.com/diego-landaeta/CRM/issues/18) | Frontend: Selector 'Webhook JSON / Mailhook email / Ambos' al crear webhook | molinangel |  |

> Las mismas tareas existen en el repositorio de ISEIE, bloqueadas con la
> etiqueta `espera-multicrm`: se hacen aquí primero y se replican cuando Diego
> las aprueba.

<!-- FIN-INDICE-TAREAS -->
