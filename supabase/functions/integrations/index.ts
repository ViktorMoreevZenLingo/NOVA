import {
  admin,
  authenticate,
  checked,
  cors,
  env,
  failure,
  HttpError,
  json,
} from "../_shared/http.ts";
import {
  base64url,
  callbackUrl,
  provider,
  scopes,
  tokenRequest,
} from "../_shared/providers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  const db = admin();
  const url = new URL(req.url);
  if (req.method === "GET") {
    const redirect = new URL(env("APP_URL"));
    try {
      const state = url.searchParams.get("state");
      if (!state) throw new Error("Missing state");
      // DELETE ... RETURNING makes the short-lived state single use, even across concurrent callbacks.
      const row = checked(
        await db.from("oauth_states").delete().eq("state", state).gt(
          "expires_at",
          new Date().toISOString(),
        ).select().maybeSingle(),
      ).data;
      if (!row || url.searchParams.has("error")) {
        throw new Error("Invalid or declined authorization");
      }
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Missing code");
      const token = await tokenRequest(row.service, {
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl(),
        code_verifier: row.verifier,
      });
      const normalizeScope = (scope: string) =>
        row.service === "outlook"
          ? scope.replace(/^https:\/\/graph.microsoft.com\//i, "").toLowerCase()
          : scope;
      const granted = new Set(
        String(token.scope || "").split(" ").map(normalizeScope),
      );
      const required = scopes[row.service].split(" ").map(normalizeScope);
      if (
        !token.access_token || !token.refresh_token ||
        !required.every((s) => granted.has(s))
      ) throw new Error("Missing permissions or offline access");
      checked(
        await db.from("provider_tokens").upsert({
          user_id: row.user_id,
          service: row.service,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: new Date(Date.now() + token.expires_in * 1000)
            .toISOString(),
          scope: token.scope,
        }),
      );
      checked(
        await db.from("connections").upsert({
          user_id: row.user_id,
          service: row.service,
          connected_at: new Date().toISOString(),
        }),
      );
      redirect.searchParams.set("connected", row.service);
    } catch {
      redirect.searchParams.set("connection_error", "1");
    }
    return Response.redirect(redirect, 303);
  }
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const { user } = await authenticate(req);
    const { action, service } = await req.json();
    if (
      typeof service !== "string" ||
      ![...Object.keys(scopes), "places"].includes(service)
    ) throw new HttpError(400, "Unknown service");
    if (action === "disconnect") {
      // Cancel pending authorizations as well as current access.
      checked(
        await db.from("oauth_states").delete().eq("user_id", user.id).eq(
          "service",
          service,
        ),
      );
      checked(
        await db.from("connections").delete().eq("user_id", user.id).eq(
          "service",
          service,
        ),
      );
      checked(
        await db.from("provider_tokens").delete().eq("user_id", user.id).eq(
          "service",
          service,
        ),
      );
      return json({ disconnected: true });
    }
    if (action !== "connect") throw new HttpError(400, "Unknown action");
    if (service === "places") {
      if (!Deno.env.get("GOOGLE_PLACES_API_KEY")) {
        throw new HttpError(
          503,
          "Places is not available yet. Please try again later.",
        );
      }
      checked(
        await db.from("connections").upsert({ user_id: user.id, service }),
      );
      return json({ connected: true });
    }
    const p = provider(service);
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
    );
    checked(
      await db.from("oauth_states").delete().lt(
        "expires_at",
        new Date().toISOString(),
      ),
    );
    checked(
      await db.from("oauth_states").delete().eq("user_id", user.id).eq(
        "service",
        service,
      ),
    );
    checked(
      await db.from("oauth_states").insert({
        state,
        user_id: user.id,
        service,
        verifier,
      }),
    );
    const consent = new URL(p.authorize);
    consent.search = new URLSearchParams({
      client_id: p.client,
      redirect_uri: callbackUrl(),
      response_type: "code",
      scope: p.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "consent",
      ...(service === "outlook" ? {} : { access_type: "offline" }),
    }).toString();
    return json({ url: consent.toString() });
  } catch (err) {
    return failure(err);
  }
});
