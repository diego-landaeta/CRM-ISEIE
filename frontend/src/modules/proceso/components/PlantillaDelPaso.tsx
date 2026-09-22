import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, WarningCircle, ImageSquare, EnvelopeSimple } from '@phosphor-icons/react';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { toast } from '@/shared/hooks/useToast';
import { whatsappApi, type PlantillaWhatsapp } from '@/modules/whatsapp/api/whatsapp.api';
import { rellenar, huecosSinRellenar, type DatosParaRellenar } from '@/modules/whatsapp/lib/plantilla';
import { emailTemplatesApi, type EmailTemplate } from '@/modules/email-templates/api/templates.api';

/**
 * El mensaje de ESTE paso, ya escrito, donde se trabaja (#88 · #89 · #90).
 *
 * Las plantillas del documento llevaban meses cargadas y el motor que las
 * rellena también, pero solo se llegaba a ellas desde el chat de WhatsApp: en
 * la cola del día y en la ficha no había ninguna. La gestora sabía que a esta
 * persona le tocaba el paso 2 y aun así tenía que ir a buscar el texto a otra
 * pantalla, o escribirlo de memoria.
 *
 * Lo que las ata al paso es `paso_clave` (migración 172), no el nombre: el
 * nombre lo lee una persona, la clave la entiende el CRM.
 *
 * SE COPIA, NO SE MANDA. El documento comercial es explícito —«Natural antes
 * que literal. La plantilla marca el orden; las palabras las pones tú»—, así
 * que aquí solo hay un botón de copiar. Si el CRM lo enviara solo, todos los
 * mensajes saldrían iguales y dejarían de funcionar.
 */
