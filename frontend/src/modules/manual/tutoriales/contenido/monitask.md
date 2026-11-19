Una conexión para todo el CRM, no por campus. Cada noche el CRM trae de Monitask las horas, el porcentaje de actividad y los proyectos y tareas de cada persona. **Nunca trae las capturas de pantalla.** Después coteja esas horas con las facturas de los colaboradores y avisa en la campana si la diferencia pasa del margen.

> [!aviso] **Hoy (18/11/2026) está apagado.** La aplicación de Monitask del CRM ya existe y tiene bien los permisos; lo que hay que revisar es su **dirección de retorno**, que tiene que ser exactamente la que enseña la tarjeta del CRM.

## 1. En Monitask

1. Entra en el panel de desarrolladores de Monitask (app.monitask.com/developer) con la cuenta de la empresa y abre la aplicación del CRM.
2. En «Redirect Uris», escribe **la dirección que enseña el CRM** en la tarjeta «Monitask», bloque «Redirect Uri (para la aplicación de Monitask)». Tiene que ser idéntica, carácter a carácter. Pulsa **«Add»**.
3. Borra cualquier dirección antigua con su «Delete» y pulsa **«Save»**.
4. Los permisos (scopes) tienen que ser `ExternalApi`, `profile`, `email` y `offline_access`.
5. El secreto: Monitask solo lo enseña cuando se crea. Si no se guardó, pulsa «Add Secret», copia el nuevo y borra el viejo.
6. Pasa el Client ID y el secreto a quien vaya a pegarlos en el CRM, en mano o con un gestor de contraseñas. Nunca por chat ni por correo.

## 2. En el CRM

1. Ve a **Configuración › Integraciones**. La tarjeta **«Monitask»** sale arriba del todo y no hace falta elegir campus. Pide el permiso «Configurar Monitask».
2. Comprueba que el bloque «Redirect Uri» enseña la misma dirección que pusiste en Monitask.
3. Pega «Client ID» y «Client Secret» (se guarda cifrado). Deja el «Margen del cotejo (%)» en 10 o pon el que quieras.
4. Pulsa **«Guardar»**.
5. Pulsa **«Conectar con Monitask»** y entra con el usuario **administrador** de la cuenta de Monitask. Al volver, la tarjeta pasa a «Conectado» y trae el último mes.
6. Revisa quién es quién en **Equipo de Desarrollo › Actividad › Personas**. El CRM empareja a cada persona por su correo.

![La tarjeta Monitask en Integraciones, debajo de Salud de las conexiones](c1-integraciones.webp "En el CRM de pruebas, la tarjeta «Monitask» es la primera debajo de «Salud de las conexiones».")

## 3. Para el responsable técnico

| Variable | Qué es |
|---|---|
| `MONITASK_ACTIVO` | Enciende la función. Sin él, la tarjeta no sale y la dirección de retorno no existe. **Hoy, apagado.** |
| `MONITASK_REDIRECT_URI` | Mejor vacía: el CRM la calcula sola. Si se pone, tiene que ser idéntica a la de Monitask. |
| `MONITASK_HORA` y `MONITASK_SYNC_DIAS` | La hora de la sincronización nocturna (hora de Madrid) y los días que repasa en cada vuelta. |

La entrada del menú «Equipo de Desarrollo › Actividad» se decide al compilar el frontal: hay que sacarla al menú de producción cuando se encienda.
