---
name: pending-diplomados-recibos
description: "Pendiente futuro - usar productos importados (modulos_texto, profesores_texto, faqs_texto, meta_box) para armar diplomados y recibos de finalización"
metadata: 
  node_type: memory
  type: project
  originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---

Anotado por el usuario el 2026-05-12: cuando ya tengamos los productos importados con todos sus campos ricos (modulos_texto, profesores_texto, faqs_texto, meta_box con duración/horas/num_modulos/modalidad), usaremos esa data para:

- **Armar diplomados / certificados PDF** al cerrar una matrícula. El diplomado mostrará: título del curso, módulos cursados, horas totales, profesorado, duración, modalidad. Toda esa info ya está disponible en `products.*_texto` tras el import con scraper.

- **Recibos / facturas de matrícula** que listan qué incluye el curso (módulos + profesores + horas). Idem: leen de los campos `_texto` ya importados.

**Why:** El usuario diseñó el pipeline así (importer → CRM enriquecido → documentos PDF) para que cuando el equipo emita certificados no tenga que copiar contenido a mano desde la web.

**How to apply:** Cuando lleguemos a este tema, mirar el módulo `documents/` del backend (ya existe con `certificate.template.js`). Habrá que extender los templates para que lean `products.modulos_texto`, `products.profesores_texto`, `products.horas`, `products.num_modulos`, `products.duracion`, `products.modalidad` y los rendericen en el PDF (puppeteer/pdfkit). Probablemente añadir un selector "tomar info del curso" en el diálogo de generar documento.

Relacionado: [[importer-wc-scraper]] (donde se generan estos campos)
