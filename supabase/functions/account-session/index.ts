import {
  admin,
  checked,
  cors,
  env,
  failure,
  HttpError,
  json,
} from "../_shared/http.ts";
const digest = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  let stage = "parse";
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const db = admin(), body = await req.json();
    let userId: string;
    if (body.action === "redeem") {
      if (typeof body.key !== "string" || !/^[a-f0-9]{64}$/.test(body.key)) {
        throw new HttpError(401, "Невалиден или изтекъл линк за вход.");
      }
      const hash = await digest(body.key);
      // A remembered device may resume only its own supplied number.
      stage = "key_lookup";
      const key = checked(
        await db.from("account_access_keys").select("user_id,kind").eq(
          "hash",
          hash,
        ).gt("expires_at", new Date().toISOString()).maybeSingle(),
      ).data;
      if (!key) throw new HttpError(401, "Невалиден или изтекъл линк за вход.");
      stage = "phone_lookup";
      const phone = checked(
        await db.from("account_phones").select("phone").eq(
          "user_id",
          key.user_id,
        ).single(),
      ).data?.phone;
      if (body.phone && body.phone !== phone) {
        throw new HttpError(
          401,
          "Устройството няма достъп до този номер. Използвай личния линк за вход.",
        );
      }
      userId =
        checked(await db.rpc("alo_redeem_access", { p_hash: hash })).data;
      if (!userId) {
        throw new HttpError(401, "Линкът вече е използван или е изтекъл.");
      }
    } else {
      const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
      const { data, error } = await db.auth.getUser(token || "");
      if (error || !data.user) {
        throw new HttpError(401, "Please sign in again.");
      }
      // Only a prior administrator merge authorizes account transfer, never editable metadata/phone.
      userId = data.user.app_metadata?.merged_into || data.user.id;
      if (!["resume", "link"].includes(body.action)) {
        throw new HttpError(400, "Unknown operation");
      }
    }
    stage = "mapping";
    const mapping = checked(
      await db.from("account_phones").select("phone").eq("user_id", userId)
        .maybeSingle(),
    ).data;
    if (!mapping) {
      throw new HttpError(
        409,
        "Този временен профил не е основният акаунт. Отвори личния си линк за вход.",
      );
    }
    const issue = async (kind: string, seconds: number) => {
      const key = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      checked(
        await db.from("account_access_keys").insert({
          hash: await digest(key),
          user_id: userId,
          kind,
          expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
        }),
      );
      return key;
    };
    if (body.action === "link") {
      return json({
        url: env("APP_URL").replace(/\/$/, "") + "/#alo_access=" +
          await issue("link", 900),
      });
    }
    stage = "target";
    const { data: target, error: targetError } = await db.auth.admin
      .getUserById(userId);
    if (targetError || !target.user) throw new Error("Missing account");
    let email = target.user.email;
    if (!email) {
      email = `${userId}@accounts.alo.invalid`;
      const changed = await db.auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      });
      if (changed.error) {
        throw new HttpError(
          503,
          "Account conversion failed: " + changed.error.code,
        );
      }
    }
    const link = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error || link.data.user.id !== userId) {
      throw new HttpError(
        503,
        "Session issuance failed: " + (link.error?.code || "owner_mismatch"),
      );
    }
    // Verify on a separate client: sign-in replaces its bearer token. Keep db privileged.
    const verified = await admin().auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: "email",
    });
    if (
      verified.error || verified.data.user?.id !== userId ||
      !verified.data.session
    ) {
      throw new HttpError(
        503,
        "Session verification failed: " +
          (verified.error?.code || "owner_mismatch"),
      );
    }
    stage = "device_key";
    return json({
      session: {
        access_token: verified.data.session.access_token,
        refresh_token: verified.data.session.refresh_token,
      },
      phone: mapping.phone,
      device_key: await issue("device", 2592000),
    });
  } catch (e) {
    return failure(
      e instanceof HttpError
        ? e
        : new HttpError(503, "Session unavailable (" + stage + ")."),
    );
  }
});
