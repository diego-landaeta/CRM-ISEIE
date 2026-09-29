import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, CaretRight, CaretLeft, Check, ArrowSquareOut, Warning } from '@phosphor-icons/react';
import { inputClass } from '@/shared/lib/ui';
import { cn } from '@/shared/lib/utils';
import Field from '@/shared/components/ui/Field';
import { iconoDeCanal, nombreDeCanal } from '../lib/canales';
import { tipoDeInteraccion } from '../lib/cola';
import PlantillaDelPaso from './PlantillaDelPaso';
import HistorialCorto from './HistorialCorto';
import type { PasoEnCola } from '../api/agenda.api';

/**
 * Uno de la cola, a solas (#90).
 *
 * «"Siguiente" para encadenar sin volver a la lista.» Antes, pulsar a alguien
 * te sacaba a su ficha: se hacía uno, se volvía atrás, se buscaba por dónde
 * ibas. Aquí no se sale de la cola — se pasa al siguiente y ya.
 *
 * TRES COSAS A LA VISTA MIENTRAS SE ESCRIBE, que es cuando hacen falta: por qué
 * canal se intenta primero, la chuleta del paso, y cuántos contactos lleva.
 *
 * Y NO HAY BOTÓN DE «HECHO». Lo que se apunta es el contacto —una llamada, un
 * WhatsApp—, y el paso se cierra solo porque el servidor lo deduce de cuántos
 * contactos lleva la persona. Un plan que hay que mantener a mano acaba
 * mintiendo; este se mantiene con el trabajo de verdad.
 */
