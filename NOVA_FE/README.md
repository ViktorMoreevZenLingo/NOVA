# Ало (Alo) — frontend

Frontend for the **Ало** voice assistant. Next.js (App Router) + TypeScript,
used as a pure frontend: all backend logic lives in a separate Spring Boot
service. There are **no Next.js API routes or server actions** here — the browser
calls relative `/api/*` paths that are proxied to the backend.

This is a hackathon build: **functionality only, no design**. Markup is plain
and semantic; styling is intentionally left to browser defaults so the real
design can be applied later. All logic lives in hooks and modules under `lib/`
and `hooks/`, not in JSX.

## Structure

```
app/
  layout.tsx          # wraps everything in the i18n provider
  page.tsx            # "/"      login / registration
  home/page.tsx       # "/home"  connected services
components/
  LanguageSwitcher.tsx
  auth/AuthForm.tsx
  home/HomeView.tsx, Sidebar.tsx, ProfileRow.tsx, ServiceRow.tsx
hooks/
  useAuthForm.ts      # login/register form logic
  useHome.ts          # /home data + actions
lib/
  api.ts              # all API calls (real + mock), typed
  i18n.ts             # BG/EN dictionary
  i18n-context.tsx    # language context + localStorage persistence
  phone.ts            # Bulgarian phone validation/normalization
```

## Install

```bash
npm install
```

## Run — mock mode (no backend)

`NEXT_PUBLIC_MOCK=1` makes `lib/api.ts` use an in-memory mock persisted in
`localStorage`, so the full flow works before the backend exists:

- any 9-digit number can register;
- login returns 404 for unknown numbers;
- **Свържи** marks a Google service connected immediately (no real OAuth).

```bash
cp .env.example .env.local   # already contains NEXT_PUBLIC_MOCK=1
npm run dev
```

Open http://localhost:3000.

To reset mock data, clear the site's `localStorage` (key `alo.mock.v1`).

## Run — against the backend on :8080

Make sure `NEXT_PUBLIC_MOCK` is **not** `1` (edit or remove `.env.local`), then:

```bash
npm run dev
```

`next.config.mjs` rewrites `/api/*` → `http://localhost:8080/api/*`, so start
the Spring Boot backend on port 8080 first. Session is cookie-based; requests
are sent with `credentials: "include"`.

## Run behind ngrok

```bash
npm run dev
ngrok http 3000
```

`allowedDevOrigins` in `next.config.mjs` already lists common ngrok wildcard
hosts. If your tunnel host is rejected, add it explicitly, e.g.:

```js
allowedDevOrigins: ["your-subdomain.ngrok-free.app"],
```

The browser still calls `/api/*` on the same origin, so Google OAuth redirects
back to `/home?connected=…` work through the tunnel as long as the backend's
redirect URIs point at the tunnel URL.

## Notes

- UI language: Bulgarian by default, BG/EN switcher (top-right on `/home`).
  Choice is stored in `localStorage` (`alo.lang`).
- Phone input shows a fixed `BG +359` prefix; the rest is validated to 9 digits
  (a leading `0` is dropped) and sent as `+359XXXXXXXXX`.
- No SMS verification; the backend sets a session cookie on success.
```
