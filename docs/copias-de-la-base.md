# Copias de la base, purga y rotación de logs (#634 · CRM-ISEIE#361)

Lo que encontró la auditoría del 03/11/2026, en los dos servidores:

- **Copias de la base.** Solo existían las que se hacían a mano antes de cada versión, en el mismo disco.
- **Volcados.** Cualquier usuario del sistema los podía leer y borrar; en el 360, la carpeta estaba en 777.
- **Disco del 360 al 88 %.** Había 8 GB de `.tgz` de despliegues y los logs de PM2 sin rotar.

Esta guía instala tres cosas: la copia diaria, la purga de los `.tgz` y la rotación de los logs. Lo instala quien tiene acceso al VPS (Diego), y el orden importa: **primero las copias y después la purga.**

| | 360 | ISEIE (VPS compartido) |
|---|---|---|
| Bases | `crm_prod_db crm_test_db` | `crm_iseie crm_iseie_staging` |
| Destino fuera del VPS | `r2-copias:crm-copias/360` | `r2-copias:crm-copias/iseie` |
| Logs de PM2 | `pm2-logrotate` (el PM2 es del usuario `claude` y solo lleva el CRM) | `logrotate` solo para los logs del CRM, porque ese PM2 lleva también apps de terceros |

## 1. Copia diaria de la base

El script es `scripts/servidor/copia-base.sh`. Por cada base hace un `pg_dump -Fc`, lo comprueba con `pg_restore --list`, lo deja en una carpeta 700 con ficheros 600, lo sube fuera del VPS y borra las copias de más de 14 días. **Si el volcado de hoy falla, no borra ninguna copia anterior.**

Se instala fuera de la carpeta del código, para que un despliegue no lo cambie sin querer:

```bash
sudo install -o root -g root -m 755 scripts/servidor/copia-base.sh /usr/local/sbin/crm-copia-base
sudo install -d -o postgres -g postgres -m 700 /var/backups/crm/base
sudo install -o postgres -g postgres -m 600 /dev/null /var/log/crm-copias.log
```

En **ISEIE** la carpeta es `/var/backups/crm-iseie/base` (en vez de `/var/backups/crm/base`), aquí y en los comandos de abajo.

El cron va en un fichero propio, `/etc/cron.d/crm-copias`. **Nunca con `crontab -`**, que sustituye el crontab entero del usuario; en el VPS de ISEIE ese crontab lleva tareas de otras apps. Para el 360:

```cron
COPIAS_BASES="crm_prod_db crm_test_db"
COPIAS_REMOTO="r2-copias:crm-copias/360"
# 03:15 de Madrid: lejos del resumen diario (21:31-22:00) y con poco uso.
CRON_TZ=Europe/Madrid
15 3 * * * postgres flock -n /tmp/crm-copias.lock /usr/local/sbin/crm-copia-base >> /var/log/crm-copias.log 2>&1
```

`flock -n` impide que dos copias se solapen si una se alarga.

En ISEIE, las tres primeras líneas son:

```cron
COPIAS_BASES="crm_iseie crm_iseie_staging"
COPIAS_DIR="/var/backups/crm-iseie/base"
COPIAS_REMOTO="r2-copias:crm-copias/iseie"
```

(ISEIE tenía `scripts/backup-db.sh`, que solo copiaba `crm_iseie`, dejaba los volcados legibles por cualquiera y se instalaba con `crontab -`. Ahora delega en `scripts/servidor/copia-base.sh`.)

**La primera vez, a mano**, para ver que sale bien antes de esperar al cron:

```bash
sudo -u postgres env COPIAS_BASES="crm_prod_db crm_test_db" /usr/local/sbin/crm-copia-base
ls -l /var/backups/crm/base        # un .dump por base, -rw------- postgres
```

### Copia fuera del VPS (R2)

Sin `COPIAS_REMOTO` el script hace la copia en local y lo avisa en el registro. Para sacarla fuera:

