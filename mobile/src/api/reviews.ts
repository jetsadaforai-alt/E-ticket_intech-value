import { apiRequest } from './client';
import { buildSingleImageFormData } from '../utils/imageUpload';

/**
 * Event reviews — a 1-5 star rating with an optional comment.
 *
 * Only someone who actually redeemed a ticket for the event may write one, which the
 * server decides; the client just reads `can_review` and shows or hides the form.
 *
 * One review per person per event: posting again edits the existing one rather than
 * adding a second, so there is no separate "update" call.
 */

export type Review = {
  id: string;
  rating: number;
  comment: string | null;
  photo_url: string | null;
  /** Already masked server-side — never a full phone number. */
  user_name: string;
  created_at: string;
  updated_at: string;
};

export type MyReview = {
  id: string;
  rating: number;
  comment: string | null;
  photo_url: string | null;
  updated_at: string;
};

export type ReviewSummary = {
  /** null when nobody has reviewed yet */
  average: number | null;
  count: number;
  distribution: Record<string, number>;
};

export type EventReviews = {
  summary: ReviewSummary;
  /** Average across every event of the same shop. */
  shop_summary: { average: number | null; count: number };
  can_review: boolean;
  my_review: MyReview | null;
  /** Everyone else's — the caller's own review is in `my_review`. */
  reviews: Review[];
};

export const getEventReviews = (eventId: string) =>
  apiRequest<EventReviews>(`/v1/events/${eventId}/reviews`);

export const submitReview = (eventId: string, body: { rating: number; comment?: string }) =>
  apiRequest<MyReview>(`/v1/events/${eventId}/reviews`, { method: 'POST', body });

export const deleteMyReview = (eventId: string) =>
  apiRequest<void>(`/v1/events/${eventId}/reviews/me`, { method: 'DELETE' });

// ต้องมีรีวิวอยู่แล้ว (submitReview ก่อน) ถึงจะแนบรูปได้ — แทนที่รูปเดิมถ้าอัปซ้ำ
export const uploadReviewPhoto = (eventId: string, image: import('../utils/imageUpload').UploadableImage) =>
  apiRequest<{ id: string; photo_url: string }>(`/v1/events/${eventId}/reviews/photo`, {
    method: 'POST',
    formData: buildSingleImageFormData(image),
  });
