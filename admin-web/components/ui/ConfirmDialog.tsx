'use client';

import React, { useCallback, useState } from 'react';
import { cn } from '../../lib/cn';

type ConfirmOptions = {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

/** Replaces window.confirm() with a styled modal. `confirm()` resolves the same
 * way window.confirm() does (true = confirmed) so call sites barely change:
 *   const ok = await confirm({ title, message, danger: true });
 *   if (!ok) return;
 * Render the returned `dialog` once near the bottom of the component tree. */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setPending({ ...options, resolve }));
  }, []);

  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  const dialog = pending ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => close(false)}
    >
      <div className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-foreground">{pending.title}</h3>
        {pending.message && <div className="mt-2 whitespace-pre-line text-sm text-text-muted">{pending.message}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => close(false)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-neutral-bubble"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => close(true)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium text-white',
              pending.danger ? 'bg-danger hover:bg-danger-dark' : 'bg-primary hover:bg-primary-dark'
            )}
          >
            {pending.confirmLabel ?? 'ยืนยัน'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
