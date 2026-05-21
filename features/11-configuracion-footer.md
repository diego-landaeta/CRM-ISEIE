# Configuracion al footer del sidebar

**Jira:** CRM-190
**Estado:** ✅ Implementado
**Tipo:** UX

## Contexto

Configuracion no es un elemento de trabajo diario, estaba en la seccion principal del sidebar. Deberia estar al nivel del toggle Modo Oscuro en el footer (donde van cosas del usuario / sistema).

## Implementacion

- Removido `SYSTEM_ITEMS` array + renderizado del grupo "Sistema" en nav principal
- Añadido `NavLink` para `/settings` en el footer del sidebar, junto al theme toggle
- Solo visible para admin/superadmin

## Layout del footer actualizado

```
─── footer ───
[v0.1.0 FASE BETA]
[ ☾/☀ Modo oscuro ]
[ ⚙ Configuracion ]    ← nuevo aqui
[Avatar / Nombre / Logout]
```

## AC

- [x] Configuracion ya no aparece en nav principal
- [x] Aparece en footer junto a modo oscuro
- [x] Solo visible para admin/superadmin
- [x] Mantiene su active state cuando la URL es /settings

## Commits

- `24be4c4` feat(CRM-190/192): logo en project cards + Config al footer
