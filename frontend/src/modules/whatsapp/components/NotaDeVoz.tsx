import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from '@phosphor-icons/react';

// El reproductor de las notas de voz.
//
// Antes era un <audio controls> pelado: el control que pinta el navegador, un
// pastillon blanco de 250 px con sus botones de sistema, en medio de un chat
// oscuro. No hay forma de darle estilo —lo dibuja el navegador— asi que se
// monta uno encima del audio, que sigue siendo quien reproduce.

const mmss = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export default function NotaDeVoz({ src, mia }: { src: string; mia: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [sonando, setSonando] = useState(false);
  const [voy, setVoy] = useState(0);
  const [total, setTotal] = useState(0);

  // La duracion no siempre viene en los metadatos: WhatsApp manda ogg/opus sin
  // ella y sale «Infinity». Se resuelve saltando al final una vez, que es el
  // truco de siempre, y volviendo al principio.
  useEffect(() => {
    const a = audio.current;
    if (!a) return undefined;
    const alCargar = () => {
      if (Number.isFinite(a.duration)) { setTotal(a.duration); return; }
      const alBuscar = () => {
        if (Number.isFinite(a.duration)) setTotal(a.duration);
        a.currentTime = 0;
        a.removeEventListener('timeupdate', alBuscar);
      };
      a.addEventListener('timeupdate', alBuscar);
      a.currentTime = 1e6;
    };
    const alAvanzar = () => setVoy(a.currentTime);
    const alTerminar = () => { setSonando(false); setVoy(0); };
    a.addEventListener('loadedmetadata', alCargar);
    a.addEventListener('timeupdate', alAvanzar);
    a.addEventListener('ended', alTerminar);
    return () => {
      a.removeEventListener('loadedmetadata', alCargar);
      a.removeEventListener('timeupdate', alAvanzar);
      a.removeEventListener('ended', alTerminar);
    };
  }, [src]);

  function alternar() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      // Se paran las demas: dos notas de voz a la vez no se entienden.
      document.querySelectorAll('audio').forEach((o) => { if (o !== a) o.pause(); });
      a.play().then(() => setSonando(true)).catch(() => setSonando(false));
    } else {
      a.pause(); setSonando(false);
    }
  }

  const avance = total > 0 ? (voy / total) * 100 : 0;

  return (
    <div className={`wa-voz ${mia ? 'wa-voz-mia' : ''}`}>
      <audio ref={audio} src={src} preload="metadata" />
      <button type="button" onClick={alternar} className="wa-voz-boton"
        title={sonando ? 'Pausar' : 'Reproducir'}>
        {sonando ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
      </button>
      <div className="wa-voz-barra"
        onClick={(e) => {
          const a = audio.current;
          if (!a || !total) return;
          const caja = e.currentTarget.getBoundingClientRect();
          a.currentTime = ((e.clientX - caja.left) / caja.width) * total;
        }}>
        <span className="wa-voz-hecho" style={{ width: `${avance}%` }} />
        <span className="wa-voz-punto" style={{ left: `${avance}%` }} />
      </div>
      <span className="wa-voz-tiempo">{mmss(sonando || voy > 0 ? voy : total)}</span>
    </div>
  );
}
