import React from 'react';
import Link from 'next/link';
import { cn } from '../../lib/cn';

export function ListRow({
  href,
  title,
  meta,
  right,
}: {
  href: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 p-4 hover:bg-neutral-bubble">
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{title}</div>
        {meta && <div className="mt-0.5 text-xs text-text-muted">{meta}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </Link>
  );
}

export function FilterTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === o.value ? 'bg-primary text-white' : 'border border-border bg-surface text-foreground hover:bg-neutral-bubble'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
