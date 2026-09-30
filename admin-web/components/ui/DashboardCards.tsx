import React from 'react';
import { ResponsiveContainer } from 'recharts';
import { Card } from './Card';
import { Badge, type BadgeVariant } from './Badge';

export type StatAccent = 'info' | 'warning' | 'success';

const ACCENT_CLASSES: Record<StatAccent, string> = {
  info: 'text-info',
  warning: 'text-warning',
  success: 'text-success',
};

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: StatAccent;
}) {
  return (
    <Card className="p-5">
      <div className="text-sm text-text-muted">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${accent ? ACCENT_CLASSES[accent] : 'text-foreground'}`}>{value}</div>
      {hint ? <div className="text-xs text-text-muted mt-1">{hint}</div> : null}
    </Card>
  );
}

export function BreakdownCard({
  title,
  rows,
  note,
}: {
  title: string;
  rows: { label: string; value: string; variant: BadgeVariant }[];
  note?: string;
}) {
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-foreground mb-3">{title}</div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="text-sm text-text-muted">ยังไม่มีข้อมูล</div>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between text-sm">
              <Badge variant={row.variant}>{row.label}</Badge>
              <span className="font-medium text-foreground">{row.value}</span>
            </div>
          ))
        )}
      </div>
      {note ? <div className="text-xs text-text-muted mt-3">{note}</div> : null}
    </Card>
  );
}

export function ChartCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactElement;
}) {
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-foreground mb-3">{title}</div>
      <div role="img" aria-label={title} style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
      {note ? <div className="text-xs text-text-muted mt-2">{note}</div> : null}
    </Card>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-text-muted mt-8 mb-3">{children}</h2>;
}
