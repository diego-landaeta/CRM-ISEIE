# Avatar de usuario (foto de perfil)

**Jira:** CRM-186
**Estado:** ✅ Implementado
**Tipo:** Feature

## Contexto

Cada usuario (todos los roles) puede subir su foto de perfil. Aparece en el sidebar y en su pagina /profile. Reusa el patron de localStorage (CRM-182 logos).

## Implementacion

### Backend

**Migracion 014:**
```sql
ALTER TABLE users
  ADD COLUMN avatar_url VARCHAR(500),
  ADD COLUMN avatar_key VARCHAR(500);
```

**Endpoints:**
- `POST /api/users/:id/avatar` (auth + multipart) — usuario solo modifica el suyo, salvo superadmin
- `DELETE /api/users/:id/avatar` (mismas reglas)
- `GET /api/users/:id/avatar` — publico (sin auth, para `<img>`)

**Storage:** `/var/crm-uploads/avatars/user-{id}-{random}.{ext}` via `localStorage.service`.

**Cambios en otros modulos:**
- `auth.model.findUserByEmail` y `findUserById` añaden `avatar_url` al SELECT
- `auth.service.login` y `auth.controller.me` incluyen `avatar_url` en user devuelto
- `users.model.update` acepta `avatar_url` y `avatar_key`
- `users.model.findById` y `findAll` incluyen `avatar_url`/`avatar_key`

### Frontend

**ProfilePage:**
- Avatar 80x80 con overlay "Cambiar/Subir foto" en hover
- Input file oculto, click en overlay abre picker
- Upload con FormData a POST /api/users/:id/avatar
- Boton "Eliminar foto" si hay avatar
- Tras upload exitoso: `refreshUser()` actualiza el AuthContext

**Sidebar:**
- Si hay `user.avatar_url`: muestra `<img>` redondo en vez de iniciales
- Click sigue navegando a /profile

**AuthContext:**
- Nuevo metodo `refreshUser()` exportado, hace GET /auth/me y actualiza state

## Validaciones

- Formatos: PNG, JPG, JPEG, WEBP (validados por mimetype + magic bytes)
- Tamaño max 2 MB (frontend) / 5 MB (backend, configurado en `uploadImage`)
- Solo el propio usuario o superadmin pueden modificar

## QA

- ✅ Manuel sube avatar → 200, devuelve avatar_url
- ✅ GET publico /api/users/1/avatar → HTTP 200 con bytes
- ✅ Laura intenta avatar de Manuel → 403 "Solo puedes editar tu propio avatar"
- ✅ Sidebar y ProfilePage muestran la foto

## Commits

- `(siguiente commit)` feat(CRM-186): avatar usuario
