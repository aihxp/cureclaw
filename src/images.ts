import type { CloudPrompt } from "./cloud/types.js";

export interface ImageAttachment {
  data: string;         // base64
  mediaType: string;    // "image/jpeg", "image/png"
  dimensions?: { width: number; height: number };
}

export const MAX_IMAGES = 5;

export function toCloudImages(
  attachments: ImageAttachment[],
): NonNullable<CloudPrompt["images"]> {
  return attachments.slice(0, MAX_IMAGES).map((a) => ({
    data: a.data,
    dimensions: a.dimensions,
  }));
}
