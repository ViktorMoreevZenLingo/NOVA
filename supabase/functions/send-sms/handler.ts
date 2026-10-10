import { Webhook } from "npm:standardwebhooks@1.0.0";
import { createHash, createHmac } from "node:crypto";

type Config = { hookSecret: string; apiKey: string; apiSecret: string };
const error = (status: number, message: string) =>
  Response.json({ error: { http_code: status, message } }, { status });

export function zadarmaRequest(phone: string, otp: string, config: Config) {
  const path = "/v1/sms/send/";
  const body = new URLSearchParams({
    message: `Your NOVA AI login code is ${otp}. Do not share this code.`,
    number: phone.replace(/^\+/, ""),
  }).toString();
  const digest = createHash("md5").update(body).digest("hex");
  // Zadarma signs the hexadecimal HMAC text, rather than the raw hash bytes.
  const signature = btoa(
    createHmac("sha1", config.apiSecret)
      .update(path + body + digest).digest("hex"),
  );
  return new Request(`https://api.zadarma.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `${config.apiKey}:${signature}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(4000),
  });
}

export function createHandler(config: Config, send: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return error(405, "Method not allowed.");
    if (!config.hookSecret || !config.apiKey || !config.apiSecret) {
      return error(503, "SMS delivery is not configured.");
    }
    let payload: { user?: { phone?: string }; sms?: { otp?: string } };
    try {
      const body = await req.text();
      if (body.length > 65536) return error(413, "Request too large.");
      payload = new Webhook(config.hookSecret.replace(/^v1,whsec_/, ""))
        .verify(body, Object.fromEntries(req.headers)) as typeof payload;
    } catch {
      return error(401, "Invalid SMS hook signature.");
    }
    const phone = payload?.user?.phone;
    const otp = payload?.sms?.otp;
    // Alo currently accepts Bulgarian numbers only; do not fund other destinations.
    if (
      typeof phone !== "string" || !/^\+?359[0-9]{9}$/.test(phone) ||
      typeof otp !== "string" || !/^[0-9]{6}$/.test(otp)
    ) {
      return error(
        400,
        "A valid Bulgarian phone number and login code are required.",
      );
    }
    try {
      const response = await send(zadarmaRequest(phone, otp, config));
      const result = await response.json();
      if (
        !response.ok || result.status !== "success" ||
        Number(result.messages) < 1 ||
        !Number.isFinite(Number(result.messages)) ||
        (Array.isArray(result.denied_numbers) &&
          result.denied_numbers.length > 0)
      ) {
        return error(502, "SMS delivery failed. Please try again later.");
      }
      return Response.json({});
    } catch {
      // Never log or echo OTPs, phone numbers, credentials, or provider responses.
      // No automatic retry: a timeout may already have resulted in a billed SMS.
      return error(
        502,
        "SMS delivery could not be confirmed. Please wait before retrying.",
      );
    }
  };
}
