// Lets `client.ts` (a plain module, can't import React Context) signal AuthContext when a
// request reveals the account was suspended mid-session, so the app can re-check status
// immediately instead of waiting for the next foreground transition.
type Listener = () => void;

let listener: Listener | null = null;

export function onAccountSuspended(fn: Listener) {
  listener = fn;
}

export function notifyAccountSuspended() {
  listener?.();
}
