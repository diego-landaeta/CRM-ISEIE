# Limpiar las llaves del MCP de los registros de nginx (#237, desde #193 de MultiCRM)

Hasta que se aplique `nginx/crm-iseie-registro-seguro.conf`, nginx escribía en
`access.log` la URL personal del MCP con la llave dentro
(`/api/mcp/u/crm_mcp_…`). Esos registros siguen en el servidor, también los
comprimidos de días anteriores. Este documento dice cómo **ver qué llaves
salieron**, **taparlas** y **decidir qué llaves cambiar**.

Lo aplica Diego, que es quien tiene acceso al servidor. Los comandos son los de
MultiCRM, probados el 03/10 sobre registros reales de un nginx 1.27 en Docker.

**Este servidor lo comparten otras aplicaciones.** Los comandos solo cambian el
texto `crm_mcp_…`, que no sale en sus registros, así que no las tocan; aun así,
si el server de crm.iseie.com escribe en su propio fichero (mira su línea
`access_log`), basta con limpiar ese.

> Orden: **primero** aplicar `nginx/crm-iseie-registro-seguro.conf` (para que no se
> escriban más), **después** limpiar lo que ya hay.

## 1 · Qué llaves aparecen

Solo el principio de cada llave, que es lo que enseña el panel
(Conexión → MCP, columna «URL»). Así se pueden reconocer sin volver a copiar la
llave entera a otro sitio:

```bash
cd /var/log/nginx
sudo sh -c 'cat access.log* error.log* 2>/dev/null; zcat -f *.gz 2>/dev/null' \
  | grep -oE 'crm_mcp_[A-Za-z0-9_-]{4}' | sort | uniq -c
```

Cada línea es un prefijo y cuántas veces sale. Con ese prefijo se busca a quién
pertenece:

```sql
SELECT t.prefijo, u.nombre, u.email, t.nombre AS conexion, t.revoked_at
  FROM mcp_tokens t JOIN users u ON u.id = t.user_id
 WHERE t.prefijo IN ('crm_mcp_XXXX', 'crm_mcp_YYYY');   -- los de arriba
```

## 2 · Taparlas

Cambia cada llave por `crm_mcp_***` en los registros activos y en los
comprimidos, sin tocar nada más de cada línea:

```bash
cd /var/log/nginx

# Registros sin comprimir (access.log, access.log.1, error.log…)
for f in access.log* error.log*; do
  case "$f" in *.gz) continue ;; esac
  sudo sed -i -E 's/crm_mcp_[A-Za-z0-9_-]+/crm_mcp_***/g' "$f"
done

# Comprimidos de días anteriores (access.log.2.gz…)
for f in *.gz; do
  sudo sh -c "zcat '$f' | sed -E 's/crm_mcp_[A-Za-z0-9_-]+/crm_mcp_***/g' | gzip > '$f.tmp' && mv '$f.tmp' '$f'"
done

# `sed -i` crea un fichero nuevo y nginx seguiría escribiendo en el viejo:
# hay que decirle que reabra los registros.
sudo nginx -s reopen
```

Comprobar que no queda ninguna (debe salir `0`):

```bash
sudo sh -c 'cat access.log* error.log* 2>/dev/null; zcat -f *.gz 2>/dev/null' \
  | grep -oE 'crm_mcp_[A-Za-z0-9_-]+' | grep -vc 'crm_mcp_\*\*\*'
```

Si el servidor guarda copias de los registros en otro sitio (copias de
seguridad, un servicio de registros), hay que limpiarlas también, o la llave
sigue ahí.

## 3 · Cambiar las llaves que salieron

Tapar el registro no deshace que alguien lo haya leído antes. Quien tuvo acceso
a esos registros es solo quien administra el servidor, así que el riesgo es
bajo, pero lo seguro es **rotar** las llaves de la lista del paso 1:

1. La persona entra en el CRM → Conexión → MCP → **Crear mi URL personal**.
2. Cambia la URL en su Claude (Configuración → Conectores: borrar el conector
   viejo y agregar el nuevo con la URL nueva).
3. **Revoca** la URL antigua en la misma pantalla.

Si alguien no puede hacerlo, quien administra puede revocar la llave vieja
directamente; esa persona tendrá que crear otra para volver a conectar:

```sql
UPDATE mcp_tokens SET revoked_at = NOW()
 WHERE prefijo = 'crm_mcp_XXXX' AND revoked_at IS NULL;
```

## 4 · Cuánto duran los registros

`logrotate` de nginx guarda normalmente 14 días (`/etc/logrotate.d/nginx`,
`rotate 14`). Con el formato nuevo ya no hace falta acortarlo; lo que importa es
que las copias viejas se limpien una vez (paso 2).

## Lo que el formato nuevo no tapa

`error.log`: cuando nginx anota un error de una petición (por ejemplo, un 502
porque la API está caída), escribe la petición entera y eso no se puede cambiar
con `log_format`. Solo pasa con errores de nginx, no en el uso normal. Si se
cae la API, conviene repetir el paso 2 sobre `error.log`.
