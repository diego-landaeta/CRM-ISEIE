Aquí **no hay conexión con el banco**: el Santander no da una API abierta. Se baja el extracto de la banca online y se sube al CRM. El CRM lee solo los **abonos**, busca a qué venta corresponde cada uno y, cuando está seguro, apunta el cobro. No hacen falta claves ni contraseñas del banco.

> [!aviso] **Hoy (18/11/2026) está apagado.** Lo enciende el responsable técnico. Mientras tanto, la entrada «PayPal y banco» no sale en el menú.

## 1. Bajar el extracto

1. En la banca online de empresas, abre la cuenta de ISEIE y ve a movimientos.
2. Elige las fechas y descarga en formato **Norma 43** (también se llama «Cuaderno 43» o «AEB 43»). Es el recomendado: trae la cuenta, las fechas y los importes sin dudas.
3. Si solo hay Excel, ábrelo y guárdalo como **CSV**. El CRM **no acepta .xlsx**.

## 2. Qué ficheros acepta

| | Norma 43 | CSV |
|---|---|---|
| Extensión | `.n43`, `.aeb`, `.aeb43`, `.q43`, `.txt` o `.dat` | `.csv` (o `.txt`) |
| Tamaño | Un solo fichero, de 5 MB como mucho. | Igual. |
| Cómo lo reconoce | Cabecera que empieza por `11`, movimientos por `22` y conceptos por `23`, todas de 80 posiciones. Sin la cabecera da error. | Separador `;`, `,` o tabulador. La fila de títulos tiene que estar en las 30 primeras líneas, con una columna de fecha y otra de importe o haber. |
| Columnas | — | Fecha, «Fecha valor», «Concepto» (o «Descripción»), «Importe» (o «Haber» y «Debe»), «Referencia» y «Divisa». Mayúsculas y tildes dan igual. |
| Fechas e importes | Fechas AAMMDD e importes con 2 decimales. | Fechas `dd/mm/aaaa`, `dd-mm-aa` o `aaaa-mm-dd`. Importes `1.234,56`, `1234.56`, `-45,00` o `(45,00)`. |

Del número de cuenta se guardan solo los 4 últimos dígitos.

## 3. Subirlo al CRM

1. ISEIE es un solo campus: no hay que elegirlo.
2. Ve a **Finanzas › «PayPal y banco»** («Cobros de PayPal y del banco»).
3. Abre la pestaña **«Banco (extractos)»**, ve a «Subir un extracto», pulsa **«Elegir fichero»** y elige el fichero.
4. Revisa las pestañas del resultado:

- **«Registrados»**: había una sola venta posible y coincidían el nombre del cliente en el concepto y el importe, así que el cobro ya está apuntado.
- **«A revisar»**: hay ventas posibles pero no está seguro. Se elige la venta a mano.
- **«Sin candidato»**: no encuentra la venta.
- **«Descartados»**: por ejemplo, las liquidaciones de Stripe o PayPal que llegan al banco. Se descartan solas para no contar dos veces.

> [!ok] Se puede subir el mismo extracto dos veces, o dos que se solapan: el CRM reconoce el fichero y cada movimiento, y no duplica nada.

Cada cobro apuntado salda la siguiente cuota pendiente de su venta, como cualquier otro cobro.

## 4. Quién puede

- «Ver cobros de PayPal y del banco»: la lista.
- «Registrar cobros de PayPal y del banco»: subir extractos y decidir a qué venta va cada abono dudoso.

## 5. Para el responsable técnico

El interruptor es `SANTANDER_EXTRACTOS_ACTIVO`. **Hoy está apagado.** La entrada del menú «PayPal y banco» se decide al compilar el frontal.
