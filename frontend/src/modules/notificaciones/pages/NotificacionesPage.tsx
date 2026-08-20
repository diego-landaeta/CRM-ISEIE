import { Link } from 'react-router-dom';
import { useState } from 'react';
import PageHeader from '@/shared/components/ui/PageHeader';
import SpamReportsSection from '../components/SpamReportsSection';
import NotificationsList from '../components/NotificationsList';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import {
  Bell, BellRinging, BellSlash, EnvelopeSimple, DeviceMobile, ChatCircle,
  CheckCircle, WarningCircle, MoonStars, Lightning, ShieldCheck,
} from '@phosphor-icons/react';
import { useNotifications } from '../hooks/useNotifications';
import { KIND_META, type NotificationKind, type NotificationChannel } from '../lib/preferences';

const CHANNEL_META: Record<NotificationChannel, { label: string; Icon: typeof Bell; help: string }> = {
  inApp: { label: 'En la app', Icon: ChatCircle, help: 'Toast + campana' },
  push: { label: 'Push', Icon: DeviceMobile, help: 'Notificación del sistema' },
  email: { label: 'Email', Icon: EnvelopeSimple, help: 'Vía Brevo (pendiente backend)' },
};

export default function NotificacionesPage() {
  const {
    permission, isSupported, isPushSupported, isSubscribed,
    prefs, requestPermission, subscribe, unsubscribe, showLocal, updatePrefs,
  } = useNotifications();
  const [savingPrefs, setSavingPrefs] = useState(false);

  async function handleEnable() {
    const result = await requestPermission();
    if (result === 'granted') {
      const ok = await subscribe();
      if (ok) toast({ title: 'Notificaciones activadas', description: 'Recibirás alertas según tus preferencias.' });
    } else if (result === 'denied') {
      toast({
        title: 'Permiso denegado',
        description: 'Ve a la configuración del navegador para volver a habilitarlas.',
        variant: 'destructive',
      });
    }
  }

  async function handleDisable() {
    await unsubscribe();
    toast({ title: 'Notificaciones desactivadas' });
  }

  function handleTest() {
    if (permission !== 'granted') {
      toast({ title: 'Activa primero las notificaciones', variant: 'destructive' });
      return;
    }
    showLocal('CRM ISEIE — Notificación de prueba', {
      body: 'Si ves esto, tu navegador está listo para recibir alertas push.',
      tag: 'test',
    });
    toast({ title: 'Notificación enviada', description: 'Si no la ves, revisa permisos del navegador.' });
  }

  function toggleKind(kind: NotificationKind) {
    setSavingPrefs(true);
    updatePrefs({ ...prefs, enabled: { ...prefs.enabled, [kind]: !prefs.enabled[kind] } });
    setTimeout(() => setSavingPrefs(false), 300);
  }

  function toggleChannel(kind: NotificationKind, channel: NotificationChannel) {
    const current = prefs.channels[kind] || [];
    const next = current.includes(channel)
      ? current.filter(c => c !== channel)
      : [...current, channel];
    updatePrefs({ ...prefs, channels: { ...prefs.channels, [kind]: next } });
  }

  function toggleDoNotDisturb() {
    updatePrefs({ ...prefs, doNotDisturb: !prefs.doNotDisturb });
    toast({ title: prefs.doNotDisturb ? 'Modo "no molestar" desactivado' : 'Modo "no molestar" activado' });
  }

  if (!isSupported) {
    return (
      <div className="space-y-6 pb-8">
        <PageHeader title="Centro de notificaciones" />
        <EmptyState
          icon={WarningCircle}
          title="Tu navegador no soporta notificaciones"
          description="Las notificaciones del navegador requieren un browser moderno con soporte de Notifications API. Edge, Chrome y Firefox actualizados funcionan."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Centro de notificaciones"
        subtitle="Configura cómo quieres recibir alertas del CRM"
        actions={
          <button
            type="button"
            onClick={handleTest}
            disabled={permission !== 'granted'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <Lightning size={14} weight="bold" /> Probar
          </button>
        }
      />

      {/* Listado completo de notificaciones (lo que abre "Ver todas"). */}
      <NotificationsList />

      <SpamReportsSection />

      <section
        className={`border rounded-2xl p-5 flex items-start gap-4 ${
          permission === 'granted'
            ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900'
            : permission === 'denied'
              ? 'bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-900'
              : 'bg-card border-border'
        }`}
      >
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
          permission === 'granted'
            ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
            : permission === 'denied'
              ? 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300'
              : 'bg-primary/15 text-primary'
        }`}>
          {permission === 'granted' && isSubscribed
            ? <BellRinging size={24} weight="duotone" />
            : permission === 'denied'
              ? <BellSlash size={24} weight="duotone" />
              : <Bell size={24} weight="duotone" />}
        </div>
        <div className="min-w-0 flex-1">
          {permission === 'granted' && isSubscribed ? (
            <>
              <h2 className="font-semibold text-base">Notificaciones activas</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Tu navegador entregará alertas según las preferencias configuradas abajo.
                {!isPushSupported && (<> Push no está disponible en este navegador — solo recibirás avisos in-app.</>)}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleDisable}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted"
                >
                  <BellSlash size={14} weight="bold" /> Desactivar
                </button>
                <button
                  type="button"
                  onClick={toggleDoNotDisturb}
                  className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium border ${
                    prefs.doNotDisturb
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-border hover:bg-muted'
                  }`}
                >
                  <MoonStars size={14} weight="bold" /> {prefs.doNotDisturb ? 'No molestar (ON)' : 'No molestar'}
                </button>
              </div>
            </>
          ) : permission === 'denied' ? (
            <>
              <h2 className="font-semibold text-base">Permiso bloqueado en el navegador</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Has denegado el permiso anteriormente. Para reactivarlo: clic en el icono de candado/ajustes
                de la barra de URL → Permisos del sitio → Notificaciones → Permitir.
              </p>
            </>
          ) : (
            <>
              <h2 className="font-semibold text-base">Activa las notificaciones</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Recibe alertas en tiempo real cuando se asigne un lead, venza un recordatorio, o llegue un pago.
                Solo se envían los tipos que actives en las preferencias de abajo.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleEnable}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
                >
                  <BellRinging size={14} weight="bold" /> Activar notificaciones
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {permission === 'granted' && (
        <section className="space-y-3">
          <header className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Tipos de notificación
            </h3>
            {savingPrefs && <span className="text-[10px] text-muted-foreground italic">guardado…</span>}
          </header>
          <p className="text-xs text-muted-foreground">
            Activa o desactiva cada tipo y elige por qué canales recibirlo. Las{' '}
            <strong>alertas del sistema</strong> siempre se entregan (incluso en modo no molestar).
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(KIND_META) as NotificationKind[]).map((kind) => {
              const meta = KIND_META[kind];
              const enabled = prefs.enabled[kind];
              const channels = prefs.channels[kind] || [];
              const isSystem = kind === 'system_alert';
              return (
                <article
                  key={kind}
                  className={`bg-card border border-border rounded-xl p-4 transition-colors ${!enabled ? 'opacity-60' : ''}`}
                >
                  <header className="flex items-start gap-3 mb-3">
                    <button
                      type="button"
                      onClick={() => !isSystem && toggleKind(kind)}
                      disabled={isSystem}
                      aria-label={enabled ? `Desactivar ${meta.label}` : `Activar ${meta.label}`}
                      className={`w-10 h-6 rounded-full flex items-center transition-colors flex-shrink-0 ${
                        enabled ? 'bg-primary justify-end' : 'bg-muted justify-start'
                      } ${isSystem ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span className="w-5 h-5 rounded-full bg-white shadow mx-0.5 transition-transform" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="font-semibold text-sm">{meta.label}</h4>
                        {isSystem && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            <ShieldCheck size={9} weight="bold" /> Siempre activa
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{meta.description}</p>
                    </div>
                  </header>
                  {enabled && (
                    <div className="flex flex-wrap gap-1.5 ml-13">
                      {(['inApp', 'push', 'email'] as NotificationChannel[]).map((ch) => {
                        const active = channels.includes(ch);
                        const m = CHANNEL_META[ch];
                        const ChIcon = m.Icon;
                        const disabled = ch === 'push' && !isPushSupported;
                        return (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => !disabled && toggleChannel(kind, ch)}
                            disabled={disabled}
                            title={disabled ? 'Push no soportado en este navegador' : m.help}
                            className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors ${
                              active
                                ? 'bg-primary/10 text-primary border-primary/30 font-medium'
                                : 'bg-card border-border text-muted-foreground hover:bg-muted'
                            } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            <ChIcon size={11} weight={active ? 'fill' : 'regular'} />
                            {m.label}
                            {active && <CheckCircle size={9} weight="fill" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="bg-muted/40 border border-border rounded-xl p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} weight="regular" className="text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-2">
            <p className="font-semibold text-foreground">Estado de la integración</p>
            <ul className="text-xs space-y-1 list-disc ml-4">
              <li>
                <strong>In-app:</strong> activo. La campana del header (
                <Bell size={11} weight="bold" className="inline mx-0.5" />) muestra recordatorios vencidos,
                cobros atrasados y leads recientes desde los datos del CRM.
              </li>
              <li>
                <strong>Push del navegador:</strong> {permission === 'granted'
                  ? 'el browser está listo. Falta el endpoint /api/push-subscriptions del backend para enviar push reales desde el servidor.'
                  : 'pendiente de tu permiso. Cuando lo actives, el navegador recibirá alertas aunque la pestaña esté cerrada.'}
              </li>
              <li>
                <strong>Email:</strong> pendiente. El backend tiene Brevo configurado (
                <Link to="/secuencias-email" className="text-primary font-medium hover:underline">secuencias</Link>) pero
                aún no hay templates para notificaciones por evento.
              </li>
            </ul>
            <p className="text-xs italic pt-1">
              Tus preferencias se guardan en este navegador. Cuando exista{' '}
              <code>/api/notification-preferences</code>, se sincronizarán con tu cuenta.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
