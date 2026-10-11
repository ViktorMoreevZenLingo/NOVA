Build a one-page marketing site for **NOVA Coach**, a hackathon project. Static React + Tailwind only: **no Supabase, no database, no auth, no backend, no forms that collect data, no analytics or tracking.** Everything below is the complete content; do not invent numbers, logos, customers, testimonials or awards.

## Brand and style
- Dark, calm, premium. Background #08080c with two soft radial glows: blue (#2a4dd9, ~30% opacity) top-right and violet (#6d3bd9, ~20%) bottom-left.
- Text #f4f4f5, secondary #a9a9b6. Accent gradient from #8aa6ff to #c7a6ff (use it for the second line of the hero headline only). Primary accent #2a78d6. Positive/green #22c35e.
- Font: Inter (or system UI). Big, tight headlines (letter-spacing -0.03em), generous spacing, max content width 1200px.
- Logo is text: "NOVA" + a blue dot + "Coach" (NOVA<span class="text-[#8aa6ff]">.</span>Coach), bold.
- Cards: background white at 5% opacity, 1px border white at 12%, radius 20px, subtle backdrop blur.
- A slowly "breathing" glowing orb (radial gradient white → #cdd7ff → #4e74ff, soft blue shadow) behind the hero, CSS animation only. Respect prefers-reduced-motion.
- Fully responsive (mobile first), accessible (semantic headings, alt text, visible focus, AA contrast).

## Assets (already uploaded to /public)
- `/nova-coach-pitch.mp4` (2-minute demo video, 1280x720, with sound) and `/pitch-poster.jpg` (its poster)
- `/og-image.jpg` (1200x630 social preview)
- Screenshots: `/screen-1-my-voice.jpg`, `/screen-2-draft-for-manager.jpg`, `/screen-3-team-trend.jpg`, `/screen-4-request-reply.jpg`, `/screen-6-heatmap.jpg`, `/screen-7-action-effect.jpg`
- `/pulse-scene.jpg` (anonymous pulse check-in scene)

Set the page title "NOVA Coach: a personal AI coach that calls every employee", a matching meta description, and Open Graph/Twitter tags using `/og-image.jpg`.

## Sections (in this order)

### 1. Header (sticky, transparent, blur on scroll)
Logo left. Links right: How it works · Privacy · Demo. Button "Watch the demo" (scrolls to #demo).

### 2. Hero
- Small eyebrow: Every company says "our people matter".
- H1: "Your employees won't tell you what's wrong." / second line in the accent gradient: "They'll tell NOVA."
- Sub: "A personal AI coach that calls every employee about their growth, remembers their goals and checks back in. And managers get early, honest, anonymous signals about what to change."
- Buttons: primary "Watch the 2-minute demo" (→ #demo), secondary "Open the app" (→ https://nova-ai-4bbdd.web.app, new tab).
- Three small proof chips under the buttons: "Real phone calls" · "Private by default" · "Anonymous for groups of 5+".

### 3. Demo video (id="demo")
Heading "See it work, from a real call to a measured change." Large rounded video player (native `<video controls preload="metadata" poster="/pitch-poster.jpg" src="/nova-coach-pitch.mp4">`), no autoplay. Caption under it: "Recorded on 10 October 2026: real phone calls through Vapi, the NOVA app running on Supabase. Subtitles are on the video."

### 4. The problem (3 cards)
- "People don't say it out loud." Growth wishes, frustrations and early burnout stay in the corridor, not in the meeting.
- "Managers find out too late." Usually at the exit interview.
- "Surveys feel like paperwork." Long forms, low trust, and nothing visibly changes afterwards.

### 5. How it works (id="how", 3 numbered steps with screenshots)
1. **A coach that calls back.** NOVA talks with the employee by phone about where they want to grow and what gets in the way, helps them choose one small step, and calls back after the due date: "Did you get to it? How did your colleagues react?" Screenshot: `/screen-2-draft-for-manager.jpg`.
2. **Honest, anonymous pulse.** A two-minute voice check-in. NOVA keeps the numbers and a few themes (like "growth" or "workload"), and throws away the words. Image: `/pulse-scene.jpg`.
3. **Managers act, and see if it worked.** Team trends, top concerns and suggested actions, only for groups of at least 5 people. Every action is published back to employees as "You said, we did", and its effect shows up in the next check-ins. Screenshot: `/screen-7-action-effect.jpg`.

### 6. Built for every role (4 cards, each with a small screenshot)
- **Employee:** a private space to grow; nothing reaches the company unless they approve the exact sentence. (`/screen-1-my-voice.jpg`)
- **Manager:** what's in the team's way, questions for 1:1s, and requests people chose to share. (`/screen-4-request-reply.jpg`)
- **Leadership:** engagement by department, attrition risk per team, and whether decisions actually helped. (`/screen-6-heatmap.jpg`)
- **HR:** pulse and engagement campaigns by voice, with closed-loop follow-up. (`/screen-3-team-trend.jpg`)

### 7. Privacy by design (id="privacy")
Heading "Trust is the product." Two columns:
- Left, "What the company gets": team-level numbers and themes · requests an employee approved word for word · actions and their measured effect.
- Right, "What it never gets" (each item with a red strikethrough style): an employee's name next to an answer · their words or voice · results for teams under 5 people · individual "flight risk" scores · anything from their private coaching.
Under it, one line in small text: "Sentiment is read from words, never from the voice (EU AI Act). NOVA is a coach, not a therapist: in a crisis it stops and points to real help."

### 8. A real call (quote card)
Show this short exchange from a real recorded call as a chat-style card (NOVA on the left in blue, the employee on the right in warm yellow #ffd27a):
- NOVA: "Last time you planned to prepare one proposal for the next team meeting. Did you get to it?"
- Employee: "Partly. I prepared it, but didn't present it. I got nervous when my manager was in the room."
- NOVA: "Would you like to make that your next step? Sharing your proposal with your manager before the meeting?"
- Employee: "I will mail my manager the proposal by Wednesday."
- A green confirmation pill: "✓ New step saved · NOVA calls back after it's due"

### 9. Under the hood (simple chip row)
Vapi (voice) · Supabase (Postgres, row-level security, Edge Functions) · OpenAI (Realtime voice, text analysis) · Next.js app. One sentence: "Privacy rules live in the database itself, with tests for every one of them."

### 10. Team
Three simple cards, initials avatars: Oleg Zaim (Phone assistant and NOVA Coach) · Viktor Moreev (Frontend and design) · Nick Kazakov (Backend, integrations and frontend).

### 11. Final call to action + footer
Big line: "Growth for every employee. Early, honest signals for every manager." Buttons: "Watch the demo" and "Open the app". Footer: "© 2026 NOVA AI · Hackathon project" and the logo.
