import { Lightbulb, TrendUp, TrendDown, WarningCircle, CheckCircle, Sparkle } from '@phosphor-icons/react';

const CHANNEL_LABELS = {
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  tiktok_ads: 'TikTok Ads',
  organico: 'Orgánico',
  chatgpt_ia: 'ChatGPT/IA',
  directo: 'Directo',
  referido: 'Referido',
  otro: 'Otro',
};

function buildInsights({ stats, today, recentLeads }) {
  const insights = [];
  const total = Number(stats?.total || 0);
  const convertidos = Number(stats?.convertido || 0);
  const tasa = Number(stats?.conversionRate || 0);
  const inactivos = Number(today?.inactivos || 0);
  const cobrosVencidos = Number(today?.cobros_vencidos || 0);
  const nuevosHoy = Number(today?.nuevos_hoy || 0);
  const nuevosSemana = Number(today?.nuevos_semana || 0);

  // Mejor canal de los recientes
  if (recentLeads?.length > 0) {
    const channelCounts = {};
    for (const l of recentLeads) {
      const k = l.origen || 'otro';
      channelCounts[k] = (channelCounts[k] || 0) + 1;
    }
    const sorted = Object.entries(channelCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const [topChannel, count] = sorted[0];
      const pct = Math.round((count / recentLeads.length) * 100);
      if (pct >= 40) {
        insights.push({
          icon: Sparkle,
          tone: 'info',
          text: <><strong>{CHANNEL_LABELS[topChannel] || topChannel}</strong> es tu canal más activo recientemente ({pct}% de los últimos {recentLeads.length} leads).</>,
        });
      }
    }
  }

  // Tasa de conversion
  if (total >= 10) {
    if (tasa >= 25) {
      insights.push({
        icon: TrendUp,
        tone: 'success',
        text: <>Excelente tasa de conversión del <strong>{tasa}%</strong> ({convertidos} de {total}).</>,
      });
    } else if (tasa < 10 && total >= 20) {
      insights.push({
        icon: TrendDown,
        tone: 'warning',
        text: <>Tasa de conversión baja: <strong>{tasa}%</strong>. Revisa los leads en seguimiento que no avanzan.</>,
      });
    }
  }

  // Velocidad de captacion
  if (nuevosHoy >= 5) {
    insights.push({
      icon: TrendUp,
      tone: 'info',
      text: <><strong>{nuevosHoy} prospectos nuevos hoy</strong>. Buen ritmo de captación.</>,
    });
  } else if (nuevosSemana > 0 && nuevosHoy === 0) {
    insights.push({
      icon: WarningCircle,
      tone: 'warning',
      text: <>No han entrado leads hoy. {nuevosSemana} en la última semana.</>,
    });
  }

  // Inactivos
  if (inactivos > 0) {
    insights.push({
      icon: WarningCircle,
      tone: inactivos >= 10 ? 'destructive' : 'warning',
      text: <><strong>{inactivos} prospectos sin actividad reciente</strong>. Revísalos para no perder oportunidades.</>,
    });
  }

  // Cobros vencidos
  if (cobrosVencidos > 0) {
    insights.push({
      icon: WarningCircle,
      tone: 'destructive',
      text: <><strong>{cobrosVencidos} cobros vencidos</strong>. Contacta a los clientes lo antes posible.</>,
    });
  }

  // Si no hay malas noticias y tienes datos, celebramos
  if (insights.length === 0 && total > 0) {
    insights.push({
      icon: CheckCircle,
      tone: 'success',
      text: <>Todo marcha bien. Sigue así.</>,
    });
  }

  // Si no hay datos suficientes
  if (insights.length === 0) {
    insights.push({
      icon: Lightbulb,
      tone: 'info',
      text: <>Aún no hay suficientes datos para generar insights. Los irás viendo aquí a medida que entren leads y conversiones.</>,
    });
  }

  return insights;
}

const TONE_STYLES = {
  info: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-200',
  success: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200',
  warning: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200',
  destructive: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-900 dark:text-red-200',
};

const ICON_TONE = {
  info: 'text-blue-600 dark:text-blue-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  destructive: 'text-red-600 dark:text-red-400',
};

export default function PerformanceInsights({ stats, today, recentLeads }) {
  const insights = buildInsights({ stats, today, recentLeads });

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb size={18} weight="duotone" className="text-amber-500" />
        <h3 className="font-semibold">Insights</h3>
      </div>
      <ul className="space-y-2.5">
        {insights.map((ins, i) => {
          const Icon = ins.icon;
          return (
            <li
              key={i}
              className={`flex items-start gap-2.5 p-3 rounded-md border text-sm ${TONE_STYLES[ins.tone] || TONE_STYLES.info}`}
            >
              <Icon size={16} weight="bold" className={`flex-shrink-0 mt-0.5 ${ICON_TONE[ins.tone] || ICON_TONE.info}`} />
              <span className="leading-relaxed">{ins.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
