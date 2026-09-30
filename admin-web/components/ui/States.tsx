import React from 'react';
import { Inbox, AlertCircle, Loader2 } from 'lucide-react';

export function LoadingState({ label = 'กำลังโหลด...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message = 'โหลดข้อมูลไม่สำเร็จ' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-danger">
      <AlertCircle className="h-5 w-5" />
      {message}
    </div>
  );
}

export function EmptyState({ message = 'ไม่มีรายการ' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-text-muted">
      <Inbox className="h-5 w-5" />
      {message}
    </div>
  );
}

/** Wraps a fetched list's loading/error/empty/content states so every queue page
 * (vendors/events/users/support) handles them identically instead of re-deriving
 * its own ternary chain. */
export function ListContainer({
  loading,
  error,
  isEmpty,
  emptyMessage,
  errorMessage,
  className = '',
  children,
}: {
  loading: boolean;
  error: boolean;
  isEmpty: boolean;
  emptyMessage?: string;
  errorMessage?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`divide-y divide-border rounded-lg border border-border bg-surface ${className}`}>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={errorMessage} />
      ) : isEmpty ? (
        <EmptyState message={emptyMessage} />
      ) : (
        children
      )}
    </div>
  );
}
