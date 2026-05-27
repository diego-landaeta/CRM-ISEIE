---
name: Docs por feature en Claude/features/
description: Cada feature se documenta en su propio .md para que sea modular y agarrable por separado; crear solo cuando se retoma para implementar
type: feedback
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
Usuario confirmo en sesion 2026-04-24 que la estructura `Claude/features/` es para **modularidad**: cada feature tiene su propio `.md` autocontenido.

**Objetivo:** si el usuario mañana solo quiere implementar la feature A o B, el archivo de esa feature le da todo sin necesidad de leer los otros. Las dependencias entre features estan documentadas explicitamente en cada una.

**Regla:** NO generar archivos feature "placeholder" por adelantado. Crear el `.md` de una feature SOLO cuando esa feature se retoma para implementar. Evita docs muertos que no reflejan la realidad.

**Ciclo de vida de un feature .md:**
1. Se crea cuando se retoma (plan + modelo + endpoints + UI)
2. Se actualiza durante la implementacion con decisiones reales, desvios, gotchas, refs a commits
3. Se marca ✅ al terminar + en el README indice de features

**Dependencias cross-feature:** cada .md tiene seccion `## Dependencias` explicita con referencias tipo "prerequisito CRM-178", "reusa localStorage.service de la feature X", "afecta schema products".

**Why:** el usuario planea duplicar el CRM en varios servers con distintos feature sets (CRM-197). Necesita poder extraer una feature concreta con todo su contexto, incluyendo sus conexiones con otras features.

**How to apply:** al arrancar trabajo en una feature nueva, crear su .md en `Claude/features/` siguiendo `TEMPLATE.md`, y añadirla al README. NO crear archivos vacios "por si acaso".
