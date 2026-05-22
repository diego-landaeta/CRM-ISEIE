import { Link } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';
import { ChatCircleText, WhatsappLogo, EnvelopeSimple, Phone, ArrowsClockwise, Sparkle, PlugsConnected } from '@phosphor-icons/react';

const COMING = [
  {
    icon: WhatsappLogo,
    iconClass: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400',
    title: 'WhatsApp Business por proyecto',
    desc: 'Conecta el WhatsApp Business de cada proyecto. Plantillas, detección automática de canal en leads entrantes.',
  },
  {
    icon: EnvelopeSimple,
    iconClass: 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400',
    title: 'Email transaccional (Brevo)',
    desc: 'API key de Brevo por proyecto + dominios autorizados + plantillas de bienvenida y seguimiento.',
  },
  {
    icon: Phone,
    iconClass: 'bg-violet-100 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400',
    title: 'SMS vía Twilio',
    desc: 'Envío de SMS para confirmaciones rápidas y recordatorios de cita.',
  },
  {
    icon: PlugsConnected,
    iconClass: 'bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400',
    title: 'Reglas de auto-detección',
    desc: 'Mapea automáticamente el canal de origen del lead según UTMs, dominio o headers.',
  },
];

export default function ChannelsConfigPage() {
  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Canales del proyecto"
        subtitle="Configura los canales de comunicación por proyecto: WhatsApp, Email, SMS"
      />

      <div className="bg-gradient-to-br from-emerald-100/40 via-blue-100/30 to-transparent dark:from-emerald-950/20 dark:via-blue-950/20 border border-border rounded-2xl p-6 flex items-start gap-4">
        <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <ChatCircleText size={28} weight="duotone" className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-base">Backend pendiente</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 uppercase tracking-wide">
              En breve
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">
            El endpoint <code className="text-xs px-1 py-0.5 rounded bg-muted">/api/project-channels</code> aún no existe.
            Mientras tanto, el panel flotante de la esquina inferior derecha (WhatsApp Web, Webmail) sigue funcionando
            con configuración local en cada navegador.
          </p>
        </div>
      </div>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 mb-3 px-1">
          Lo que viene
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {COMING.map((c) => {
            const Icon = c.icon;
            return (
              <article
                key={c.title}
                className="bg-card border border-border rounded-xl p-4 flex items-start gap-3 hover:border-primary/30 transition-colors"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${c.iconClass}`}>
                  <Icon size={18} weight="duotone" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-sm mb-0.5">{c.title}</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="bg-muted/40 border border-border rounded-xl p-5 flex items-start gap-3">
        <ArrowsClockwise size={18} weight="regular" className="text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <p className="font-semibold text-foreground mb-1">Mientras llega...</p>
          <p>
            Las plantillas de WhatsApp por proyecto se editan desde la <Link to="/leads" className="text-primary font-medium hover:underline">página de prospectos</Link> &gt; menú &quot;Editar plantillas&quot;.
            Para conectar WhatsApp Web o el correo de cada proyecto puedes usar el panel flotante (icono <Sparkle size={12} weight="bold" className="inline" /> abajo a la derecha).
          </p>
        </div>
      </section>
    </div>
  );
}
