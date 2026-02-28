import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCloudImages, MAX_IMAGES, type ImageAttachment } from "./images.js";

describe("toCloudImages", () => {
  it("converts attachments to cloud format", () => {
    const attachments: ImageAttachment[] = [
      { data: "abc123", mediaType: "image/png", dimensions: { width: 100, height: 200 } },
    ];
    const result = toCloudImages(attachments);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].data, "abc123");
    assert.deepStrictEqual(result[0].dimensions, { width: 100, height: 200 });
  });

  it("limits to MAX_IMAGES", () => {
    const attachments: ImageAttachment[] = Array.from({ length: 8 }, (_, i) => ({
      data: `img${i}`,
      mediaType: "image/jpeg",
    }));
    const result = toCloudImages(attachments);
    assert.strictEqual(result.length, MAX_IMAGES);
  });

  it("handles empty array", () => {
    const result = toCloudImages([]);
    assert.strictEqual(result.length, 0);
  });
});
