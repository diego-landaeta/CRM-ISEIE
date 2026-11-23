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
| Logs de PM2 | `pm2-logrotate` | `logrotate` solo para los logs del CRM, porque ese PM2 lleva también apps de terceros |

## 1. Copia diaria de la base

El script es `scripts/servidor/copia-base.sh`. Copia tres tipos de fuente, cada una con su variable:

| Variable | Qué | Cómo | Fichero |
|---|---|---|---|
| `COPIAS_BASES` | bases del Postgres del VPS | `pg_dump -Fc` como `postgres`, comprobado con `pg_restore --list` | `<base>-AAAAMMDD-HHMMSS.dump` |
| `COPIAS_DOCKER_PG` | bases dentro de un contenedor (`contenedor:base`) | `pg_dump -Fc` dentro del contenedor, comprobado allí | `docker-<contenedor>-<base>-….dump` |
| `COPIAS_SQLITE` | ficheros SQLite (`nombre=/ruta`) | API de backup de SQLite en caliente (como `.backup`), comprimido, `integrity_check` | `sqlite-<nombre>-….sqlite.gz` |

Se ejecuta como **root** desde un timer de systemd: los ficheros quedan `root:root 600` en una carpeta `700`. Guarda las **7 últimas diarias y 4 semanales** de cada fuente (las semanales son enlaces duros: no ocupan el doble). **Si el volcado de hoy falla, no borra ninguna copia anterior**, el servicio queda en `failed` y salta el aviso. Si quedan menos de 2 GB libres, no copia y avisa. Las copias a mano («`crm_prod_db-antes-…`») no las toca nunca.

Se instala fuera de la carpeta del código, para que un despliegue no lo cambie sin querer:

```bash
sudo install -o root -g root -m 755 scripts/servidor/copia-base.sh   /usr/local/sbin/crm-copia-base
sudo install -o root -g root -m 755 scripts/servidor/copias-aviso.sh /usr/local/sbin/crm-copias-aviso
sudo install -d -o root -g root -m 700 /etc/crm-copias /var/backups/crm/base
sudo install -o root -g root -m 600 scripts/servidor/systemd/copias.env.example /etc/crm-copias/copias.env
sudo install -o root -g root -m 600 /dev/null /var/log/crm-copias.log
sudo install -o root -g root -m 644 scripts/servidor/systemd/crm-copias.service \
  scripts/servidor/systemd/crm-copias.timer scripts/servidor/systemd/crm-copias-aviso.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Se revisa `/etc/crm-copias/copias.env` (el ejemplo es el del 360). En **ISEIE**: `COPIAS_BASES="crm_iseie crm_iseie_staging"`, `COPIAS_DIR=/var/backups/crm-iseie/base` y se quitan las líneas de Docker y SQLite.

**La primera vez, a mano**, para ver que sale bien antes de encender el timer:

```bash
sudo systemctl start crm-copias          # tarda lo que tarde el pg_dump; no corta el servicio
systemctl status crm-copias --no-pager   # «status=0/SUCCESS»
tail -n 20 /var/log/crm-copias.log       # un OK por fuente
sudo ls -l /var/backups/crm/base /var/backups/crm/base/semanales   # -rw------- root root
sudo systemctl enable --now crm-copias.timer
systemctl list-timers crm-copias.timer   # la siguiente, a las 03:15 de Madrid
```

**Nunca con `crontab -`**, que sustituye el crontab entero del usuario. Si en algún VPS no se quiere systemd, la alternativa es un fichero propio en `/etc/cron.d/crm-copias`:

```cron
CRON_TZ=Europe/Madrid
15 3 * * * root bash -c 'set -a; . /etc/crm-copias/copias.env; set +a; umask 077; flock -n /run/crm-copias.lock /usr/local/sbin/crm-copia-base >> /var/log/crm-copias.log 2>&1 || /usr/local/sbin/crm-copias-aviso'
```

### Aviso si falla

`crm-copias-aviso.service` salta por `OnFailure=`. Siempre lo deja en el journal (`journalctl -p err -t crm-copias`). Para que además mande un correo con las últimas líneas del registro, se crea `/etc/crm-copias/aviso.env` (root 600) con `AVISO_BREVO_API_KEY`, `AVISO_PARA` y `AVISO_DE` (un remitente verificado en Brevo). Mejor una clave de Brevo propia para esto que la de la app. Se prueba con `sudo systemctl start crm-copias-aviso`.

`/var/backups/crm/base/ESTADO` guarda el resultado de la última vuelta (`… OK` o `… ERROR n fallo(s)`), para vigilarlo desde fuera si se quiere.

El registro se rota con `/etc/logrotate.d/crm-copias`:

```text
/var/log/crm-copias.log {
    monthly
    rotate 12
    compress
    missingok
    notifempty
    create 600 root root
}
```

### Copia fuera del VPS (R2)

Sin `COPIAS_REMOTO` el script hace la copia en local y lo avisa en el registro. **Mientras no haya copia fuera, un fallo del disco o del VPS se lleva también las copias.** Para sacarla fuera:

1. **Bucket.** En Cloudflare R2, crear el bucket privado `crm-copias` y un token de API con permiso de **lectura y escritura solo para ese bucket**. Mejor que sea un token propio para las copias y no el que usa la app.
2. **rclone.** `sudo apt install rclone` y configurarlo **como root** con `sudo rclone config`: un remoto de tipo `s3`, proveedor `Cloudflare`, llamado `r2-copias`, con el endpoint `https://<cuenta>.r2.cloudflarestorage.com`. La clave queda en `/root/.config/rclone/rclone.conf`, con permisos 600, y no va al repo ni a ninguna issue.
3. **Prueba.** `sudo rclone lsd r2-copias:`, poner `COPIAS_REMOTO=r2-copias:crm-copias/360` en `copias.env` y lanzar `sudo systemctl start crm-copias`. Las diarias van a la raíz y las semanales a `semanales/`.

