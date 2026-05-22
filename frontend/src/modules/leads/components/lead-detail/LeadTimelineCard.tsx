export interface TimelineEvent {
  id: number | string;
  action: string;
  date: string;
  source: string;
  color: string;
}

export default function LeadTimelineCard({ timeline }: { timeline: TimelineEvent[] }) {
  if (!timeline.length) return null;
  return (
    <div className="bg-card p-5 rounded-lg border border-border">
      <h3 className="font-semibold mb-4">Historial del sistema</h3>
      <div className="relative ml-1">
        <div className="absolute left-[4px] top-2 bottom-2 w-px bg-border" />
        {timeline.map((event, i) => (
          <div key={event.id} className={`flex gap-4 relative ${i < timeline.length - 1 ? 'pb-5' : ''}`}>
            <div
              className="w-[10px] h-[10px] rounded-full border-2 bg-card flex-shrink-0 mt-1.5 z-10"
              style={{ borderColor: event.color }}
            />
            <div>
              <p className="text-[13px] font-medium">{event.action}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{event.date} &bull; {event.source}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
