import React from 'react';
import { cn } from '../../lib/cn';

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-lg border border-border bg-surface p-6', className)}>{children}</div>;
}
