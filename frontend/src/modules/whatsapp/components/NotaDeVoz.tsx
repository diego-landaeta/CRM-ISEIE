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
  // Si el navegador no sabe con este audio. Antes fallaba EN SILENCIO: se
  // pulsaba reproducir, la promesa se rechazaba, se apagaba el boton y ya. Sin
  // aviso, sin motivo y sin salida — y eso es exactamente lo que se ve cuando
  // el formato no entra: parece que la nota se envio rota.
  const [noPuede, setNoPuede] = useState(false);
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
    // El navegador avisa por aqui cuando no puede con el formato. Es la unica
    // forma de enterarse antes de que alguien pulse.
    const alFallar = () => { setNoPuede(true); setSonando(false); };
    const alTerminar = () => { setSonando(false); setVoy(0); };
    a.addEventListener('loadedmetadata', alCargar);
    a.addEventListener('timeupdate', alAvanzar);
    a.addEventListener('ended', alTerminar);
    a.addEventListener('error', alFallar);
    return () => {
      a.removeEventListener('loadedmetadata', alCargar);
      a.removeEventListener('timeupdate', alAvanzar);
      a.removeEventListener('ended', alTerminar);
      a.removeEventListener('error', alFallar);
    };
  }, [src]);

  function alternar() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) {
      // Se paran las demas: dos notas de voz a la vez no se entienden.
      document.querySelectorAll('audio').forEach((o) => { if (o !== a) o.pause(); });
      a.play().then(() => setSonando(true)).catch(() => { setSonando(false); setNoPuede(true); });
    } else {
      a.pause(); setSonando(false);
    }
  }

  const avance = total > 0 ? (voy / total) * 100 : 0;

  // Cuando no se puede reproducir aqui, se DICE y se ofrece la salida. Un boton
  // que no hace nada al pulsarlo es peor que no tener boton.
  if (noPuede) {
    return (
      <div className={`wa-voz wa-voz-rota ${mia ? 'wa-voz-mia' : ''}`}>
        <a href={src} download className="wa-voz-descargar">
          ⬇ Este navegador no reproduce la nota — descárgala
        </a>
      </div>
    );
  }

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
