import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, WarningCircle, ImageSquare } from '@phosphor-icons/react';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { toast } from '@/shared/hooks/useToast';
import { whatsappApi, type PlantillaWhatsapp } from '@/modules/whatsapp/api/whatsapp.api';
import { rellenar, huecosSinRellenar, type DatosParaRellenar } from '@/modules/whatsapp/lib/plantilla';

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

  // Un paso sin plantilla no pinta una caja vacía: dice dónde se crea y ya.
  if (suyas.length === 0) {
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
    </div>
  );
}
