Make le pregunta al CRM a quién asignar cada lead nuevo. El CRM elige, de las gestoras activas en los últimos minutos, a quién le toca, y se lo dice a Make por uno de dos escenarios. Viene encendida y no necesita interruptor.

> [!aviso] **Hoy (18/11/2026):** la pantalla está en producción; el estado de la asignación en ISEIE no se ha comprobado. Los escenarios de Make de ISEIE se llevan aparte: revísalos en Make antes de cambiar nada aquí.

## 1. Crear una asignación

1. Ve a **Configuración › «Asignación de leads»**. Pide el permiso de ver y crear webhooks de salida.
2. Pulsa **«Nueva asignación de leads»** y rellena:

- «Nombre».
- «Para quién»: el campus (en ISEIE solo hay uno). **No se puede cambiar después.**
- «Ventana de actividad (minutos)»: 15 de serie, entre 1 y 240. Lo reciente que tiene que ser la actividad de una gestora para contar como «activa».
- «Escenario 1 · el de siempre» y «Escenario 2 · el nuevo»: cada uno es un «Mailhook (correo de Make)» o un «Webhook (URL de Make)».
- «Encendida». Si está apagada, todo va al escenario 1.

3. Al guardar, sale la **clave de entrada** que Make tiene que mandar en cada llamada al CRM. **Se enseña una sola vez**: cópiala en el escenario de Make en ese momento.

## 2. Para el responsable técnico

- `ASIGNACION_DISABLED` solo quita los reintentos (a 1, 5 y 15 minutos). El primer envío sale igual.
- `ASIGNACION_TIMEOUT_MS` es lo que espera el CRM a Make en cada envío.