1. **Bucket.** En Cloudflare R2, crear el bucket privado `crm-copias` y un token de API con permiso de **lectura y escritura solo para ese bucket**. Mejor que sea un token propio para las copias y no el que usa la app.
2. **rclone.** `sudo apt install rclone` y configurarlo **como `postgres`** con `sudo -u postgres rclone config`: un remoto de tipo `s3`, proveedor `Cloudflare`, llamado `r2-copias`, con el endpoint `https://<cuenta>.r2.cloudflarestorage.com`. La clave queda en `~postgres/.config/rclone/rclone.conf`, con permisos 600, y no va al repo ni a ninguna issue.
3. **Prueba.** `sudo -u postgres rclone lsd r2-copias:`, y lanzar la copia a mano con `COPIAS_REMOTO=...`.

### Restaurar (y probar que se puede)

Una copia que nunca se ha restaurado no está comprobada. Una vez al mes, y siempre antes de fiarse de ella, se restaura en una base desechable:

```bash
sudo -u postgres createdb crm_prueba_restaurar
sudo -u postgres pg_restore --no-owner -d crm_prueba_restaurar /var/backups/crm/base/crm_prod_db-AAAAMMDD-HHMMSS.dump
sudo -u postgres psql -d crm_prueba_restaurar -Atc "select count(*) from leads"   # cuadra con producción
sudo -u postgres dropdb crm_prueba_restaurar
```

Para recuperar de verdad, el orden es: parar la API (`pm2 stop <proceso>`), restaurar en una base nueva, cambiar `DATABASE_URL` a esa base y arrancar de nuevo. **No se restaura encima de la base en uso.** Después, `scripts/dar-propiedad-a-crm-user.sql`.

### Los volcados que ya estaban

```bash
sudo find /var/backups/crm -maxdepth 2 -type d -exec chmod 700 {} +
sudo find /var/backups/crm -maxdepth 2 -type f \( -name '*.dump' -o -name '*.sql*' \) -exec chmod 600 {} +
```

## 2. Purga de las copias del backend

`scripts/servidor/purgar-copias-backend.sh` borra los `.tgz` y `.tar.gz` de más de 30 días y **siempre conserva los 5 más recientes**. No toca los `.dump`. Sin `--si` solo simula:

```bash
sudo ./scripts/servidor/purgar-copias-backend.sh /var/backups/crm          # en ISEIE: /var/backups/crm-iseie
sudo ./scripts/servidor/purgar-copias-backend.sh /var/backups/crm --si     # lo borra
```

(Si las copias del backend están en otra carpeta, se le pasa esa.) Se puede dejar en el cron mensual, por ejemplo con `0 4 1 * * root /opt/crm/production/scripts/servidor/purgar-copias-backend.sh /var/backups/crm --si`.

## 3. Rotación de los logs

**360** (el PM2 es del usuario `claude` y solo lleva el CRM):

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 save
```

**ISEIE** (VPS compartido). `pm2-logrotate` es global al PM2 de root y rotaría también los logs de las otras apps, así que aquí se usa `logrotate` **solo para los ficheros del CRM**, en `/etc/logrotate.d/crm-iseie`:

```text
/root/.pm2/logs/crm-iseie-api-*.log /root/.pm2/logs/crm-iseie-api-staging-*.log {
    daily
    maxsize 20M
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

Se comprueba con `sudo logrotate -d /etc/logrotate.d/crm-iseie`, que es una simulación. `copytruncate` es necesario porque PM2 mantiene el fichero abierto y no hace falta reiniciar nada.

## Comprobación final

- [ ] Al día siguiente: `tail /var/log/crm-copias.log` muestra un `OK` por base y la subida a R2.
- [ ] `ls -ld /var/backups/crm/base` es `drwx------ postgres`.
- [ ] Una restauración de prueba cuadra con producción.
- [ ] `df -h /` del 360 ha bajado tras la purga.
