import { useEffect, useRef, useState } from 'react';
import { Tag, Check } from '@phosphor-icons/react';
import { etiquetasWhatsapp, etiquetarChat, type EtiquetaWhatsapp } from '../api/whatsapp.api';
import { toast } from '@/shared/hooks/useToast';

/*
  Las etiquetas del WhatsApp de la gestora, en la cabecera del chat (#128, #138).

  NO son las del CRM. Justo al lado hay un desplegable que también se llama
  «etiqueta» (#72) y es el ESTADO del prospecto: ese lo decide el CRM y viaja con
  la persona. Estas viven en el móvil de ella. Por eso van en un botón aparte,
  con otro icono y otro aspecto: puestas juntas parecerían dos formas de lo
  mismo.

  SI NO HAY NINGUNA, NO SE PINTA NADA. Las etiquetas son una función de WhatsApp
  Business: en una cuenta personal no existen y la lista vuelve vacía. Un botón
  que al abrirlo dice «no hay nada» es de las cosas que se reportan como avería.
*/

export default function EtiquetasDelChat({
  conversacionId, puestas, esGrupo, deQuien, alCambiar,
}: {
  conversacionId: number;
  /** Las que ya tiene este chat, tal como vienen del servidor. */
  puestas: { nombre: string; color: string | null; waId: string }[];
  esGrupo: boolean;
  /** De quién es la sesión, cuando un admin está mirando la de otra persona. */
  deQuien?: number | null;
  alCambiar: () => void;
}) {
  const [todas, setTodas] = useState<EtiquetaWhatsapp[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let vivo = true;
    etiquetasWhatsapp(deQuien)
      .then((r) => { if (vivo) setTodas(r.success ? (r.data || []) : []); })
      .catch(() => { if (vivo) setTodas([]); });
    return () => { vivo = false; };
  }, [deQuien]);

  // Cerrar con Escape, como el resto de los popup de esta pantalla.
  useEffect(() => {
    if (!abierto) return undefined;
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [abierto]);

  // A un grupo WhatsApp no le deja poner etiquetas: `handleLabel` pide un número
  // y comprueba que existe. Ofrecerlo sería prometer algo que no puede pasar.
  if (esGrupo || !todas || todas.length === 0) return null;

  const tienePuesta = (waId: string) => puestas.some((p) => p.waId === waId);

  async function alternar(e: EtiquetaWhatsapp) {
    const poner = !tienePuesta(e.wa_id);
    setGuardando(e.wa_id);
    try {
      const r = await etiquetarChat(conversacionId, e.wa_id, poner, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo');
      // Se recarga desde el servidor en vez de apuntarlo aquí: lo que vale es
      // lo que quedó en WhatsApp, no lo que creemos haber mandado.
      alCambiar();
    } catch (err) {
      toast({
        title: 'No se pudo cambiar la etiqueta',
        description: err instanceof Error ? err.message : 'Inténtalo otra vez.',
        variant: 'destructive',
      });
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="wa-etiquetas-chat" ref={caja}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="wa-btn-etiquetas"
        aria-expanded={abierto}
        title={puestas.length
          ? `Etiquetas de WhatsApp: ${puestas.map((p) => p.nombre).join(', ')}`
          : 'Poner una etiqueta de WhatsApp'}
      >
        <Tag size={17} weight={puestas.length ? 'fill' : 'regular'} />
        {puestas.length > 0 && <span className="wa-etiquetas-cuantas">{puestas.length}</span>}
      </button>

      {abierto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="wa-etiquetas-menu" role="menu" aria-label="Etiquetas de WhatsApp">
            <p className="wa-etiquetas-titulo">Etiquetas de tu WhatsApp</p>
            {todas.map((e) => {
              const puesta = tienePuesta(e.wa_id);
              return (
                <button
                  key={e.wa_id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={puesta}
                  disabled={guardando !== null}
                  onClick={() => alternar(e)}
                  className={`wa-etiquetas-item ${puesta ? 'wa-etiquetas-item-puesta' : ''}`}
                >
                  <span className="wa-etiquetas-tic">{puesta && <Check size={12} weight="bold" />}</span>
                  <span className="wa-etiquetas-nombre">{e.nombre}</span>
                </button>
              );
            })}
            {/* Se dice de dónde salen: quien las ve aquí por primera vez no
                tiene por qué saber que son las de su móvil y no unas del CRM. */}
            <p className="wa-etiquetas-pie">
              Son las de tu móvil. Al cambiarlas aquí, cambian allí.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
