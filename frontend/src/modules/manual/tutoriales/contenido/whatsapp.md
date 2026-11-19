El WhatsApp del CRM funciona con **Evolution**, un servicio que corre junto al CRM. Cada persona enlaza su número escaneando un QR, como en WhatsApp Web. **Wasapi no está conectado**: solo se le exporta una plantilla.

> [!ok] **Hoy (18/11/2026):** en uso. No hay nada que configurar en la web aparte de que cada persona enlace su número.

## 1. Enlazar un número (cada gestora)

1. Ve a **WhatsApp › «Conexión»**. Pide el permiso «Usar su WhatsApp».
2. Lee el aviso y marca **«Lo he leído y enlazo mi número sabiéndolo»**.
3. Elige qué traer del móvil: «Empezar de cero», «El último mes» o «Todo el historial».
4. Pulsa **«Enlazar mi número»**. Sale un QR que cambia cada pocos segundos.
5. En el móvil: WhatsApp › Dispositivos vinculados › **«Vincular un dispositivo»**, y escanea el QR.

Para cortar la conexión: **«Desvincular mi número»**.

La guía de uso del chat está en **WhatsApp › «Cómo se usa»**.

## 2. Otras pantallas relacionadas

- **Botón de WhatsApp de las webs:** Captación › «Widget web».
- **Wasapi:** en Prospectos, botón «Wasapi» › «Exportar plantilla Wasapi». La asignación de leads manda a Make quién lleva el WhatsApp de cada lead, para el escenario que trabaja con Wasapi. No hay conexión por API.

## 3. Para el responsable técnico

Ya está hecho en el servidor. Las variables, por si hay que revisarlas:

| Variable | Qué es |
|---|---|
| `EVOLUTION_URL` y `EVOLUTION_API_KEY` | Dónde está Evolution y su clave. Sin ellas, el módulo no hace nada. |
| `EVOLUTION_INSTANCIA` | **Distinta en cada entorno.** Si pruebas y producción comparten instancia, pruebas desconecta a producción. |
| `EVOLUTION_WEBHOOK_URL` y `EVOLUTION_WEBHOOK_SECRET` | El aviso de los mensajes que entran. El secreto es obligatorio en producción: sin él, los mensajes que entran se rechazan. |
| `WA_TOPE_MINUTO`, `WA_TOPE_HORA` y `WA_TOPE_DIA` | Cuántos mensajes puede mandar cada número, para que WhatsApp no lo bloquee. |
