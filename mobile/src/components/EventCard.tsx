import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './AppText';
import { NotchCard } from './NotchCard';
import { PrimaryButton } from './PrimaryButton';
import { CouponCardHeader } from './CouponCardHeader';
import { useCountdown } from '../hooks/useCountdown';
import { formatDiscountBadge } from '../api/products';
import { colors, radius, spacing, type } from '../theme';

export type EventListItem = {
  id: string;
  title: string;
  category: string;
  shop_name: string;
  shop_logo_url: string | null;
  thumbnail_url: string | null;
  discount_min_baht: number;
  discount_max_baht: number;
  remaining_count: number;
  sold_out: boolean;
  claimed_count: number;
  end_time: string;
  /** null จนกว่าจะมีคนรีวิว */
  rating_average: number | null;
  rating_count: number;
};

// hh:mm:ss ทำให้ Event ที่เหลือหลายวัน (เกิน 24 ชม.) ขึ้นเป็นเลขชั่วโมงสามหลักที่อ่านยาก
// (เช่น "120:00:00") — สลับไปบอกเป็น "X วัน" ทันทีที่เหลือ >= 1 วัน แล้วค่อยขึ้น hh:mm (ไม่มี
// วินาที ซึ่งไม่มีความหมายเวลาบอกเป็นวันอยู่แล้ว) ตอนใกล้หมดเขตจริงๆ
function CountdownText({ endTimeIso }: { endTimeIso: string }) {
  const { secondsLeft } = useCountdown(endTimeIso);
  const days = Math.floor(secondsLeft / 86400);
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  const label = days >= 1 ? `หมดเขตใน ${days} วัน` : `หมดเขตใน ${pad(h)}:${pad(m)}`;
  return (
    <View style={styles.countdown}>
      <Ionicons name="time-outline" size={14} color={colors.danger} />
      <Text style={styles.countdownText}>{label}</Text>
    </View>
  );
}

/**
 * ใช้ร่วมกัน 2 ที่: รายการ event จริงใน HomeScreen และ live preview ใน EventFormScreen
 * (โชว์ให้ vendor เห็นว่าลูกค้าจะเห็นการ์ดนี้หน้าตายังไงก่อนกด publish จริง) — ต้องเป็น
 * component เดียวกันเป๊ะ ไม่ใช่แค่โค้ดคล้ายกัน ไม่งั้น preview จะไม่ตรงกับของจริงถ้าแก้ทีหลัง
 */
export function EventCard({ item, onPress }: { item: EventListItem; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
      <NotchCard notchAt={192 / (192 + 140)} style={styles.card}>
        <CouponCardHeader
          thumbnailUrl={item.thumbnail_url}
          imageHeight={192}
          title={item.title}
          shopName={item.shop_name}
          shopLogoUrl={item.shop_logo_url}
          ratingAverage={item.rating_average}
          badge={{ text: formatDiscountBadge(item.discount_min_baht, item.discount_max_baht), tone: 'discount' }}
        />

        <View style={styles.cardFooter}>
          <View style={styles.statusRow}>
            <View style={[styles.remainingPill, item.sold_out && styles.soldOutPill]}>
              <Text style={[styles.remainingPillText, item.sold_out && styles.soldOutPillText]}>
                {item.sold_out ? 'สิทธิ์เต็มแล้ว' : `เหลืออีก ${item.remaining_count} สิทธิ์`}
              </Text>
            </View>
            <CountdownText endTimeIso={item.end_time} />
          </View>

          {/* เปิดหน้ารายละเอียด (การรับตั๋วจริงยืนยันที่หน้านั้น) */}
          <PrimaryButton
            title={item.sold_out ? 'สิทธิ์เต็มแล้ว' : 'ดูและรับตั๋ว'}
            onPress={onPress}
            disabled={item.sold_out}
          />
        </View>
      </NotchCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  cardFooter: { paddingHorizontal: 21, paddingBottom: 21, gap: spacing.sm },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  remainingPill: {
    backgroundColor: colors.statusActiveBg,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  remainingPillText: { ...type.captionStrong, color: colors.statusActiveText },
  soldOutPill: { backgroundColor: colors.statusUsedBg },
  soldOutPillText: { color: colors.statusUsedText },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countdownText: { ...type.captionStrong, color: colors.danger },
});