export default function PanelDeCola({
  fila,
  posicion,
  total,
  guardando,
  textoUrgencia,
  onContactado,
  onPlantillaCopiada,
  historialAbierto = false,
  onAlternarHistorial,
  onAnterior,
  onSiguiente,
  onCerrar,
}: {
  fila: PasoEnCola;
  /** 1-based, para poder decir «3 de 47» sin que nadie reste. */
  posicion: number;
  total: number;
  guardando: boolean;
  /**
   * La frase de arriba, cuando no vale la de la cola.
   *
   * En la cola es «le tocaba hace tres dias»; en el repaso de fin de mes eso no
   * significa nada --alli no hay fecha prevista-- y lo que importa es cuanto
   * lleva sin noticias. Se deja decir desde fuera en vez de calcular dos cosas
   * distintas aqui dentro.
   */
  textoUrgencia?: string;
  onContactado: (tipo: 'llamada' | 'email' | 'whatsapp' | 'nota', nota: string) => void;
  /**
   * Si el historial esta desplegado.
   *
   * Lo decide quien llama y no el panel: asi se queda abierto al pasar a la
   * siguiente persona. Quien lo mira una vez lo suele querer en todas, y
   * volver a pulsarlo veinte veces seria peor que no tenerlo.
   */
  historialAbierto?: boolean;
  onAlternarHistorial?: () => void;
  /** Copiar el mensaje deja rastro en su ficha, pero NO cierra el paso. */
  onPlantillaCopiada?: (nombrePlantilla: string) => void;
  onAnterior: () => void;
  onSiguiente: () => void;
  onCerrar: () => void;
}) {
  const canales = fila.canales || [];
  // El primero del paso es por donde toca intentarlo: el orden es media
  // instrucción, así que también manda aquí.
  const [canal, setCanal] = useState<string>(canales[0] ?? 'nota');
  const [nota, setNota] = useState('');

  // Al cambiar de persona se empieza limpio: arrastrar la nota del anterior es
  // como se apunta una llamada en la ficha equivocada.
  useEffect(() => {
    setCanal((fila.canales || [])[0] ?? 'nota');
    setNota('');
  }, [fila.lead_id]);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  const tarde = fila.dias_de_retraso > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${fila.lead_nombre || 'Sin nombre'}, ${posicion} de ${total}`}
      className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onCerrar} aria-hidden="true" />

      <div className="relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-none border border-border bg-card shadow-dialog sm:max-w-lg sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border p-tarjeta">
          <div className="min-w-0">
            <h2 className="text-seccion truncate">{fila.lead_nombre || 'Sin nombre'}</h2>
            <p className="mt-0.5 text-secundario text-muted-foreground">
              Seguimiento {fila.orden} · {fila.paso_nombre || fila.clave}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-secundario tabular-nums text-muted-foreground">{posicion} de {total}</span>
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <X size={18} weight="bold" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-tarjeta overflow-y-auto p-tarjeta">
          {textoUrgencia ? (
            <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-secundario">
              <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>{textoUrgencia}</span>
            </p>
          ) : tarde && (
            <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-secundario text-warning-soft-foreground">
              <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                Le tocaba {fila.dias_de_retraso === 1 ? 'ayer' : `hace ${fila.dias_de_retraso} días`}.
                {' '}
                {fila.contactos === 0
                  ? 'No se le ha contactado todavía.'
                  : `Lleva ${fila.contactos} ${fila.contactos === 1 ? 'contacto' : 'contactos'}.`}
              </span>
            </p>
          )}

          {/* La chuleta del paso. A la vista mientras se escribe, que es cuando
              hace falta: «el 5 % solo aplica en máster y diplomado». */}
          {fila.paso_nota && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Para este paso</p>
              <p className="mt-0.5 text-normal">{fila.paso_nota}</p>
            </div>
          )}

          {/* QUE HA PASADO YA CON ESTA PERSONA. Diego, 24/09: «le añadiria el
              historial que tiene tambien como apoyo, sin tener que ver la
              ficha entera». Va plegado: lo primero del panel sigue siendo el
              mensaje del paso. */}
          {onAlternarHistorial && (
            <HistorialCorto
              leadId={fila.lead_id}
              abierto={historialAbierto}
              onAlternar={onAlternarHistorial}
            />
          )}

          {/* El mensaje que toca, ya escrito y con sus datos puestos. Es lo
              que hace que la cola sirva para trabajar y no solo para saber a
              quién llamar: antes había que ir al chat a buscar el texto.

              Se copia. No se manda: «la plantilla marca el orden; las palabras
              las pones tú». */}
          <Field
            label="El mensaje de este paso"
            hint="Se copia para pegarlo y ajustarlo. El CRM no lo envía."
          >
            {/* Las plazas NO las lleva el CRM: las lleva admisiones, y de dos
                contabilidades de lo mismo solo una puede tener razón. Por eso
                el mensaje deja el hueco y aquí va el recordatorio, que es lo
                que decidió Diego el 11/09. */}
            {fila.avisa_plazas && (
              <p className="mb-1.5 rounded border border-warning/30 bg-warning-soft px-2 py-1 text-[11px] font-medium text-warning-soft-foreground">
                Comprueba cuántas plazas quedan antes de enviarlo. No las lleva el CRM.
              </p>
            )}
            <PlantillaDelPaso
              projectId={fila.project_id}
              pasoClave={fila.clave}
              nombreProyecto={fila.proyecto}
              datos={{
                nombre: fila.lead_nombre,
                email: fila.lead_email ?? null,
                telefono: fila.lead_telefono ?? null,
                producto: fila.producto,
                inicio: fila.fecha_inicio_texto ?? null,
                cierre: fila.fecha_cierre_convocatoria ?? null,
              }}
              alCopiar={(p) => onPlantillaCopiada?.(p.label)}
            />
          </Field>

          <Field
            label="Por dónde lo has intentado"
            hint={canales.length > 1
              ? `El paso dice ${nombreDeCanal(canales[0])} primero; si no, el siguiente.`
              : 'Es lo que queda apuntado en su ficha.'}
          >
            <ol className="flex flex-wrap items-center gap-1.5" aria-label="Canales, en orden">
              {(canales.length > 0 ? canales : ['nota']).map((c, i) => {
                const Icono = iconoDeCanal(c);
                const elegido = c === canal;
                return (
                  <li key={c} className="flex items-center gap-1.5">
                    {i > 0 && <CaretRight size={10} weight="bold" className="text-muted-foreground/50" />}
                    <button
                      type="button"
                      onClick={() => setCanal(c)}
                      aria-pressed={elegido}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-normal transition-colors',
                        'focus:outline-none focus:ring-2 focus:ring-ring/40',
                        elegido
                          ? 'border-primary bg-primary/10 font-semibold text-primary'
                          : 'border-border hover:bg-muted',
                      )}
                    >
                      {Icono && <Icono size={13} />} {nombreDeCanal(c)}
                    </button>
                  </li>
                );
              })}
            </ol>
          </Field>

          <Field
            label="Qué ha pasado"
            htmlFor="cola-nota"
            hint="Opcional. Queda en su historial, y es lo que lee quien la coja mañana."
          >
            <textarea
              id="cola-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              placeholder="No coge el teléfono, le dejo un WhatsApp…"
              className={cn(inputClass, 'h-auto py-2')}
            />
          </Field>

          <Link
            to={`/leads/${fila.lead_id}`}
            className="inline-flex items-center gap-1.5 text-normal text-primary hover:underline"
          >
            <ArrowSquareOut size={14} /> Abrir su ficha entera
          </Link>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-tarjeta">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAnterior}
              disabled={posicion <= 1}
              aria-label="Anterior"
              className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <CaretLeft size={15} weight="bold" />
            </button>
            {/* «Siguiente» sin apuntar nada: no siempre se consigue hablar, y
                obligar a registrar algo para poder pasar de largo es como se
                empiezan a apuntar contactos que no existen. */}
            <button
              type="button"
              onClick={onSiguiente}
              disabled={posicion >= total}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-normal font-semibold hover:bg-muted disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              Siguiente <CaretRight size={14} weight="bold" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onContactado(tipoDeInteraccion(canal), nota.trim())}
            disabled={guardando}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-normal font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <Check size={15} weight="bold" />
            {guardando ? 'Apuntando…' : 'Contactado, al siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
