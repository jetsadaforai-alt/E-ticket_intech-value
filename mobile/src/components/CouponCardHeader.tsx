import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { GradeRating } from './GradeRating';
import { resolveAssetUrl } from '../utils/assetUrl';
import { colors, radius, spacing } from '../theme';

export type BadgeTone = 'discount' | 'success' | 'muted' | 'danger';

// Solid fills behind white text — each passes 4.5:1 against #fff.
const BADGE_TONE_BG: Record<BadgeTone, string> = {
  discount: colors.dealAccentDark,
  success: colors.success,
  muted: colors.textMuted,
  danger: colors.danger,
};

type Props = {
  thumbnailUrl: string | null;
  /** EventCard uses 192 (its own default below); wallet/QR-screen cards use a shorter 140. */
  imageHeight?: number;
  title: string;
  shopName: string;
  /** ป้ายร้าน — โชว์รูปจริงถ้าร้านอัปโหลดไว้ ไม่งั้น fallback เป็นวงกลมตัวอักษรแรกของชื่อร้านเหมือนเดิม */
  shopLogoUrl?: string | null;
  ratingAverage?: number | null;
  badge?: { text: string; tone: BadgeTone };
};

/**
 * The image + badge + shop-avatar/title/rating block shared by EventCard (event list/
 * preview), WalletScreen's ticket cards, and TicketDetailScreen's header-above-QR card —
 * extracted so a coupon looks the same everywhere it appears instead of three hand-rolled
 * copies drifting apart. Callers render their own footer content below this as a sibling.
 */
export function CouponCardHeader({ thumbnailUrl, imageHeight = 192, title, shopName, shopLogoUrl = null, ratingAverage = null, badge }: Props) {
  return (
    <>
      <View style={[styles.imageHeader, { height: imageHeight }]}>
        {thumbnailUrl ? (
          <Image source={{ uri: resolveAssetUrl(thumbnailUrl) ?? undefined }} style={styles.heroImage} />
        ) : (
          <View style={[styles.heroImage, styles.heroPlaceholder]} />
        )}
        {badge ? (
          <View style={[styles.badge, { backgroundColor: BADGE_TONE_BG[badge.tone] }]}>
            <Text style={styles.badgeText}>{badge.text}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.headRow}>
        {shopLogoUrl ? (
          <Image source={{ uri: resolveAssetUrl(shopLogoUrl) ?? undefined }} style={styles.avatar} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{shopName.charAt(0)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.cardShop} numberOfLines={1}>{shopName}</Text>
        </View>
        {/* ซ่อนทั้งแถวเมื่อยังไม่มีรีวิว ดีกว่าโชว์เกรดของคะแนน 0 ซึ่งอ่านเหมือนแย่ */}
        {ratingAverage !== null && ratingAverage !== undefined ? (
          <View style={styles.ratingRow}>
            <GradeRating value={ratingAverage} size={20} />
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  imageHeader: { backgroundColor: colors.border },
  heroImage: { width: '100%', height: '100%' },
  heroPlaceholder: { backgroundColor: colors.border },
  badge: {
    position: 'absolute', top: spacing.md, right: spacing.md,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4,
  },
  badgeText: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '700' },

  headRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: 21, paddingTop: 21, paddingBottom: spacing.sm,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  avatarText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  // Line heights pinned so title + shop (22 + 16 = 38) never exceed the 40px avatar —
  // WalletScreen's notch offset assumes this row is exactly avatar-tall.
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: colors.text },
  cardShop: { fontSize: 12, lineHeight: 16, color: colors.textMuted },
  ratingRow: { alignItems: 'flex-end', gap: 2 },
});
