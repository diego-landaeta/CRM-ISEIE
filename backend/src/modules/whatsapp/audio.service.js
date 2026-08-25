import { spawn } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { logger } from '../../shared/utils/logger.js';

/**
 * Deja una grabacion del navegador lista para mandarla como nota de voz.
 *
 * Se convierte AQUI y no se deja en manos de quien reciba el envio, y esa es la
 * cuestion: mandando el fichero tal cual sale del navegador —webm— la nota
 * llegaba muda al movil, y mandando exactamente el mismo audio ya convertido a
 * ogg se oia. Mismo sonido, mismos segundos, misma onda; lo unico distinto era
 * quien hacia la conversion. Comprobado con la misma grabacion por los dos
 * caminos.
 *
 * De paso deja de haber dos comportamientos: antes convertia Evolution en
 * produccion y el puente de Baileys en local, cada uno con sus ajustes. Ahora
 * sale lo mismo de los dos sitios.
 *
 * Los ajustes son los de una nota de voz de WhatsApp: opus en ogg, 48 kHz,
 * mono, modo `voip` —el de por defecto de libopus es `audio`, pensado para
 * musica— y tramas de 20 ms.
 */
export function aNotaDeVoz(buffer) {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg.path, [
      '-i', 'pipe:0',
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '32k',
      '-ar', '48000', '-ac', '1',
      '-application', 'voip',
      '-frame_duration', '20',
      '-vbr', 'on',
      '-compression_level', '10',
      '-f', 'ogg', 'pipe:1',
    ]);
    const salida = [];
    const errores = [];
    p.stdout.on('data', (d) => salida.push(d));
    p.stderr.on('data', (d) => errores.push(d));
    // Nunca lanza: si no se puede convertir se devuelve null y quien llama
    // decide. Tumbar el envio de una nota por esto seria peor.
    p.on('error', (e) => {
      logger.error({ err: e.message }, 'WhatsApp: no se pudo arrancar ffmpeg para la nota de voz');
      resolve(null);
    });
    p.on('close', (codigo) => {
      const ogg = Buffer.concat(salida);
      // Un ogg de verdad empieza por «OggS». Si no, ffmpeg devolvio otra cosa y
      // vale mas cazarlo aqui que en el movil de alguien.
      if (codigo !== 0 || !ogg.length || ogg.subarray(0, 4).toString() !== 'OggS') {
        logger.error(
          { codigo, bytes: ogg.length, detalle: Buffer.concat(errores).toString().slice(-200) },
          'WhatsApp: la conversion de la nota de voz fallo'
        );
        return resolve(null);
      }
      resolve(ogg);
    });
    p.stdin.on('error', () => {});
    p.stdin.end(buffer);
  });
}
