# Versión 3.0.0: lo que llevará

Diego, 29/09/2026: «anota eso para la versión 3.0.0 en un doc, para que cuando la hagamos sea eso».

Es la misma 3.0.0 que MultiCRM, cuyo detalle está en `docs/VERSION-3.0.0.md` del repo `CRM`. Aquí va lo que toca a ISEIE. Lo de la lista **ya está en producción** desde el 29/09, sin número de versión ni Novedades.

## Ya en ISEIE (en producción, sin versión)

- **«Cobrada» en las proformas.** Apunta el cobro en la venta y la proforma pasa a ser la factura, con el mismo número y conservando su fecha. PR #81.
- **Resúmenes del equipo.** La fila de la empresa lleva el logo de ISEIE sobre su azul, no el sello de facturación. El resumen del día dice qué horas cuenta «hoy», en hora de España, y que «vs. ayer» compara con el día entero. PR #82.

## Lo principal de la 3.0.0, que aquí falta

**La sección Conexión**: Conexión → MCP, con las conexiones de Claude por campus, empresa o todo el sistema, y quién las creó; y Conexión → Conectores (WordPress, tiendas, APIs). Con «Todos los proyectos» y por empresa, y cada uno ve lo suyo.

En MultiCRM está en producción desde el 29/09. **ISEIE no tiene ni Conectores ni MCP**: es la diferencia de paridad que ya estaba anotada. Para igualarlo hay que traer:
- los módulos `connectors` y `mcp` del backend, con las migraciones 182–185 renumeradas a la serie de ISEIE;
- las páginas del frontal y la sección del menú.

## También el 30/09

- **Ranking de gestoras por lo facturado.** «Cómo voy», el podio y los correos miden a las gestoras por el total de las facturas emitidas en el periodo, IVA incluido. Los abonos restan y las ventas compartidas se reparten. Antes se medía por número de ventas. PR #84.

## El día que se saque

1. **Decidir** si la 3.0.0 de ISEIE espera a tener Conexión o sale con lo de arriba.
2. **Fusionar en `main`** #81, #82 y #84. Hasta entonces producción va por delante de `main`: **no subir producción desde `main`**.
3. **Novedades.** Añadir la entrada `3.0.0` en `backend/src/modules/novedades/versiones.js`. Con `NOVEDADES_AUTO=1` el correo al equipo sale solo al arrancar.
4. **Etiqueta y release** `v3.0.0`.
