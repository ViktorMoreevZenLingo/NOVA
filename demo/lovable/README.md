# NOVA Coach landing page (built with Lovable)

**Live:** https://pixel-perfect-match-5365.lovable.app · **Repo:** https://github.com/novateamcrossroads/pixel-perfect-match-5365 (public, synced by Lovable)

A public one-page site for the jury and the demo: hook, the 2-minute video, how it works, roles, privacy, a real call excerpt, team. It is **static**: no Supabase connection, no auth, no data collection, so it can't touch the shared project (Lovable's earlier migrations collided with ours, see commits `9892185` and `c52fe01`).

## Steps (about 15 minutes)

1. **New Lovable project.** Go to lovable.dev → New project. Do **not** connect Supabase or Lovable Cloud.
2. **Upload the assets** (from `demo/output/lovable-assets/`, generated locally; not in git because they include call recordings). Drag them into the chat or into the project's `public/` folder:
   `nova-coach-pitch.mp4`, `pitch-poster.jpg`, `og-image.jpg`, `pulse-scene.jpg`, `screen-*.jpg` (6 files).
3. **Paste the prompt** from [`PROMPT.md`](PROMPT.md) as the first message. It contains the full copy, design and section order, and forbids invented metrics, logos and testimonials.
4. **Review and iterate** in Lovable. Useful follow-ups:
   - "Check the page on mobile width and fix any overflow."
   - "Make sure the video section has no autoplay and the poster shows."
   - "Use only the copy from my first message; remove anything you added."
5. **Publish** (Lovable → Publish). You get a `*.lovable.app` URL; a custom domain is optional.
6. **Connect GitHub** (Lovable → GitHub → Connect) to a **new** repo, e.g. `nova-coach-landing`. Lovable syncs the whole repo, so don't connect this monorepo.
7. Put the published URL in `NOVA_VOICE/README.md` (NOVA Coach section) and in the pitch.

## Before the demo, check
- The video plays with sound in Chrome and Safari (mobile too).
- "Open the app" goes to https://nova-ai-4bbdd.web.app. That hosting has an **older build** without the coach screens: redeploy `NOVA_FE` to Firebase first (`cd NOVA_FE && npm run build && firebase deploy`), or point the button at the demo video only.
- The team names and roles in section 10 are right.
- The call excerpt matches the video (it is taken from the recorded call, lightly corrected for speech recognition).

## NOVA_LANDING in this repo

`NOVA_LANDING/` is a squashed `git subtree` of the Lovable repo, so the landing page lives next to `NOVA_FE` and `NOVA_VOICE`. Lovable stays the source of truth: **edit in Lovable, never directly in `NOVA_LANDING/`** (except `public/__l5e/`, see below).

Pull Lovable's latest changes:
```bash
git subtree pull --prefix=NOVA_LANDING https://github.com/novateamcrossroads/pixel-perfect-match-5365.git main --squash
```

Run or build it locally:
```bash
cd NOVA_LANDING && npm install && npx vite dev --port 3200    # or: npm run build (Cloudflare Worker output in .output/)
```

**Media.** Lovable keeps uploaded files in its own asset storage and the code references them as `/__l5e/assets-v1/<id>/<file>`. So the copy also works outside Lovable, the same files are mirrored at those paths in `NOVA_LANDING/public/__l5e/` (the video is the 5.4 MB web version). Lovable's repo has no `public/__l5e/`, so subtree pulls don't conflict. If you upload new media in Lovable, mirror it with:
```bash
cd NOVA_LANDING && python3 - <<'PY'
import json, re, glob, os, subprocess
refs = {json.load(open(f))["url"] for f in glob.glob("src/assets/*.asset.json")}
for f in glob.glob("src/**/*.tsx", recursive=True):
    refs |= set(re.findall(r"/__l5e/assets-v1/[0-9a-f-]+/[\w.-]+", open(f).read()))
for r in refs:
    if not os.path.exists("public" + r):
        os.makedirs(os.path.dirname("public" + r), exist_ok=True)
        subprocess.run(["curl", "-sSf", "-o", "public" + r, "https://pixel-perfect-match-5365.lovable.app" + r], check=True)
PY
```
