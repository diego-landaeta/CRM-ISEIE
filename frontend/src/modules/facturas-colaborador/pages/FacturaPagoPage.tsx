import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, Star } from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';
import {
  FORMA_PAGO_ES, diaDelPago, euros, facturasColaboradorApi, type PagoDelColaborador,
} from '../api/facturasColaborador.api';

/**
 * «He recibido el pago y lo confirmo» (Diego, 04/11): la página del botón del
 * correo de «Factura pagada». Sin usuario ni contraseña: el enlace firmado es la
 * llave, y solo sirve para el pago de esa factura.
 *
 * Abrirla NO confirma nada (Diego, 04/11): los antivirus y filtros de correo de
 * las empresas abren los enlaces solos y lo confirmarían sin que la persona lo
 * vea. La página enseña la factura y el botón; la confirmación va al pulsarlo
 * (POST), una sola vez. Después, si quiere, su opinión: de 1 a 5 y un
 * comentario, también una sola vez.
 */
export default function FacturaPagoPage() {
  const { token = '' } = useParams();
  const [pago, setPago] = useState<PagoDelColaborador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [valoracion, setValoracion] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorOpinion, setErrorOpinion] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [errorConfirmar, setErrorConfirmar] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        // Solo mirar: confirmar es pulsar el botón.
        const visto = (await facturasColaboradorApi.verPago(token)).data;
        if (vivo) setPago(visto);
      } catch (err: any) {
        if (vivo) setError(err?.data?.error || err?.message || 'Este enlace no existe o ya no es válido');
      }
    })();
    return () => { vivo = false; };
  }, [token]);

  async function confirmar() {
    setConfirmando(true);
    setErrorConfirmar(null);
    try {
      setPago((await facturasColaboradorApi.confirmarPago(token)).data);
    } catch (err: any) {
      setErrorConfirmar(err?.data?.error || err?.message || 'No se ha podido confirmar. Prueba otra vez.');
    } finally {
      setConfirmando(false);
    }
  }

  async function opinar() {
    setEnviando(true);
    setErrorOpinion(null);
    try {
      setPago((await facturasColaboradorApi.opinarDelPago(token, valoracion, comentario.trim())).data);
    } catch (err: any) {
      setErrorOpinion(err?.data?.error || err?.message || 'No se ha podido guardar. Prueba otra vez.');
    } finally {
      setEnviando(false);
    }
  }

  const dia = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4">
      <main className="w-full max-w-xl bg-card border border-border rounded-xl shadow-sm p-5 sm:p-6 space-y-5">
        {pago?.marca && (
          <div className="flex items-center gap-2 text-secundario text-muted-foreground">
            {pago.marca.logo_url
              ? <img src={pago.marca.logo_url} alt={pago.marca.nombre} className="max-h-8 max-w-[180px]" />
              : <span className="font-semibold">{pago.marca.nombre}</span>}
          </div>
        )}
        {error ? (
          <p role="alert" className="rounded-md bg-destructive-soft text-destructive-soft-foreground px-3 py-2">{error}</p>
        ) : !pago ? (
          <p className="text-muted-foreground">Cargando…</p>
        ) : !pago.confirmado_at ? (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">Tu factura está pagada</h1>
            <p>
              Hola, {pago.colaborador}. {pago.empresa} ha pagado tu factura de {pago.mes}
              {pago.importe !== null ? <> · <strong className="tabular-nums">{euros(pago.importe, pago.moneda)}</strong></> : null}.
            </p>
            <p className="text-secundario text-muted-foreground">
              {pago.forma_pago ? FORMA_PAGO_ES[pago.forma_pago] : 'Pago'} del {diaDelPago(pago.pagada_at)}
              {pago.numero_factura ? ` · factura ${pago.numero_factura}` : ''}
            </p>
            <p>Cuando lo veas en tu cuenta, confírmalo:</p>
            {errorConfirmar && <p role="alert" className="text-destructive text-secundario">{errorConfirmar}</p>}
            <Button onClick={confirmar} disabled={confirmando}>
              {confirmando ? 'Confirmando…' : 'He recibido el pago y lo confirmo'}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <CheckCircle size={32} weight="fill" className="text-success shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <h1 className="text-xl font-semibold">Pago confirmado</h1>
                <p>
                  Gracias, {pago.colaborador}. Has confirmado que recibiste el pago de tu factura de {pago.mes} para {pago.empresa}
                  {pago.importe !== null ? <> · <strong className="tabular-nums">{euros(pago.importe, pago.moneda)}</strong></> : null}.
                </p>
                <p className="text-secundario text-muted-foreground">
                  {pago.forma_pago ? FORMA_PAGO_ES[pago.forma_pago] : 'Pago'} del {diaDelPago(pago.pagada_at)}
                  {pago.numero_factura ? ` · factura ${pago.numero_factura}` : ''}
                  {pago.confirmado_at ? ` · confirmado el ${dia(pago.confirmado_at)}` : ''}
                </p>
              </div>
            </div>

            {pago.opinion ? (
              <p className="rounded-md bg-success-soft text-success-soft-foreground px-3 py-2">
                Gracias por tu opinión{pago.opinion.valoracion ? ` (${pago.opinion.valoracion} de 5)` : ''}.
              </p>
            ) : (
              <section className="space-y-3 border-t border-border pt-4" aria-labelledby="opinion-titulo">
                <h2 id="opinion-titulo" className="font-semibold">¿Qué tal ha ido? <span className="font-normal text-muted-foreground">(opcional)</span></h2>
                <div role="radiogroup" aria-label="Valoración de 1 a 5" className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={valoracion === n} aria-label={`${n} de 5`}
                      onClick={() => setValoracion(valoracion === n ? null : n)}
                      className="p-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Star size={28} weight={valoracion !== null && n <= valoracion ? 'fill' : 'regular'}
                        className={valoracion !== null && n <= valoracion ? 'text-warning' : 'text-muted-foreground'} />
                    </button>
                  ))}
                </div>
                <label className="block space-y-1">
                  <span className="text-secundario">Comentario</span>
                  <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={1000} rows={3}
                    placeholder="Cuéntanos lo que quieras: si llegó a tiempo, si algo se puede mejorar…"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
                {errorOpinion && <p role="alert" className="text-destructive text-secundario">{errorOpinion}</p>}
                <Button onClick={opinar} disabled={enviando || (!valoracion && !comentario.trim())}>
                  {enviando ? 'Enviando…' : 'Enviar mi opinión'}
                </Button>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
