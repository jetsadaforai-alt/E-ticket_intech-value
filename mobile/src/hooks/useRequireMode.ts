import { useEffect, useRef } from 'react';
import { useMode, type AppMode } from '../context/ModeContext';

/**
 * Blocks a screen that only belongs to certain app modes.
 *
 * Until now these screens were protected only by hiding their entry point, so
 * anything that reached them another way (a stale route in the restored stack, a
 * role revoked while the user sat on the screen) rendered a shop UI to someone who
 * no longer had the role. The backend still 403s either way — this is about not
 * showing a dead shell.
 *
 * `onDenied` is a callback rather than a navigation object because each screen's
 * navigation prop is typed to its own route; letting the caller run the reset keeps
 * this hook free of navigation typing entirely.
 */
export function useRequireMode(allowed: AppMode[], onDenied: () => void, shopId?: string) {
  const { isModeReady, mode, vendorShopId, staffShopId } = useMode();
  const deniedRef = useRef(false);

  useEffect(() => {
    if (!isModeReady || deniedRef.current) return;

    const modeOk = allowed.includes(mode);
    // A shopId from a stale route must not outlive the role it belonged to.
    const shopOk = shopId === undefined || shopId === vendorShopId || shopId === staffShopId;

    if (!modeOk || !shopOk) {
      deniedRef.current = true;
      onDenied();
    }
    // `allowed` is a literal array at every call site, so depending on its identity
    // would re-run this every render — the mode values are what actually matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModeReady, mode, vendorShopId, staffShopId, shopId]);
}
