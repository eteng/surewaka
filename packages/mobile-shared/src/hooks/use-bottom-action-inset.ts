import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom clearance for sticky/last CTAs so the primary action never sits under the
 * Android navigation bar or gesture pill.
 *
 * On Android gesture navigation `useSafeAreaInsets().bottom` is often reported as 0
 * even though the home-gesture zone still occupies the bottom edge. Tapping a button
 * flush at the bottom then mis-fires the home gesture instead of the button. We floor
 * the inset at `minInset` so there is always adequate clearance, then add `extra`
 * breathing room.
 *
 * @param extra    Additional spacing above the inset (default 24).
 * @param minInset Minimum treated bottom inset (default 16).
 */
export function useBottomActionInset(extra = 24, minInset = 16): number {
  const { bottom } = useSafeAreaInsets();
  return Math.max(bottom, minInset) + extra;
}
