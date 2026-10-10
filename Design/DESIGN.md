# Ало — visual system

A minimal Bulgarian personal-assistant prototype. Native system typography, monochrome interface, short functional labels. Authentication pairs a compact phone form with a black-and-white stock photograph; copyright belongs beneath the photograph on the right. Mobile hides the photograph and retains the right-aligned copyright.

Dashboard: one profile panel and three separate service panels centered within the main content area. Only a heading, connection count, service names, statuses, and actions. No introductory banner, marketing subtitles, eyebrows, sample conversations, or decorative waveform objects. The small waveform remains part of the logo only.

Tokens: white, #fafaf9 page, #f6f6f4 navigation, #191919 ink, #70706b secondary, #e8e8e5 border. Apple system font. 32–38px headings, 16px service names, 12–14px controls. Spacing 8/12/16/24/32/48/64. Radius 9px controls, 12px icons, 16px service panels, 22px dialog. Motion only for entrance and direct button feedback, with reduced-motion support.

Photo: Nguyễn Hiệp / Unsplash; source in public/assets/CREDITS.md. Served locally; no external image requests at runtime.

The interface intentionally omits demo labels at the user's request. Functionality remains entirely simulated in browser memory, with no SMS, OAuth or backend. Code is 123456. Preview controls retain access to all states.

Qualitative design review: AI Slop 1/10; Distinctiveness 7/10. Familiar native controls are intentional. Remaining tradeoff: product character now comes from typography and photograph rather than explanatory content.

Authentication tab selection updates the existing DOM in place. A shared highlight translates over 280ms with interruptible easing; input, focus, and photo nodes persist. Reduced motion removes the transition. OTP includes a short instruction and the selected phone number. Service rows and connection dialogs use local, unmodified Google product assets (see asset credits). Sidebar contains only Home and the account control.

Current sidebar reference: Activity Center AppShell/globals.css, inspected read-only. Adopted 234px expanded / 71px responsive rail, 15px edge spacing, 70px brand header/divider, 40px controls, 14px aligned icons, 13px medium labels, restrained neutral surfaces and selection ring. Kept Alo's monochrome palette. Options is the bottom utility; no separate sidebar profile item.

Personal profile is the first panel above integrations. Initial setup after a new phone's first simulated verification collects name, optional photo/city/occupation/notes; the profile can be edited from that row or Options. Local browser storage retains it by phone. No server, real SMS or OAuth. Existing profile skips setup. Cancel leaves saved data intact. Photo files are checked for type, size, successful decode; user text is escaped when rendered. Storage errors retain a session copy.

Verified signup validation, editing/cancel, avatar upload/removal, Options/logout, profile restoration after reload, separation between phone profiles, Google connection controls, 320/390/768/1440px layouts, desktop sidebar geometry and mobile dialogs. AI Slop: 1/10; Distinctiveness: 7/10 (intentional native utility design).

Service panels: separate 1px borders, 16px corners, 12px gaps, approximately 86px desktop height. Full-panel interaction with text action and right chevron; mobile actions sit below the name. A top-right BG/EN switch translates all screens, dialogs, errors and accessible labels. Language persists locally; switching preserves phone, OTP and unsaved profile drafts. Verified both languages, draft preservation, reload preference and responsive layouts; browser reported no errors.