### Restaurar (y probar que se puede)

Una copia que nunca se ha restaurado no está comprobada. Una vez al mes, y siempre antes de fiarse de ella, se restaura en una base desechable. Las copias son de root: se leen con `sudo cat` y se pasan por la entrada estándar.

```bash
F=/var/backups/crm/base/crm_prod_db-AAAAMMDD-HHMMSS.dump
sudo -u postgres createdb crm_prueba_restaurar
sudo cat "$F" | sudo -u postgres pg_restore --no-owner -d crm_prueba_restaurar
sudo -u postgres psql -d crm_prueba_restaurar -Atc "select count(*) from leads"   # cuadra con producción
sudo -u postgres dropdb crm_prueba_restaurar
```

- **Postgres en Docker:** `sudo cat <docker-….dump> | docker exec -i <contenedor> sh -c 'createdb -U "$POSTGRES_USER" prueba && pg_restore -U "$POSTGRES_USER" --no-owner -d prueba'`, y después `dropdb` de `prueba`.
- **SQLite:** `sudo gzip -dc <sqlite-….sqlite.gz> > /tmp/prueba.db` y abrirla; para recuperarla de verdad, con la app parada, se pone en su sitio con el dueño de la app (`chown <usuario>:<grupo>`).

Para recuperar de verdad el CRM, el orden es: parar la API (`pm2 stop <proceso>`), restaurar en una base nueva, cambiar `DATABASE_URL` a esa base y arrancar de nuevo. **No se restaura encima de la base en uso.** Después, `scripts/dar-propiedad-a-crm-user.sql`.

### Los volcados que ya estaban

La carpeta `/var/backups/crm` sigue recibiendo las copias a mano de antes de cada despliegue, que hace el usuario que ejecuta pm2. Por eso no pasa a `700 root`, sino a `2770` con el grupo de ese usuario (`<grupo-pm2>` abajo): solo entran root y él, y lo nuevo hereda el grupo. Los ficheros, a `600`.

```bash
sudo chown root:<grupo-pm2> /var/backups/crm && sudo chmod 2770 /var/backups/crm   # el grupo del usuario que ejecuta pm2
sudo find /var/backups/crm -mindepth 1 -maxdepth 1 -type d ! -name base -exec chmod 700 {} +
sudo find /var/backups/crm -mindepth 1 -type f ! -path '/var/backups/crm/base/*' -exec chmod 600 {} +
```

Desde entonces, las copias a mano se hacen con `umask 077` y con la salida redirigida por quien escribe (`pg_dump -Fc base > /var/backups/crm/….dump`), no con `sudo -u postgres pg_dump -f` (postgres ya no puede escribir ahí).

## 2. Purga de las copias del backend

`scripts/servidor/purgar-copias-backend.sh` borra los `.tgz` y `.tar.gz` de más de 30 días y **siempre conserva los 5 más recientes**. No toca los `.dump`. Sin `--si` solo simula:

```bash
sudo ./scripts/servidor/purgar-copias-backend.sh /var/backups/crm          # en ISEIE: /var/backups/crm-iseie
sudo ./scripts/servidor/purgar-copias-backend.sh /var/backups/crm --si     # lo borra
```

(Si las copias del backend están en otra carpeta, se le pasa esa.) Se puede dejar en el cron mensual, por ejemplo con `0 4 1 * * root /opt/crm/production/scripts/servidor/purgar-copias-backend.sh /var/backups/crm --si`.

## 3. Rotación de los logs

**360** (como el usuario dueño del PM2):

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

- [ ] Al día siguiente: `tail /var/log/crm-copias.log` muestra un `OK` por fuente (y la subida a R2, si ya está).
- [ ] `ls -ld /var/backups/crm/base` es `drwx------ root root` y `/var/backups/crm` es `drwxrws--- root <grupo-pm2>`.
- [ ] `systemctl list-timers crm-copias.timer` muestra la siguiente vuelta y `cat /var/backups/crm/base/ESTADO` dice `OK`.
- [ ] Una restauración de prueba cuadra con producción.
- [ ] `df -h /` del 360 ha bajado tras la purga.