export default function PlantillaDelPaso({
  projectId,
  issuerId = null,
  pasoClave,
  datos,
  nombreProyecto,
  alCopiar,
  alCorreo,
  compacto = false,
}: {
  projectId: number | null;
  issuerId?: number | null;
  /** La clave del paso, no su nombre: el nombre se puede editar. */
  pasoClave: string;
  datos: DatosParaRellenar;
  nombreProyecto?: string | null;
  /** Se avisa al copiar, para que quien llame lo deje apuntado en su ficha. */
  alCopiar?: (plantilla: PlantillaWhatsapp, texto: string) => void;
  /**
   * Abrir el correo de este paso, ya elegido.
   *
   * Solo donde se puede escribir uno —la ficha—. Sin esto no se ofrece: en la
   * cola no hay ventana de correo y un boton que no lleva a ninguna parte es
   * peor que no tenerlo.
   */
  alCorreo?: (plantilla: EmailTemplate) => void;
  /** En la ficha hay menos sitio que en la cola. */
  compacto?: boolean;
}) {
  const [todas, setTodas] = useState<PlantillaWhatsapp[] | null>(null);
  // Cuál se acaba de copiar, para cambiarle el botón un momento. Sin esa
  // respuesta no se sabe si el clic ha hecho algo, y se copia dos veces.
  const [copiada, setCopiada] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    setTodas(null);
    whatsappApi.plantillas(projectId, issuerId)
      .then((r) => { if (vivo) setTodas(r?.success ? (r.data || []) : []); })
      // Si el CRM no lleva WhatsApp instalado, este endpoint no existe. No es
      // un error que haya que enseñar: sencillamente no hay plantillas.
      .catch(() => { if (vivo) setTodas([]); });
    return () => { vivo = false; };
  }, [projectId, issuerId]);

  useEffect(() => { setCopiada(null); }, [pasoClave, datos.nombre]);

  /**
   * El correo de este paso, si lo tiene.
   *
   * El proceso no es solo WhatsApp: el dia 1 manda el dossier por correo, y
   * los dias 3 y 4 llevan el suyo. Solo se pide donde se puede escribir uno.
   */
  const [correos, setCorreos] = useState<EmailTemplate[]>([]);
  // Del `alCorreo` solo interesa SI lo hay, no cual es: si se pusiera la
  // funcion en las dependencias, una flecha escrita en el JSX de quien llama
  // seria distinta en cada pintada y esto pediria los correos sin parar.
  const hayDondeEscribir = Boolean(alCorreo);
  useEffect(() => {
    if (!hayDondeEscribir || !projectId) { setCorreos([]); return; }
    let vivo = true;
    emailTemplatesApi.list(projectId, false)
      .then((r) => { if (vivo) setCorreos(r?.success ? (r.data || []) : []); })
      .catch(() => { if (vivo) setCorreos([]); });
    return () => { vivo = false; };
  }, [projectId, hayDondeEscribir]);

  const correoDelPaso = useMemo(
    () => correos.find((t) => t.paso_clave === pasoClave) || null,
    [correos, pasoClave],
  );

  const suyas = useMemo(
    () => (todas || [])
      .filter((p) => p.paso_clave === pasoClave)
      .sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.id - b.id),
    [todas, pasoClave],
  );

  async function copiar(p: PlantillaWhatsapp) {
    const texto = rellenar(p.body, datos, nombreProyecto);
    const ok = await copyToClipboard(texto);
    if (!ok) {
      toast({
        title: 'No se ha podido copiar',
        description: 'Selecciona el texto y cópialo a mano.',
        variant: 'destructive',
      });
      return;
    }
    setCopiada(p.id);
    setTimeout(() => setCopiada((x) => (x === p.id ? null : x)), 2000);
    toast({ title: 'Copiado', description: 'Pégalo y ajústalo antes de mandarlo.' });
    alCopiar?.(p, texto);
  }

  if (todas === null) return null;

  // El correo del paso va debajo de los mensajes, y tambien cuando no hay
  // ninguno: hay pasos que son solo correo.
  const elCorreo = correoDelPaso && alCorreo ? (
    <button
      type="button"
      onClick={() => alCorreo(correoDelPaso)}
      className="flex w-full items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-[11px] font-semibold hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40"
    >
      <EnvelopeSimple size={13} weight="bold" className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">Escribir el correo: {correoDelPaso.name}</span>
    </button>
  ) : null;

  // Un paso sin plantilla no pinta una caja vacía: dice dónde se crea y ya.
  if (suyas.length === 0) {
    if (elCorreo) return <div className="space-y-2">{elCorreo}</div>;
    if (compacto) return null;
    return (
      <p className="text-secundario text-muted-foreground">
        Este paso no tiene mensaje guardado.{' '}
        <Link to="/whatsapp/plantillas" className="text-primary hover:underline">
          Escribir uno
        </Link>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {suyas.map((p, i) => {
        const texto = rellenar(p.body, datos, nombreProyecto);
        const huecos = huecosSinRellenar(p.body, datos, nombreProyecto);
        return (
          <div key={p.id} className="rounded-md border border-border bg-muted/30">
            <div className="flex items-start justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
              <p className="min-w-0 truncate text-[11px] font-semibold">
                {/* Los días 2 y 3 son TRES mensajes seguidos, no uno largo, y
                    el orden es parte de la instrucción. */}
                {suyas.length > 1 && (
                  <span className="mr-1 tabular-nums text-muted-foreground">{i + 1} de {suyas.length}</span>
                )}
                {p.label}
              </p>
              <button
                type="button"
                onClick={() => copiar(p)}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-card px-2 py-1 text-[11px] font-semibold hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40"
              >
                {copiada === p.id
                  ? <><Check size={12} weight="bold" className="text-success" /> Copiado</>
                  : <><Copy size={12} weight="bold" /> Copiar</>}
              </button>
            </div>

            <p className="whitespace-pre-wrap px-2.5 py-2 text-[12px] leading-snug">{texto}</p>

            {/* La letra pequeña del documento: se lee mientras se elige y NO se
                manda. Antes solo estaba en el PDF, que nadie tiene abierto. */}
            {(p.pista || p.pide_adjunto) && (
              <p className="flex items-start gap-1 px-2.5 pb-1.5 text-[11px] text-muted-foreground">
                {p.pide_adjunto && <ImageSquare size={11} weight="bold" className="mt-0.5 shrink-0" />}
                {p.pista}
              </p>
            )}

            {/* Con icono además del color: un texto ámbar a secas no lo
                distingue quien no ve bien el color. */}
            {huecos.length > 0 && (
              <p className="flex items-start gap-1 px-2.5 pb-2 text-[11px] font-medium text-warning-soft-foreground">
                <WarningCircle size={12} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>Falta {huecos.map((h) => `{${h}}`).join(', ')} — complétalo antes de mandarlo</span>
              </p>
            )}
          </div>
        );
      })}
      {elCorreo}
    </div>
  );
}
