import {
  admin,
  authenticate,
  checked,
  cors,
  failure,
  HttpError,
  json,
} from "../_shared/http.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const { user, token } = await authenticate(req);
    const { phone } = await req.json();
    // Contact number is an unverified confirmation prompt, never an owner lookup.
    const contactPhone = user.phone || user.user_metadata?.contact_phone;
    if (
      typeof phone !== "string" ||
      typeof contactPhone !== "string" ||
      phone.replace(/^\+/, "") !== contactPhone.replace(/^\+/, "")
    ) throw new HttpError(400, "Phone number does not match.");
    const db = admin();
    // Revoke refresh sessions before deleting; stale JWTs cannot see any rows
    // after cascade deletion and every privileged function validates getUser.
    checked(await db.auth.admin.signOut(token, "global"));
    checked(await db.auth.admin.deleteUser(user.id));
    return json({ deleted: true });
  } catch (err) {
    return failure(err);
  }
});
