// Atender a alguien sin abrir la ventana.
//
// Diego, 23/09: «el seguimiento del mes debe ser más interactivo». Lo que había
// obligaba a abrir el panel para cada persona: cuatro clics por prospecto y
// cuatrocientos prospectos en la lista. El envío en bloque resuelve la difusión
// masiva, pero no el caso de en medio —atender a cinco o seis de la lista, una
// detrás de otra— que es lo que se hace de verdad un martes por la tarde.
//
// QUÉ HACE CADA BOTÓN. Abre WhatsApp o el correo con esa persona, y apunta el
// contacto. Lo segundo importa tanto como lo primero: es lo que hace que salga
// de la lista y no vuelva a aparecer mañana.
//
// EL TEXTO SOLO VA PUESTO SI ESTÁ COMPLETO. Si la plantilla de ese paso se puede
// rellenar entera con lo que el CRM sabe de esta persona, se abre con el mensaje
// escrito. Si le falta algún dato —el importe y el plan de pagos no los lleva el
// CRM, y siguen yendo [entre corchetes]— se abre el chat vacío y la gestora coge
// la plantilla del panel. Mandar un WhatsApp que dice «[importe]» es peor que no
// mandar nada.

import { useMemo, useState } from 'react';
import { WhatsappLogo, EnvelopeSimple, Check, CircleNotch } from '@phosphor-icons/react';
import { rellenar, huecosSinRellenar, type DatosParaRellenar } from '@/modules/whatsapp/lib/plantilla';
import type { PlantillaWhatsapp } from '@/modules/whatsapp/api/whatsapp.api';

/** Lo que hace falta de la fila. Sirve igual para la cola y para el repaso. */
export interface FilaAtendible {
  lead_id: number;
  lead_nombre: string | null;
  lead_email?: string | null;
  lead_telefono?: string | null;
  clave: string;
  producto: string | null;
  fecha_inicio_texto?: string | null;
  fecha_cierre_convocatoria?: string | null;
  proyecto: string | null;
}

/** El número, tal como lo quiere wa.me: solo dígitos. */
function soloDigitos(tel: string | null | undefined): string {
  return String(tel || '').replace(/[^0-9]/g, '');
}

export default function AccionesDeFila({
  fila,
  plantillas,
  onAtendido,
}: {
  fila: FilaAtendible;
  /** Todas las del ámbito; aquí se busca la del paso de esta fila. */
  plantillas: PlantillaWhatsapp[];
  /**
   * Se ha contactado por este canal.
   *
   * Lo apunta quien llama, que es quien sabe si la fila sale de la lista o se
   * queda. Aquí solo se dice que ha pasado.
   */
  onAtendido: (tipo: 'whatsapp' | 'email') => Promise<void> | void;
}) {
  const [enviando, setEnviando] = useState<'whatsapp' | 'email' | null>(null);
  const [hecho, setHecho] = useState(false);

  const datos: DatosParaRellenar = useMemo(() => ({
    nombre: fila.lead_nombre,
    email: fila.lead_email,
    telefono: fila.lead_telefono,
    producto: fila.producto,
    inicio: fila.fecha_inicio_texto,
    cierre: fila.fecha_cierre_convocatoria,
  }), [fila]);

  /**
   * El mensaje de este paso, solo si sale entero.
   *
   * `huecosSinRellenar` es la misma comprobación que hace el panel antes de
   * dejar copiar: así el botón rápido y el panel no pueden discrepar sobre si
   * un mensaje está listo.
   */
  const textoListo = useMemo(() => {
    const suya = plantillas.find((p) => (p as { paso_clave?: string | null }).paso_clave === fila.clave);
    if (!suya) return null;
    if (huecosSinRellenar(suya.body, datos, fila.proyecto).length > 0) return null;
    return rellenar(suya.body, datos, fila.proyecto);
  }, [plantillas, fila.clave, fila.proyecto, datos]);

  const tel = soloDigitos(fila.lead_telefono);

  async function atender(tipo: 'whatsapp' | 'email', destino: string) {
    setEnviando(tipo);
    // La ventana se abre ANTES de guardar: si el navegador ve que la apertura
    // no viene del clic --porque se ha esperado a una petición-- la bloquea, y
    // la gestora pulsa y no pasa nada.
    window.open(destino, '_blank', 'noopener,noreferrer');
    try {
      await onAtendido(tipo);
      setHecho(true);
    } finally {
      setEnviando(null);
    }
  }

  if (hecho) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
        <Check size={13} weight="bold" /> apuntado
      </span>
    );
  }

  const clase = 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border '
    + 'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground '
    + 'focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-40';

  return (
    <div className="flex shrink-0 items-center gap-1">
      {tel && (
        <button
          type="button"
          disabled={enviando !== null}
          title={textoListo
            ? 'WhatsApp con el mensaje del paso ya escrito'
            : 'Abrir WhatsApp (el mensaje del paso necesita datos que el CRM no tiene)'}
          aria-label={`WhatsApp a ${fila.lead_nombre || 'este prospecto'}`}
          className={clase}
          onClick={(e) => {
            e.stopPropagation();
            const url = 'https://wa.me/' + tel
              + (textoListo ? '?text=' + encodeURIComponent(textoListo) : '');
            atender('whatsapp', url);
          }}
        >
          {enviando === 'whatsapp'
            ? <CircleNotch size={14} className="animate-spin" />
            : <WhatsappLogo size={14} weight={textoListo ? 'fill' : 'regular'} />}
        </button>
      )}

      {fila.lead_email && (
        <button
          type="button"
          disabled={enviando !== null}
          title="Escribirle un correo"
          aria-label={`Correo a ${fila.lead_nombre || 'este prospecto'}`}
          className={clase}
          onClick={(e) => {
            e.stopPropagation();
            const asunto = fila.producto ? `Sobre ${fila.producto}` : 'Seguimiento';
            atender('email', `mailto:${fila.lead_email}?subject=${encodeURIComponent(asunto)}`);
          }}
        >
          {enviando === 'email'
            ? <CircleNotch size={14} className="animate-spin" />
            : <EnvelopeSimple size={14} />}
        </button>
      )}
    </div>
  );
}
