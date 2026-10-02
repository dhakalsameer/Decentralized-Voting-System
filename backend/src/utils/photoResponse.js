import crypto from "crypto";

// Magic-byte sniffing. Falls back to image/jpeg so an unknown format is
// served exactly as it was before this helper existed.
function detectImageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 6 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.length > 3 && buf.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return "image/jpeg";
}

// Sends a base64-stored photo with a content-addressed ETag.
//
// The URL is stable per record (/api/students/<id>/photo), so the response
// must be revalidated or the browser keeps serving a photo that has since
// been replaced. The ETag is derived from the bytes themselves rather than
// updated_at because a photo can be replaced by a write that never touches
// that column -- notably a candidate whose photo resolves through the
// students fallback while only students.updated_at moves.
export function sendPhoto(req, res, base64) {
  const buf = Buffer.from(base64, "base64");
  const etag = `W/"${crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32)}"`;

  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "no-cache");

  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  res.setHeader("Content-Type", detectImageType(buf));
  return res.send(buf);
}