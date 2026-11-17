import * as P from '../../shared/services/email-plantilla.service.js';

/*
  Factura automática (#452) · los dos correos al alumno.

  Con la plantilla común y la marca de SU campus (norma del 10/10), y por
  `sendEmail` con el `projectId`: sale por la cuenta y el remitente de esa
  marca, y pasa por el freno de los entornos de pruebas como cualquier otro.
*/

const fmtFecha = (d) => new Date(d).toLocaleDateString('es-ES', {
  day: 'numeric', month: 'long', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
});

const euros = (n) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const marcaDe = (v) => ({ id: v.project_id, nombre: v.campus, slug: v.slug, logo_url: v.logo_url, emoji: v.emoji });

const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || null;

/** La dirección del formulario: una pantalla pública del CRM. */
export const urlDelFormulario = (token) => P.enlace(`datos-fiscales/${token}`);

/** El correo con el enlace al formulario. `v`: la venta (model.venta). */
export function armarPeticion({ v, token, caducaAt, reenvio = false }) {
  const programa = v.producto_catalogo || v.producto_contratado || null;
  const { htmlContent, textContent } = P.correo({
    proyecto: marcaDe(v),
    titulo: 'Tus datos para la factura',
    saludo: primerNombre(v.nombre),
    resumen: `Hemos recibido tu pago${programa ? ` de ${programa}` : ''}. Dinos a nombre de quién va la factura.`,
    bloques: [
      reenvio ? P.parrafo('Te mandamos un enlace nuevo: el anterior ya no sirve.') : null,
      P.parrafo(`Hemos recibido tu pago${programa ? ` de <strong>${P.esc(programa)}</strong>` : ''}. ¡Gracias!`),
      P.parrafo('Para hacerte la factura necesitamos tus datos fiscales: el nombre o la razón social, el NIF, la dirección y el correo al que te la mandamos. Es un minuto.'),
      P.boton({ texto: 'Completar mis datos', url: urlDelFormulario(token) }),
      P.nota(`El enlace es personal y sirve una sola vez. Puedes usarlo hasta el <strong>${P.esc(fmtFecha(caducaAt))}</strong>. `
        + 'Si no lo completas, haremos la factura con los datos que ya tenemos de ti.'),
    ],
  });
  return { asunto: `${v.campus || 'Tu pago'} · tus datos para la factura`, htmlContent, textContent };
}

/** El correo con la factura en PDF. `inv`: la factura recién emitida. */
export function armarFactura({ v, inv }) {
  const { htmlContent, textContent } = P.correo({
    proyecto: marcaDe(v),
    titulo: `Tu factura ${inv.codigo}`,
    saludo: primerNombre(inv.cliente_nombre),
    resumen: `Factura ${inv.codigo} por ${euros(inv.total)}`,
    bloques: [
      P.parrafo(`Te adjuntamos la factura <strong>${P.esc(inv.codigo)}</strong> por <strong>${P.esc(euros(inv.total))}</strong>.`),
      P.nota(`A nombre de: <strong>${P.esc(inv.cliente_nombre || '')}</strong>${inv.cliente_nif ? `<br>NIF: ${P.esc(inv.cliente_nif)}` : ''}`),
      P.parrafo('Si algún dato no es correcto, contesta a tu asesor y la corregimos.'),
    ],
  });
  return { asunto: `Factura ${inv.codigo} · ${v.campus || ''}`.trim(), htmlContent, textContent };
}
