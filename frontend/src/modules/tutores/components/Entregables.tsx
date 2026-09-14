/*
  Qué ha entregado un tutor de una formación.

  Diego, 14/09/2026: «necesito una columna que sea: Foto corporativa, Vídeo,
  Foto y Vídeo, 25 % módulos, 50 % módulos, 100 % completo — ESTO QUE SEA COMO
  UN CHECKBOX PARA NO CONSUMIR ESPACIO EN SUBIR ARCHIVOS».

  Aquí no se sube nada: son MARCAS. El archivo vive donde viva —Drive, el
  campus— y lo que hace falta saber antes de pagar es si llegó.

  «Foto y Vídeo» no es una tercera opción: es las dos marcadas. Y los tramos de
  módulos son excluyentes —nadie está al 25 y al 50 a la vez—, así que se pintan
  como casillas pero se comportan como un único valor: volver a pulsar el que ya
  está puesto lo quita.

  El mismo componente se usa en dos sitios: en la ficha del tutor se marca, y en
  la fila del cobro de Comisiones se lee (`soloLectura`), que es donde se pulsa
  «Marcar pagado».
*/
import { Camera, VideoCamera, Check } from '@phosphor-icons/react';

const TRAMOS = [25, 50, 100];

export interface Entregado {
  entrego_foto?: boolean | null;
  entrego_video?: boolean | null;
  modulos_pct?: number | null;
}

export function resumenEntregado(e: Entregado): string {
  const partes: string[] = [];
  if (e.entrego_foto) partes.push('foto corporativa');
  if (e.entrego_video) partes.push('vídeo');
  const pct = Number(e.modulos_pct || 0);
  if (pct) partes.push(pct === 100 ? 'módulos completos' : `${pct} % de los módulos`);
  return partes.length ? partes.join(' · ') : 'no ha entregado nada todavía';
}

export default function Entregables({
  valor, onCambiar, soloLectura = false, ocupado = false,
}: {
  valor: Entregado;
  onCambiar?: (cambio: { entregoFoto?: boolean; entregoVideo?: boolean; modulosPct?: number }) => void;
  soloLectura?: boolean;
  ocupado?: boolean;
}) {
  const foto = Boolean(valor.entrego_foto);
  const video = Boolean(valor.entrego_video);
  const pct = Number(valor.modulos_pct || 0);

  const caja = (activo: boolean, extra = '') =>
    `inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
      activo
        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
        : 'border-border text-muted-foreground'
    } ${extra}`;

  if (soloLectura) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1" title={resumenEntregado(valor)}>
        <span className={caja(foto)}><Camera size={11} weight={foto ? 'fill' : 'regular'} /> Foto</span>
        <span className={caja(video)}><VideoCamera size={11} weight={video ? 'fill' : 'regular'} /> Vídeo</span>
        <span className={caja(pct > 0)}>{pct > 0 ? `${pct} %` : '0 %'}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button type="button" disabled={ocupado} aria-pressed={foto}
        onClick={() => onCambiar?.({ entregoFoto: !foto })}
        title="Foto corporativa entregada"
        className={caja(foto, 'hover:border-foreground/40 disabled:opacity-50')}>
        {foto ? <Check size={11} weight="bold" /> : <Camera size={11} />} Foto
      </button>
      <button type="button" disabled={ocupado} aria-pressed={video}
        onClick={() => onCambiar?.({ entregoVideo: !video })}
        title="Vídeo entregado"
        className={caja(video, 'hover:border-foreground/40 disabled:opacity-50')}>
        {video ? <Check size={11} weight="bold" /> : <VideoCamera size={11} />} Vídeo
      </button>
      {TRAMOS.map((t) => (
        <button key={t} type="button" disabled={ocupado} aria-pressed={pct === t}
          // Pulsar el que ya esta puesto lo quita: es la unica forma de volver
          // a «no ha entregado nada» sin un boton de borrar aparte.
          onClick={() => onCambiar?.({ modulosPct: pct === t ? 0 : t })}
          title={t === 100 ? 'Módulos completos' : `${t} % de los módulos`}
          className={caja(pct === t, 'hover:border-foreground/40 disabled:opacity-50')}>
          {t} %
        </button>
      ))}
    </span>
  );
}
