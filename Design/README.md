# Alo — Next.js prototype

A frontend-only personal phone assistant prototype built on the Next.js App Router and React. Authentication, calls, messages, and integrations are simulated. No API routes, OAuth, real SMS, or backend have been introduced.

## Run locally

Use Node.js 20.9 or newer (an active LTS release is recommended).

```sh
npm install
npm run dev
```

Open http://localhost:4173.

For a production preview, stop the development server, then run:

```sh
npm run build
npm start
```

The production build is written to `.next/`. Deploy as a standard Next.js application; the previous standalone `index.html` and static build scripts have been replaced.

## Structure

- `src/app/layout.jsx` — root layout, metadata, viewport, and global CSS.
- `src/app/page.jsx` — App Router entry point.
- `src/components/AloPrototype.jsx` — client component mounting the existing interactive prototype after hydration, with cleanup on unmount and Strict Mode support.
- `src/app.js` — browser UI runtime, exported as `mountAlo`; not a React component. Existing screens are intentionally preserved rather than rewritten during this compatibility migration.
- `src/home.js`, `src/history.js`, `src/history-inputs.js` — dashboard, history, transcripts, filters, and range picker.
- `src/profile*.js` — editable profile, photo, AI-context import, and local storage.
- `src/i18n.js`, `src/language-dropdown.js` — Bulgarian/English copy and language selection.
- `src/styles.css` — shared responsive styles.
- `public/assets/` — locally served photos and integration icons; credits in `CREDITS.md`.

The UI is client-rendered within the Next.js shell. Future React screens can replace individual runtime views incrementally. Browser-only modules load from an effect to avoid accessing the DOM or localStorage during server rendering.

## Preview flows

Use **Preview** to open a screen directly or toggle all integration states. Phone login accepts a Bulgarian mobile number and the simulated code `123456`. Profile name is required; context and photo are optional. Profiles and language preferences persist only in this browser. Connections reset on reload.

Home shows two recommendations, prioritizing Contacts and Gmail. Integrations includes Profile, Google Contacts, Gmail, Google Calendar, Google Places, and Microsoft Outlook. History includes incoming/outgoing calls, tasks, and SMS, with mock transcripts and mobile fullscreen reading.

No environment variables or external service credentials are required.
