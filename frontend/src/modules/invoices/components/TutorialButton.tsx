import { useState } from 'react';
import { GraduationCap, X, Minus, ArrowsOutSimple } from '@phosphor-icons/react';

// Botón "Tutorial" + reproductor flotante minimizable. Se abre como una ventana
// tipo picture-in-picture (abajo a la derecha) para poder seguir el vídeo mientras
// se opera el CRM; se puede minimizar a una píldora y restaurar.
interface Props {
  /** Ruta del vídeo relativa a public (sin la base). Ej: 'tutoriales/facturacion.mp4' */
  src?: string;
  title?: string;
}

export default function TutorialButton({ src = 'tutoriales/facturacion.mp4', title = 'Tutorial: Facturación' }: Props) {
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(false);

  // Resuelve la base del deploy (/crm/ en ISEIH, / en ISEIE) para servir el vídeo
  // desde public/ en cualquiera de los dos entornos.
  const videoUrl = `${import.meta.env.BASE_URL}${src}`.replace(/([^:])\/\//g, '$1/');

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setMin(false); }}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted"
        title="Ver el tutorial en vídeo de esta sección"
      >
        <GraduationCap size={15} weight="bold" /> Tutorial
      </button>

      {open && (
        <div
          className={`fixed z-[90] bottom-4 right-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden transition-all ${
            min ? 'w-56' : 'w-[min(92vw,640px)]'
          }`}
          role="dialog"
          aria-label={title}
        >
          {/* Barra superior */}
          <div className="flex items-center gap-2 px-3 h-10 bg-muted/60 border-b border-border">
            <GraduationCap size={15} weight="bold" className="text-primary flex-shrink-0" />
            <span className="text-xs font-semibold truncate flex-1">{title}</span>
            {min ? (
              <button onClick={() => setMin(false)} title="Restaurar" aria-label="Restaurar"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                <ArrowsOutSimple size={14} weight="bold" />
              </button>
            ) : (
              <button onClick={() => setMin(true)} title="Minimizar" aria-label="Minimizar"
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                <Minus size={14} weight="bold" />
              </button>
            )}
            <button onClick={() => setOpen(false)} title="Cerrar" aria-label="Cerrar"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-600">
              <X size={14} weight="bold" />
            </button>
          </div>

          {/* Vídeo (se oculta al minimizar pero sigue montado para no reiniciar) */}
          <div className={min ? 'hidden' : 'block bg-black'}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={videoUrl}
              controls
              preload="metadata"
              className="w-full max-h-[70vh] block"
            />
          </div>
        </div>
      )}
    </>
  );
}
