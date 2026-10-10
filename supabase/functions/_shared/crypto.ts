const encoder = new TextEncoder();

export async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (compares fixed-length digests). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da.charCodeAt(i) ^ db.charCodeAt(i);
  return diff === 0;
}

/** Validates `Authorization: Bearer <secret>`. */
export async function hasBearer(req: Request, secret: string): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? await safeEqual(match[1].trim(), secret) : false;
}

/** Vapi requests: `x-vapi-secret: <secret>` (set via server.headers) or `Authorization: Bearer <secret>` (credential). */
export async function hasVapiSecret(req: Request, secret: string): Promise<boolean> {
  const header = req.headers.get("x-vapi-secret");
  return header ? await safeEqual(header.trim(), secret) : await hasBearer(req, secret);
}
