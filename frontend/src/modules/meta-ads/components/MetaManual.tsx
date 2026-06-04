import { Info, Warning, CheckCircle, XCircle, Book } from '@phosphor-icons/react';

// Manual de usuario del módulo Meta Ads. Documenta el qué hace, el cómo y
// — sobre todo — las limitaciones conocidas para que admin/superadmin no se
// confunda con los números cuando algo no cuadra.
// Mantén este archivo actualizado al ritmo del módulo: cada feature/limitación
// nueva se documenta aquí (en el sitio que el usuario va a leer cuando dude).

export default function MetaManual() {
  return (
    <div className="p-5 space-y-5 text-sm max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 flex items-center justify-center flex-shrink-0">
          <Book size={18} weight="duotone" />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight">Manual del módulo Meta Ads</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Qué hace este módulo, cómo usarlo y qué limitaciones conocidas tiene. Última actualización: 2026-06-04.
          </p>
        </div>
      </div>

      <Section title="¿Qué hace este módulo?" icon={Info}>
        <p>Extrae métricas de cuentas publicitarias de Meta (Facebook + Instagram) y las muestra en el CRM cruzándolas con tus productos y ventas reales.</p>
        <ul className="list-disc ml-5 space-y-1 mt-2">
          <li><strong>Solo lectura</strong>: el CRM nunca pausa, edita ni crea anuncios. Eso se sigue haciendo desde Meta Ads Manager.</li>
          <li>Sincroniza diariamente <strong>gasto, impresiones, alcance, clicks, leads (purchase events) y CTR/CPC/CPM/CPL</strong> por campaña, conjunto de anuncios y anuncio individual.</li>
          <li>Permite asociar <strong>productos del catálogo</strong> a campañas o conjuntos para calcular ROI real (gasto Meta vs facturación registrada en conversiones).</li>
        </ul>
      </Section>

      <Section title="Cómo conectar una cuenta" icon={CheckCircle} tone="emerald">
        <ol className="list-decimal ml-5 space-y-2">
          <li>En Meta Business Manager → <strong>Usuarios del sistema</strong> → crea uno con rol Administrador o Empleado.</li>
          <li>Asigna la cuenta publicitaria al System User con permisos "Gestionar cuenta de anuncios".</li>
          <li>Genera un token con permisos <code className="bg-muted px-1 rounded text-xs">ads_read</code> + <code className="bg-muted px-1 rounded text-xs">business_management</code>, caducidad <strong>Nunca</strong>.</li>
          <li>En el CRM → Meta Ads → pega el <code className="bg-muted px-1 rounded text-xs">act_XXXXX</code> y el token. Se valida contra Meta antes de guardar.</li>
          <li>El backfill 90 días (3 niveles) arranca en background. Tarda ~20 min — refresca después.</li>
        </ol>
      </Section>

      <Section title="Multi-cuenta por proyecto" icon={Info}>
        <ul className="list-disc ml-5 space-y-1">
          <li>Un proyecto puede tener N cuentas publicitarias. El header muestra un selector cuando hay más de una.</li>
          <li>El botón <strong>+ Cuenta</strong> añade otra al mismo proyecto sin tocar las existentes.</li>
          <li><strong>Sync, Backfill, Rotar token y Desconectar</strong> actúan SIEMPRE sobre la cuenta seleccionada.</li>
          <li>Las vistas agregadas (KPIs, gráfica, tabla de campañas, ROI, Por producto) siempre suman <strong>todas las cuentas del proyecto</strong> — todavía no hay filtro "solo cuenta X" en esas vistas.</li>
        </ul>
      </Section>

      <Section title="Asociar productos: campañas vs conjuntos" icon={Info}>
        <p>El CRM no sabe qué producto promociona cada anuncio — eso lo configuras tú asociando productos manualmente. Hay dos niveles:</p>
        <ul className="list-disc ml-5 space-y-1 mt-2">
          <li><strong>A nivel campaña</strong>: si toda una campaña vende los mismos productos (ej. una campaña por producto).</li>
          <li><strong>A nivel adset (conjunto)</strong>: cuando la misma campaña tiene varios adsets, uno por producto distinto. Más granular. Recomendado en cuentas con campañas tipo "Ventas" agrupadas.</li>
        </ul>
        <p className="mt-2">El tab <strong>Por producto</strong> consolida ambos niveles y muestra para cada producto qué campañas/conjuntos lo respaldan, gasto agregado, leads, ventas registradas y ROI.</p>
      </Section>

      <Section title="Limitaciones conocidas" icon={Warning} tone="amber">
        <Limit n={1} title="Solo lectura — no acciones desde el CRM">
          No puedes pausar/activar/editar anuncios desde aquí. Para eso sigue usando <a href="https://adsmanager.facebook.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline">Meta Ads Manager</a>.
        </Limit>

        <Limit n={2} title="Backfill máximo 90 días">
          La sincronización inicial trae los últimos 90 días. Para periodos más antiguos no hay opción todavía (Meta lo soporta hasta ~37 meses; queda como mejora futura).
        </Limit>

        <Limit n={3} title="Sync incremental = solo ayer + hoy">
          El botón "Sincronizar ahora" trae únicamente las últimas 24-48h. Si necesitas reactualizar un periodo más largo (corrección de Meta a posteriori), usa el botón <strong>90d</strong> (re-backfill completo).
        </Limit>

        <Limit n={4} title="'Reach' (alcance) no es sumable cross-días">
          Reach es deduplicación de usuarios únicos. Por eso en los totales usamos MAX, no SUM. <strong>El reach mostrado en rangos largos siempre será una aproximación</strong> — para reach exacto hay que pedirlo a Meta para ese periodo específico.
        </Limit>

        <Limit n={5} title="Atribución duplicada si el mismo producto está en N campañas">
          Si asocias el producto X a la campaña A y también a la campaña B, el ROI tab reportará TODAS las ventas de X en CADA campaña. Es correcto para "¿cuánto contribuye X a la campaña A?", pero sumar facturado cross-campaña contaría las ventas 2 veces.
        </Limit>

        <Limit n={6} title="Tab 'Por producto' puede sumar gasto dos veces">
          Si asocias un producto tanto a una campaña como a un adset DENTRO de esa campaña, el gasto se cuenta dos veces (una vez como campaign_spend, otra como adset_spend). <strong>Asocia en uno u otro nivel, no en ambos para el mismo producto.</strong>
        </Limit>

        <Limit n={7} title="Detección de leads = solo action_type 'lead' o 'purchase'">
          Si tu pixel registra otro action_type custom (ej. <code className="bg-muted px-1 rounded text-xs">subscribe</code>), no contará como lead en las métricas. Reportar al equipo si la cuenta usa eventos no estándar.
        </Limit>

        <Limit n={8} title="ROI cruza con conversions que tengan producto explícito">
          Solo se cruzan ventas donde <code className="bg-muted px-1 rounded text-xs">conversions.producto_contratado_id</code> está rellenado. Las ventas sin producto explícito (manuales sin elegir programa) no entran al ROI aunque pertenezcan a un cliente de campaña Meta.
        </Limit>

        <Limit n={9} title="Tokens System User sin caducidad — rotar si se filtran">
          Los tokens generados son "Never expire". Eso significa que si alguien los obtiene (commit, log, captura), tienen acceso indefinido. <strong>Si sospechas filtración: Configuración → Token → Rotar</strong>. Después revoca el viejo en Business Manager.
        </Limit>

        <Limit n={10} title="Cambios de cuenta en Meta tardan en reflejarse">
          Si renombras una campaña en Meta, el CRM lo verá en el próximo sync (no en tiempo real). Adsets/ads eliminados en Meta se quedan en la DB del CRM con sus últimas métricas hasta el siguiente backfill completo.
        </Limit>

        <Limit n={11} title="API limitada a v19 de Marketing API">
          El cliente está hard-coded a Graph API v19. Si Meta deprecia la versión (~12-24 meses), hay que actualizar el código.
        </Limit>

        <Limit n={12} title="Rate limit Meta — sync largo se pausa solo">
          Si Meta nos avisa de uso &gt;75% del cuota, el CRM pausa 90 segundos. En errores 17/4/32/613 espera 120s y reintenta una vez. Si la cuenta tiene muchísimos adsets/ads y pasa rate limit dos veces seguidas, el backfill falla y hay que relanzarlo manualmente.
        </Limit>

        <Limit n={13} title="Google Ads no implementado todavía">
          La entrada en el sidebar es placeholder. Cuando se implemente, vivirá al lado de Meta Ads en la sección Publicidad y la vista "Por producto" lo incluirá automáticamente.
        </Limit>
      </Section>

      <Section title="Glosario rápido" icon={Info}>
        <dl className="space-y-1.5">
          <DL k="Spend" v="Gasto bruto reportado por Meta en la divisa de la cuenta." />
          <DL k="Impresiones" v="Veces que se mostró el anuncio (no únicos)." />
          <DL k="Reach" v="Usuarios únicos que vieron el anuncio (aproximado en rangos largos)." />
          <DL k="Clicks" v="Clicks totales (incluye link, like, share, etc. según billing_event)." />
          <DL k="CTR" v="Clicks ÷ Impresiones × 100." />
          <DL k="CPM" v="Coste por 1000 impresiones." />
          <DL k="CPC" v="Coste por click." />
          <DL k="Leads" v="Acciones de tipo 'lead' o 'purchase' del pixel (no es lo mismo que un lead en el CRM)." />
          <DL k="CPL" v="Gasto ÷ Leads." />
          <DL k="ROI%" v="(Facturado − Gasto) ÷ Gasto × 100." />
        </dl>
      </Section>

      <div className="bg-muted/40 border border-border rounded-lg p-3 text-xs text-muted-foreground">
        <Info size={12} weight="duotone" className="inline mr-1" />
        ¿Falta algo o algo de aquí no es cierto? Avísale al equipo técnico y se actualiza este manual.
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, tone = 'blue', children }: { title: string; icon: any; tone?: 'blue'|'amber'|'emerald'; children: React.ReactNode }) {
  const toneMap = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  };
  return (
    <details open className="bg-card border border-border rounded-lg overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer text-sm font-semibold flex items-center gap-2 hover:bg-muted/40">
        <div className={`w-6 h-6 rounded ${toneMap[tone]} flex items-center justify-center flex-shrink-0`}>
          <Icon size={13} weight="duotone" />
        </div>
        {title}
      </summary>
      <div className="px-4 pb-4 pt-1 text-sm leading-relaxed">
        {children}
      </div>
    </details>
  );
}

function Limit({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-amber-300 dark:border-amber-800 pl-3 py-1 mb-2.5">
      <p className="font-semibold text-xs">
        <span className="text-amber-700 dark:text-amber-400">#{n}</span> · {title}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{children}</p>
    </div>
  );
}

function DL({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 text-xs">
      <dt className="font-semibold text-foreground min-w-[80px]">{k}</dt>
      <dd className="text-muted-foreground">{v}</dd>
    </div>
  );
}
