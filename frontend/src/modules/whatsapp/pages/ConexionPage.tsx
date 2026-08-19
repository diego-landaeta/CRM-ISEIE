import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  WhatsappLogo, QrCode, CheckCircle, WarningCircle, ArrowClockwise,
  SignOut, DeviceMobile, ArrowsClockwise, X,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { chatApi, type ConexionWhatsapp } from '../api/whatsapp.api';
// Los paneles comparten aspecto con los del chat: es la misma pantalla.
import './chat.css';

// Conectar TU numero de WhatsApp al CRM.
//
// Cada persona enlaza el suyo y solo ve sus conversaciones. No hay un WhatsApp
// del CRM compartido: lo habia, y significaba que quien lo enlazara dejaba sus
// chats privados a la vista de todos los demas usuarios.
//
// Pensada para que quien enlaza no tenga que saber nada: pulsa un boton, sale
// un codigo, lo escanea y ya. Si el codigo caduca se renueva solo, si algo va
// mal lo dice, y para desvincular hay un boton en vez de tener que buscarlo en
// los ajustes del movil.

// WhatsApp caduca el codigo cada 20 segundos. Se pide uno nuevo antes de que
// eso pase: si no, la persona escanea un codigo muerto y no entiende por que
// no funciona.
const RENUEVA_QR_MS = 18000;

