import { Compass } from '@phosphor-icons/react';
import ChannelBadge, { CHANNEL_LABELS } from '@/shared/components/ui/ChannelBadge';
import InfoField from './InfoField';
import type { Utms, LeadOrigen } from '@/shared/types';

export default function LeadUtmsCard({ utms, leadOrigen }: { utms?: Utms | null; leadOrigen?: LeadOrigen | null }) {
  return (
    <div className="bg-card p-5 rounded-lg border border-border">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="font-semibold">Origen y UTMs</h3>
        {(utms?.canal_detectado || leadOrigen) && (
          <ChannelBadge channel={utms?.canal_detectado || leadOrigen} />
        )}
      </div>
      {utms ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          <InfoField label="UTM Source">{utms.utm_source || '--'}</InfoField>
          <InfoField label="UTM Medium">{utms.utm_medium || '--'}</InfoField>
          <InfoField label="UTM Campaign">{utms.utm_campaign || '--'}</InfoField>
          <InfoField label="UTM Content">{utms.utm_content || '--'}</InfoField>
          <InfoField label="UTM Term">{utms.utm_term || '--'}</InfoField>
          <InfoField label="Canal detectado">
            <span className="font-semibold">{(utms.canal_detectado && CHANNEL_LABELS[utms.canal_detectado]) || utms.canal_detectado || '--'}</span>
          </InfoField>
          {utms.landing_url && (
            <div className="sm:col-span-2">
              <InfoField label="Landing URL">
                <a href={utms.landing_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs break-all">
                  {utms.landing_url}
                </a>
              </InfoField>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 py-3 px-4 rounded-md bg-muted/40 border border-dashed border-border">
          <Compass size={18} weight="regular" className="text-muted-foreground flex-shrink-0" />
          <p className="text-xs text-muted-foreground">Sin datos UTM — el lead llegó por canal directo.</p>
        </div>
      )}
    </div>
  );
}
