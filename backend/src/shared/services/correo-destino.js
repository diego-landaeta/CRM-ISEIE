import dns from 'node:dns';
import net from 'node:net';

/**
 * A DÓNDE SE DEJA CONECTAR EL SERVIDOR al leer o probar un buzón (CRM-ISEIE#701, gemela de CRM#1032).
 *
 * Con los buzones en el panel, quien tiene `correos.buzones` escribe un
 * servidor y un puerto y la API se conecta allí. Sin límites, «Probar conexión»
 * serviría para que el servidor del CRM llamara a cualquier sitio: a su propia
 * base de datos, a otro servicio de la red interna o a los metadatos del
 * proveedor (169.254.169.254), y la respuesta —«conecta» o «no contesta»— diría
 * qué hay abierto. Por eso:
 *
 *   · solo los puertos de IMAP: 993 (TLS directo) y 143 (con STARTTLS);
 *   · el nombre se resuelve y, si ALGUNA de sus direcciones es interna
 *     (loopback, privada, link-local, CGNAT, metadatos…), no se conecta;
 *   · se conecta a la IP YA comprobada, no al nombre otra vez: si no, un DNS
 *     que cambia de respuesta entre la comprobación y la conexión (rebinding)
 *     se saltaría la regla. El nombre va como `servername`, para que el
 *     certificado TLS se siga comprobando contra él.
 *
 * La única excepción, fuera de producción y con `CORREO_IMAP_SIN_TLS=1`: el
 * servidor IMAP de pruebas en local (greenmail), en otro puerto y en 127.0.0.1.
 */

export const PUERTOS_IMAP = [993, 143];

/** El modo del servidor de pruebas local. Nunca en producción. */
export function modoPruebasLocal() {
  return process.env.NODE_ENV !== 'production' && process.env.CORREO_IMAP_SIN_TLS === '1';
}

export const MOTIVO_PUERTO = 'El puerto tiene que ser 993 (TLS) o 143 (STARTTLS).';
export const MOTIVO_INTERNO = 'Ese servidor apunta a una dirección interna y no se permite.';
export const MOTIVO_NO_EXISTE = 'No se encuentra ese servidor.';

export function puertoPermitido(puerto) {
  return modoPruebasLocal() || PUERTOS_IMAP.includes(Number(puerto));
}

const INTERNAS = new net.BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8],          // «esta red», 0.0.0.0 incluido
  ['10.0.0.0', 8],         // privada
  ['100.64.0.0', 10],      // CGNAT (y los metadatos de Alibaba, 100.100.100.200)
  ['127.0.0.0', 8],        // loopback
  ['169.254.0.0', 16],     // link-local y metadatos (169.254.169.254)
  ['172.16.0.0', 12],      // privada
  ['192.0.0.0', 24],       // asignaciones del IETF
  ['192.168.0.0', 16],     // privada
  ['198.18.0.0', 15],      // pruebas de red
  ['224.0.0.0', 4],        // multicast
  ['240.0.0.0', 4],        // reservada y 255.255.255.255
]) INTERNAS.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [
  ['::', 128],             // sin especificar
  ['::1', 128],            // loopback
  // Las IPv4 escritas como IPv6 (::ffff:127.0.0.1) las mira BlockList contra las
  // reglas de IPv4. NO se añade ::ffff:0:0/96: con ella, toda IPv4 salía interna.
  ['fc00::', 7],           // privada (fd00:ec2::254, los metadatos de AWS, entra aquí)
  ['fe80::', 10],          // link-local
  ['ff00::', 8],           // multicast
]) INTERNAS.addSubnet(ip, bits, 'ipv6');

/** ¿Es una dirección a la que el CRM no debe conectarse? Lo que no es una IP, también. */
export function esDireccionInterna(ip) {
  const familia = net.isIP(String(ip || ''));
  if (!familia) return true;
  return INTERNAS.check(ip, familia === 6 ? 'ipv6' : 'ipv4');
}

/** El resolutor de nombres. Un objeto para que las pruebas lo cambien sin red. */
export const resolutor = {
  lookup: (host) => dns.promises.lookup(host, { all: true, verbatim: true }),
};

/**
 * Comprueba puerto y servidor. Devuelve `{ ok: true, ip }` con la IP a la que
 * conectar, o `{ ok: false, motivo }`. Nunca lanza.
 */
export async function destinoSeguro({ host, puerto }) {
  if (!puertoPermitido(puerto)) return { ok: false, motivo: MOTIVO_PUERTO };
  let direcciones;
  try {
    direcciones = await resolutor.lookup(host);
  } catch {
    return { ok: false, motivo: MOTIVO_NO_EXISTE };
  }
  if (!Array.isArray(direcciones) || !direcciones.length) return { ok: false, motivo: MOTIVO_NO_EXISTE };
  // ALGUNA, no la primera: un nombre con una pública y una privada podría
  // acabar en la privada en el siguiente intento.
  if (!modoPruebasLocal() && direcciones.some((d) => esDireccionInterna(d.address))) {
    return { ok: false, motivo: MOTIVO_INTERNO };
  }
  return { ok: true, ip: direcciones[0].address };
}
