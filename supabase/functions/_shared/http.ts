import { createClient } from "npm:@supabase/supabase-js@2.117.3";

export function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
export function admin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export const cors = () => ({
  "Access-Control-Allow-Origin": env("APP_URL"),
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: cors() });
}
export async function authenticate(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  const { data: { user }, error } = await admin().auth.getUser(token);
  if (error || !user || (!user.is_anonymous && !user.phone_confirmed_at)) {
    throw new HttpError(401, "Please start a new session.");
  }
  return { user, token };
}
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export function failure(err: unknown) {
  // Never echo provider responses, tokens, or user context into logs/errors.
  return json({
    error: err instanceof HttpError
      ? err.message
      : "The request could not be completed. Please try again.",
  }, err instanceof HttpError ? err.status : 500);
}
export function checked<T extends { error: unknown }>(result: T): T {
  if (result.error) throw new Error("Database operation failed");
  return result;
}