export default function ConexionPage() {
  const [estado, setEstado] = useState<ConexionWhatsapp | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [reintento, setReintento] = useState(0);
  // El aviso de confirmacion, dentro de la pantalla. Era un window.confirm: una
  // caja del sistema operativo, con la tipografia del navegador y encima de
  // todo. Ademas hay navegadores que las bloquean y la accion se perdia sin que
  // nadie se enterase.
  const [confirmando, setConfirmando] = useState(false);
  // Cuanto historial traer. Por defecto lo rapido: con «todo», un numero de
  // anos manda decenas de miles de mensajes por tandas y la pantalla tarda un
  // buen rato en estar usable, que es justo la queja de siempre.
  const [modo, setModo] = useState<'cero' | 'rapido' | 'todo'>('rapido');
  const [sync, setSync] = useState<{ conversaciones: number; mensajes: number; entrando: boolean; adjuntosPendientes: number } | null>(null);
  const buscandoQR = useRef(false);

  const mirar = useCallback(async () => {
    try {
      const r = await chatApi.conexion();
      if (r.success) {
        setEstado(r.data);
        if (r.data.conectado) { setQr(null); buscandoQR.current = false; }
      }
    } catch { /* la pantalla ya dice que no hay conexion */ }
  }, []);

  useEffect(() => {
    mirar();
    const t = setInterval(mirar, qr ? 2500 : 12000);
    return () => clearInterval(t);
  }, [mirar, qr]);

  // Mientras esta conectado, se vigila cuanto lleva entrando.
  useEffect(() => {
    if (!estado?.conectado) return undefined;
    const leer = () => chatApi.sincronizacion().then((r) => { if (r.success) setSync(r.data); }).catch(() => {});
    leer();
    const t = setInterval(leer, 4000);
    return () => clearInterval(t);
  }, [estado?.conectado]);

  // Pedir el codigo, insistiendo.
  //
  // Antes, cualquier tropiezo salia como un error rojo: si el servidor estaba
  // reiniciando, o WhatsApp tardaba un segundo de mas en dar el codigo, quien
  // estaba enlazando veia «No se pudo emparejar» y se quedaba sin saber que
  // hacer, cuando bastaba con volver a pulsar. Ahora se reintenta solo y solo
  // se avisa si de verdad no hay manera.
  const pedirQR = useCallback(async (silencioso = false) => {
    if (!silencioso) { setPidiendo(true); setReintento(0); }
    const INTENTOS = 3;
    let ultimo = '';
    try {
      for (let n = 1; n <= INTENTOS; n++) {
        try {
          const r = await client.post('/whatsapp/emparejar', { modo });
          if (!r.success) throw new Error(r.error || 'No se pudo pedir el codigo');
          if (r.data?.qr) { setQr(r.data.qr); buscandoQR.current = true; return; }
          await mirar();
          return;
        } catch (e) {
          ultimo = (e as Error).message;
          if (n < INTENTOS) {
            if (!silencioso) setReintento(n);
            await new Promise((espera) => setTimeout(espera, 2000 * n));
          }
        }
      }
      if (!silencioso) {
        toast({ title: 'No se pudo emparejar', description: ultimo, variant: 'destructive' });
      }
    } finally { if (!silencioso) { setPidiendo(false); setReintento(0); } }
  }, [mirar, modo]);

  // Renovar el codigo antes de que caduque, mientras nadie lo haya escaneado.
  useEffect(() => {
    if (!qr || estado?.conectado) return undefined;
    const t = setInterval(() => pedirQR(true), RENUEVA_QR_MS);
    return () => clearInterval(t);
  }, [qr, estado?.conectado, pedirQR]);

  async function desconectar() {
    setConfirmando(false);
    setCerrando(true);
    try {
      const r = await client.post('/whatsapp/desconectar', {});
      // Si ya no habia sesion, el resultado es el que se buscaba: no es un
      // fallo que haya que enseñar en rojo.
      if (!r.success && !/no.*sesion|sin sesion|not.*connect/i.test(r.error || '')) {
        throw new Error(r.error || 'No se pudo desconectar');
      }
      toast({ title: 'Numero desvinculado', description: 'Ya no aparece en «Dispositivos vinculados» del movil.' });
      setQr(null);
      await mirar();
    } catch (e) {
      toast({ title: 'No se pudo desconectar', description: (e as Error).message, variant: 'destructive' });
    } finally { setCerrando(false); }
  }

  const conectado = estado?.conectado;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start gap-3">
          <WhatsappLogo size={32} weight="duotone" className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold">Tu WhatsApp</h1>
            <p className="text-sm text-muted-foreground">
              Tu numero, tus conversaciones. Cada persona del equipo enlaza el suyo
              y nadie mas ve lo tuyo.
            </p>
          </div>
          <button type="button" onClick={mirar} title="Comprobar ahora"
            className="p-2 rounded-md hover:bg-muted text-muted-foreground">
            <ArrowClockwise size={16} />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm">
          {estado === null ? (
            <span className="text-muted-foreground">Comprobando…</span>
          ) : !estado.configurado ? (
            <>
              <WarningCircle size={18} weight="fill" className="text-amber-500 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400">{estado.motivo}</span>
            </>
          ) : conectado ? (
            <>
              <CheckCircle size={18} weight="fill" className="text-emerald-600 shrink-0" />
              <span>
                Conectado como{' '}
                <strong>{estado.nombre || (estado.numero ? `+${estado.numero}` : estado.instancia)}</strong>
              </span>
            </>
          ) : (
            <>
              <WarningCircle size={18} weight="fill" className="text-amber-500 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400">
                Todavia no has enlazado tu numero.
              </span>
            </>
          )}
        </div>

        {estado?.configurado && !conectado && !qr && (
          <div className="mt-4">
            <p className="text-sm font-semibold mb-2">¿Cuanto quieres traerte del movil?</p>
            <div className="grid gap-2">
              {([
                { id: 'rapido', titulo: 'Lo reciente', pie: 'Listo en segundos. Las conversaciones de los ultimos meses.' },
                { id: 'cero', titulo: 'Empezar de cero', pie: 'Sin nada del pasado. Solo lo que llegue a partir de ahora.' },
                { id: 'todo', titulo: 'Todo el historial', pie: 'Todo lo que tenga el movil. Puede tardar bastante y llega por tandas.' },
              ] as const).map((o) => (
                <label key={o.id}
                  className={`flex gap-2.5 items-start p-2.5 rounded-md border cursor-pointer ${
                    modo === o.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border hover:bg-muted/50'}`}>
                  <input type="radio" name="modo" checked={modo === o.id}
                    onChange={() => setModo(o.id)} className="mt-0.5" />
                  <span className="text-sm leading-tight">
                    <strong>{o.titulo}</strong>
                    <span className="block text-xs text-muted-foreground mt-0.5">{o.pie}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {estado?.configurado && !conectado && (
            <button type="button" onClick={() => pedirQR()} disabled={pidiendo}
              className="h-9 px-3 rounded-md bg-emerald-600 text-white text-sm font-semibold inline-flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50">
              <QrCode size={16} weight="bold" />
              {pidiendo
                ? (reintento ? `Reintentando (${reintento} de 3)…` : 'Pidiendo codigo…')
                : qr ? 'Pedir otro codigo' : 'Enlazar mi numero'}
            </button>
          )}
          {conectado && (
            <button type="button" onClick={() => setConfirmando(true)} disabled={cerrando}
              className="h-9 px-3 rounded-md border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 text-sm font-semibold inline-flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
              <SignOut size={16} weight="bold" />
              {cerrando ? 'Desvinculando…' : 'Desvincular mi numero'}
            </button>
          )}
        </div>
      </div>

      {qr && !conectado && (
        <div className="bg-card border border-border rounded-lg p-5 text-center">
          <h2 className="font-semibold mb-3 flex items-center justify-center gap-2">
            <DeviceMobile size={18} weight="duotone" /> Escanea con el movil de tu numero
          </h2>
          <ol className="text-sm text-muted-foreground mb-4 inline-block text-left leading-relaxed">
            <li><strong>1.</strong> Abre WhatsApp</li>
            <li><strong>2.</strong> Ajustes → <strong>Dispositivos vinculados</strong></li>
            <li><strong>3.</strong> <strong>Vincular un dispositivo</strong> y apunta aqui</li>
          </ol>
          <div className="grid place-items-center">
            <img src={qr} alt="Codigo QR de WhatsApp" className="w-64 h-64 rounded-lg bg-white p-2" />
          </div>
          <p className="text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1.5">
            <ArrowsClockwise size={12} className="animate-spin" />
            El codigo se renueva solo cada 18 segundos. No hace falta hacer nada.
          </p>
        </div>
      )}

      {conectado && (
        <div className="bg-card border border-border rounded-lg p-5 text-sm space-y-3">
          {sync?.entrando ? (
            <>
              <p className="font-semibold flex items-center gap-2">
                <ArrowsClockwise size={16} className="animate-spin text-emerald-600" />
                Trayendo las conversaciones…
              </p>
              <p className="text-muted-foreground">
                {sync.conversaciones} chats y {sync.mensajes} mensajes hasta ahora.
                WhatsApp los manda por tandas: puede tardar unos minutos.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Todo listo</p>
              <p className="text-muted-foreground">
                {sync ? `${sync.conversaciones} chats · ${sync.mensajes} mensajes.` : ''}
                {' '}Las conversaciones nuevas aparecen solas y se atan al prospecto que tenga ese telefono.
                Solo las ves tu.
              </p>
            </>
          )}
          {(sync?.adjuntosPendientes ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              Descargando {sync?.adjuntosPendientes} archivos en segundo plano.
            </p>
          )}
          <Link to="/whatsapp/chat" className="text-primary hover:underline font-medium inline-block">
            Ir al chat →
          </Link>
        </div>
      )}

      {confirmando && (
        <div className="wa-velo" onClick={() => setConfirmando(false)}>
          <div className="wa-panel" onClick={(e) => e.stopPropagation()}>
            <div className="wa-panel-cabecera">
              <span>Desvincular tu numero</span>
              <button type="button" onClick={() => setConfirmando(false)} className="wa-panel-cerrar">
                <X size={15} />
              </button>
            </div>
            <div className="wa-panel-cuerpo">
              <p className="wa-panel-nota">
                El CRM dejara de recibir y de enviar mensajes con{' '}
                <strong>{estado?.nombre || (estado?.numero ? `+${estado.numero}` : 'tu numero')}</strong>,
                y desaparecera de «Dispositivos vinculados» en tu movil.
              </p>
              <p className="wa-panel-nota">
                Las conversaciones que ya estan guardadas <strong>se quedan</strong>. Puedes
                volver a enlazar cuando quieras.
              </p>
            </div>
            <div className="wa-panel-pie">
              <button type="button" onClick={() => setConfirmando(false)} className="wa-btn-suave">Cancelar</button>
              <button type="button" onClick={desconectar} className="wa-btn-rojo">Desvincular</button>
            </div>
          </div>
        </div>
      )}

      {/* No es burocracia: es tu linea, y si WhatsApp la suspende pierdes
          tambien tus conversaciones personales. */}
      <div className="border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-4 text-sm">
        <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">Antes de enlazar</p>
        <ul className="text-amber-800 dark:text-amber-300/90 space-y-1 leading-relaxed">
          <li>· Mejor un numero <strong>de trabajo</strong>. Al enlazar se descarga a la base del CRM lo que ese movil tenga guardado — solo lo ves tu, pero queda en el servidor de la empresa.</li>
          <li>· Es <strong>tu sesion</strong>: nadie mas del equipo ve estas conversaciones, ni un administrador desde esta pantalla.</li>
          <li>· El CRM se niega a escribir a quien no dejo su telefono en un formulario. Es lo que evita los bloqueos.</li>
          <li>· Si alguien pide que no le escribas, marcalo en el chat y no se le vuelve a escribir.</li>
          <li>· Los topes de ritmo son <strong>por numero</strong>: lo que mande un companero no te frena a ti.</li>
        </ul>
      </div>
    </div>
  );
}
