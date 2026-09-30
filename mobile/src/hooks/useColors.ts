import { useMemo } from 'react';
import { useMode } from '../context/ModeContext';
import { paletteFor, type Palette } from '../theme';

/**
 * Brand palette for whichever mode the app is currently in — teal for
 * customer/staff, blue for vendor (see the note on `vendorColors` in theme.ts).
 *
 * Only screens and components that are reachable from more than one mode need
 * this. Vendor-only screens import `vendorColors` statically instead, since
 * `useRequireMode` already guarantees no other mode can reach them, and a static
 * import keeps their `StyleSheet.create` at module scope.
 */
export function useColors(): Palette {
  const { mode } = useMode();
  return useMemo(() => paletteFor(mode), [mode]);
}

/**
 * Same palette, but as a memoised StyleSheet built from it. Lets a shared screen
 * keep one `makeStyles(c)` block instead of sprinkling inline colour overrides
 * over every branded element.
 */
export function useThemedStyles<T>(make: (c: Palette) => T): T {
  const c = useColors();
  return useMemo(() => make(c), [c, make]);
}
