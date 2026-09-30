import * as ImageManipulator from 'expo-image-manipulator';
import type * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';

/** What the upload actually needs: a local file URI plus the mime type to declare. */
export type UploadableImage = { uri: string; type: string; name: string };

const ALLOWED = new Set(['image/jpeg', 'image/png']); // must match ALLOWED_MIME in backend/src/routes/events.js

/**
 * iOS hands back HEIC from the photo library, which the backend rejects — so picked
 * images get re-encoded to JPEG.
 *
 * The re-encode is best-effort on purpose: `manipulateAsync` needs a native module,
 * and if it's unavailable the old code threw and took the whole picker down with it.
 * Falling back to the original asset means an already-JPEG/PNG pick (the common case
 * on Android) still uploads fine.
 */
export async function toJpegAsset(asset: ImagePicker.ImagePickerAsset, index = 0): Promise<UploadableImage> {
  try {
    const out = await ImageManipulator.manipulateAsync(asset.uri, [], {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: out.uri, type: 'image/jpeg', name: `photo-${index}.jpg` };
  } catch {
    const mime = asset.mimeType && ALLOWED.has(asset.mimeType) ? asset.mimeType : 'image/jpeg';
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    return { uri: asset.uri, type: mime, name: asset.fileName ?? `photo-${index}.${ext}` };
  }
}

/**
 * Turns a picked image into a part `fetch` will actually send.
 *
 * The long-standing React Native idiom — appending `{ uri, name, type }` and letting the
 * native networking layer read the file — is dead on Expo SDK 57. Expo replaces the global
 * `fetch` with its WinterCG one, which serialises FormData itself in
 * `expo/src/winter/fetch/convertFormData.ts` and accepts only a string, a `Blob`, or an
 * object exposing `bytes()`. Anything else throws "Unsupported FormDataPart
 * implementation" — that file's own comment says plainly: "`uri` is not supported for
 * React Native's FormData".
 *
 * `expo-file-system`'s `File` is what that `bytes()` branch exists for: it reads the file
 * off disk and carries `name`/`type` for the multipart headers. The filename is passed
 * explicitly as well, because multer only treats a part as a file when a filename is
 * present — without it the upload silently arrives as a plain text field.
 */
function toFilePart(image: UploadableImage): File {
  return new File(image.uri);
}

/** Builds the multipart body the backend's `upload.single('image')` expects (products). */
export function buildSingleImageFormData(image: UploadableImage): FormData {
  const formData = new FormData();
  formData.append('image', toFilePart(image), image.name || 'photo.jpg');
  return formData;
}

/** Builds the multipart body the backend's `upload.array('images')` expects. */
export function buildImageFormData(images: UploadableImage[]): FormData {
  const formData = new FormData();
  images.forEach((img, i) => {
    formData.append('images', toFilePart(img), img.name || `photo-${i}.jpg`);
  });
  return formData;
}

/**
 * Same idea as `buildImageFormData`, but for endpoints that mix text fields with a file
 * array in one multipart request — e.g. vendor signup's `{ name, documents[] }`
 * (backend/src/routes/vendors.js). Text fields must be appended before the files so
 * multer's field parsing sees them regardless of part order, matching how the backend
 * reads `req.body` alongside `req.files`.
 */
export function buildImageFormDataWithFields(
  images: UploadableImage[],
  fileField: string,
  textFields: Record<string, string>
): FormData {
  const formData = new FormData();
  Object.entries(textFields).forEach(([key, value]) => formData.append(key, value));
  images.forEach((img, i) => {
    formData.append(fileField, toFilePart(img), img.name || `file-${i}.jpg`);
  });
  return formData;
}
