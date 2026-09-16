/*
  Qué ha entregado un tutor de una formación.

  Diego, 14/09/2026: «necesito una columna que sea: Foto corporativa, Vídeo,
  Foto y Vídeo, 25 % módulos, 50 % módulos, 100 % completo — ESTO QUE SEA COMO
  UN CHECKBOX PARA NO CONSUMIR ESPACIO EN SUBIR ARCHIVOS». Y después: «no se
  entienden bien del todo los checkbox, pon el nombre completo de cada
  elemento».

  Aquí no se sube nada: son MARCAS. El archivo vive donde viva —Drive, el
  campus— y lo que hace falta saber antes de pagar es si llegó.

  Los seis nombres van tal cual los pidió. Dos cosas que conviene entender de
  cómo se guardan, porque no son seis casillas sueltas:

  - «Foto y Vídeo» NO es un tercer archivo: es las otras dos marcadas. Se pinta
    porque él lo pidió y porque es el caso normal —se graba todo el mismo día—,
    y pulsarlo marca o desmarca las dos de golpe.
  - Los tres tramos de módulos son EXCLUYENTES: nadie está al 25 y al 50 a la
    vez. Se ven como casillas, pero guardan un único número; pulsar el que ya
    está puesto lo quita.

  El mismo componente se usa en dos sitios: en la ficha del tutor se marca, y en
  la fila del cobro de Comisiones se lee (`soloLectura`), que es donde se pulsa
  «Marcar pagado».
*/
import { Camera, VideoCamera, Check } from '@phosphor-icons/react';

const TRAMOS: Array<{ pct: number; nombre: string }> = [
  { pct: 25, nombre: '25% módulos' },
  { pct: 50, nombre: '50% módulos' },
  { pct: 100, nombre: '100% completo' },
];

export interface Entregado {
  entrego_foto?: boolean | null;
  entrego_video?: boolean | null;
  modulos_pct?: number | null;
}

/** Lo entregado, en una frase. Para el título al pasar por encima y para el correo. */
export function resumenEntregado(e: Entregado): string {
  const partes: string[] = [];
  if (e.entrego_foto && e.entrego_video) partes.push('foto y vídeo');
  else if (e.entrego_foto) partes.push('foto corporativa');
  else if (e.entrego_video) partes.push('vídeo');
  const pct = Number(e.modulos_pct || 0);
  if (pct) partes.push(TRAMOS.find((t) => t.pct === pct)!.nombre.toLowerCase());
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
  const ambos = foto && video;
  const pct = Number(valor.modulos_pct || 0);

  const caja = (activo: boolean, extra = '') =>
    `inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap transition-colors ${
      activo
        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
        : 'border-border text-muted-foreground'
    } ${extra}`;

  // Donde solo se lee —la fila del cobro— se enseña lo marcado y ya: repetir las
  // seis casillas en gris ocupa una columna entera para no decir nada.
  if (soloLectura) {
    const puestas: string[] = [];
    if (ambos) puestas.push('Foto y Vídeo');
    else if (foto) puestas.push('Foto corporativa');
    else if (video) puestas.push('Vídeo');
    if (pct) puestas.push(TRAMOS.find((t) => t.pct === pct)!.nombre);
    if (!puestas.length) {
      return <span className="text-[10px] text-muted-foreground italic">sin entregar</span>;
    }
    return (
      <span className="inline-flex flex-wrap items-center gap-1" title={resumenEntregado(valor)}>
        {puestas.map((t) => <span key={t} className={caja(true)}>{t}</span>)}
      </span>
    );
  }

  const casilla = (
    activo: boolean,
    nombre: string,
    alPulsar: () => void,
    Icono?: typeof Camera,
  ) => (
    <button
      key={nombre}
      type="button"
      disabled={ocupado}
      aria-pressed={activo}
      onClick={alPulsar}
      className={caja(activo, 'hover:border-foreground/40 disabled:opacity-50')}
    >
      {activo ? <Check size={11} weight="bold" /> : (Icono ? <Icono size={11} /> : <span className="w-[11px]" />)}
      {nombre}
    </button>
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {casilla(foto, 'Foto corporativa', () => onCambiar?.({ entregoFoto: !foto }), Camera)}
      {casilla(video, 'Vídeo', () => onCambiar?.({ entregoVideo: !video }), VideoCamera)}
      {/* Las dos de golpe. No es un archivo más: es el atajo del caso normal. */}
      {casilla(ambos, 'Foto y Vídeo', () => onCambiar?.({ entregoFoto: !ambos, entregoVideo: !ambos }))}
      {TRAMOS.map((t) => casilla(pct === t.pct, t.nombre,
        // Pulsar el que ya está puesto lo quita: es la única forma de volver a
        // «no ha entregado nada» sin un botón de borrar aparte.
        () => onCambiar?.({ modulosPct: pct === t.pct ? 0 : t.pct })))}
    </span>
  );
}
