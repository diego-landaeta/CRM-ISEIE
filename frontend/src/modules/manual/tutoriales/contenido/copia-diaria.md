El propio CRM puede hacer cada noche una copia de su base de datos, meterla en un ZIP cifrado y mandarla por correo. Si el ZIP es grande, manda un enlace que caduca. **No hay pantalla**: todo va en el servidor.

> [!aviso] **Hoy (18/11/2026) está apagada.** Las copias de la base se hacen por otro camino, cada día. Encender esta copia por correo lo decide el responsable técnico.

## Para el responsable técnico

| Variable | Qué es |
|---|---|
| `COPIA_DIARIA_ACTIVA` | La enciende. |
| `COPIA_DIARIA_CLAVE` | La contraseña del ZIP, de 16 caracteres o más. **Sin ella no hace nada.** No va en el correo: se guarda aparte. |
| `COPIA_DIARIA_PARA` | Los destinatarios. |
| `COPIA_DIARIA_HORA` | A qué hora se hace. |
| `COPIA_DIARIA_GUARDAR` | Cuántas copias deja en el servidor. |
| `COPIA_DIARIA_MAX_ADJUNTO_MB` y `COPIA_DIARIA_ENLACE_HORAS` | Por encima de ese tamaño, en vez del adjunto manda un enlace que dura esas horas. |
| `COPIA_DIARIA_PG_DUMP` | El programa de copia de Postgres, de la misma versión que la base o más nuevo. |

La base comprimida del CRM pesa varias decenas de megas, así que irá siempre por enlace.
