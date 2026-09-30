import { cn } from '../../lib/cn';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'orange' | 'neutral' | 'brand';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  // Platform-imposed lockout (suspended account, banned event) — distinct from a plain
  // rejection/cancellation so the two read differently at a glance (see lib/statusMeta.ts).
  orange: 'bg-orange-bg text-orange',
  neutral: 'bg-neutral-bubble text-text-muted',
  // Not a status — brand-colored grouping pill (e.g. Dashboard's revenue-by-tier breakdown).
  brand: 'bg-primary-soft text-primary-dark',
};

export function Badge({ variant = 'neutral', children }: { variant?: BadgeVariant; children: React.ReactNode }) {
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium', VARIANT_CLASSES[variant])}>
      {children}
    </span>
  );
}
