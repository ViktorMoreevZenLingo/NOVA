import { admin, checked, HttpError } from "../http.ts";
import { accessToken } from "../providers.ts";
import { execute } from "../tools.ts";
import { SERVICES, validateArgs } from "./validation.ts";
import type { Args } from "./contracts.ts";
export async function runTool(
  userId: string,
  name: string,
  args: Args,
  timezone = "Europe/Sofia",
) {
  validateArgs(name, args);
  const service = SERVICES[name];
  const configuration = service === "places"
    ? ["GOOGLE_PLACES_API_KEY"]
    : service === "outlook"
    ? ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]
    : ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  if (configuration.some((key) => !Deno.env.get(key))) {
    throw new HttpError(
      409,
      `${service} is not configured on Alo. Ask the administrator to configure this integration, then continue.`,
    );
  }

  const connected = checked(
    await admin().from("connections").select("service").eq("user_id", userId)
      .eq("service", SERVICES[name]).maybeSingle(),
  ).data;
  if (!connected) {
    throw new HttpError(409, `Connect ${SERVICES[name]} in Alo to continue.`);
  }
  if (name === "create_email_draft") {
    const token = await accessToken(userId, "gmail");
    const b64 = (s: string) =>
      btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    const mime = `To: ${args.to}\r\n${
      args.cc ? `Cc: ${args.cc}\r\n` : ""
    }Subject: =?UTF-8?B?${
      b64(String(args.subject))
    }?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${
      b64(String(args.body)).match(/.{1,76}/g)?.join("\r\n") ?? ""
    }`;
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            raw: b64(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(
              /=+$/,
              "",
            ),
          },
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new HttpError(502, "Could not save the draft.");
    return response.json();
  }
  return execute(userId, name, args, timezone);
}
