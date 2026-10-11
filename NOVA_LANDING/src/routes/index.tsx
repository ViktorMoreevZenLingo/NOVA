import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import pitchVideo from "@/assets/nova-coach-pitch.mp4.asset.json";

const TITLE = "NOVA Coach: a personal AI coach that calls every employee";
const DESC =
  "A personal AI coach that calls every employee about their growth, remembers their goals and checks back in, while managers get early, honest, anonymous signals.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/__l5e/assets-v1/73c2ae56-f73a-453f-b4f3-c7516f9b1a2c/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: "/__l5e/assets-v1/73c2ae56-f73a-453f-b4f3-c7516f9b1a2c/og-image.jpg" },
    ],
  }),
  component: Index,
});

const APP = "https://nova-ai-4bbdd.web.app";
const wrap = "mx-auto w-full max-w-[1200px] px-5 sm:px-8";
const btnPrimary =
  "inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:opacity-90";
const btnSecondary =
  "inline-flex items-center justify-center rounded-full border border-border px-6 py-3 font-semibold text-foreground transition hover:bg-foreground/10";

function Logo() {
  return (
    <span className="text-lg font-bold tight">
      NOVA<span className="text-accent-from">.</span>Coach
    </span>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-3xl font-bold tight sm:text-5xl">{children}</h2>;
}

function Index() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 10);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition ${scrolled ? "border-b border-border bg-background/70 backdrop-blur-lg" : ""}`}
      >
        <nav className={`${wrap} flex h-16 items-center justify-between`} aria-label="Main">
          <a href="#top" aria-label="NOVA Coach home"><Logo /></a>
          <div className="flex items-center gap-6 text-sm">
            <a href="#how" className="hidden text-muted-foreground hover:text-foreground sm:inline">How it works</a>
            <a href="#privacy" className="hidden text-muted-foreground hover:text-foreground sm:inline">Privacy</a>
            <a href="#demo" className="hidden text-muted-foreground hover:text-foreground sm:inline">Demo</a>
            <a href="#demo" className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground">Watch the demo</a>
          </div>
        </nav>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="orb pointer-events-none absolute left-1/2 top-10 h-[420px] w-[420px] -translate-x-1/2 blur-2xl" />
          <div className={`${wrap} relative py-24 text-center sm:py-36`}>
            <p className="text-sm text-muted-foreground">Every company says “our people matter”.</p>
            <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-extrabold leading-[1.05] tight sm:text-7xl">
              Your employees won't tell you what's wrong.
              <br />
              <span className="text-gradient">They'll tell NOVA.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              A personal AI coach that calls every employee about their growth, remembers their goals and checks back in. And managers get early, honest, anonymous signals about what to change.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <a href="#demo" className={btnPrimary}>Watch the 2-minute demo</a>
              <a href={APP} target="_blank" rel="noopener noreferrer" className={btnSecondary}>Open the app</a>
            </div>
            <ul className="mt-8 flex flex-wrap justify-center gap-2 text-sm">
              {["Real phone calls", "Private by default", "Anonymous for groups of 5+"].map((c) => (
                <li key={c} className="card px-4 py-1.5 text-muted-foreground">{c}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Demo */}
        <section id="demo" className={`${wrap} scroll-mt-20 py-16`}>
          <H2>See it work, from a real call to a measured change.</H2>
          <div className="card mt-8 overflow-hidden p-2">
            <video controls preload="metadata" poster="/__l5e/assets-v1/e9d8fca7-6686-47ab-9e2f-fbb23a1b7474/pitch-poster.jpg" src={pitchVideo.url} className="aspect-video w-full rounded-[14px] bg-background">
              Your browser does not support video.
            </video>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Recorded on 10 October 2026: real phone calls through Vapi, the NOVA app running on Supabase. Subtitles are on the video.
          </p>
        </section>

        {/* Problem */}
        <section className={`${wrap} py-16`} aria-labelledby="problem">
          <h2 id="problem" className="sr-only">The problem</h2>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              ["People don't say it out loud.", "Growth wishes, frustrations and early burnout stay in the corridor, not in the meeting."],
              ["Managers find out too late.", "Usually at the exit interview."],
              ["Surveys feel like paperwork.", "Long forms, low trust, and nothing visibly changes afterwards."],
            ].map(([t, d]) => (
              <div key={t} className="card p-7">
                <h3 className="text-xl font-semibold tight">{t}</h3>
                <p className="mt-3 text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How */}
        <section id="how" className={`${wrap} scroll-mt-20 py-16`}>
          <H2>How it works</H2>
          <div className="mt-12 space-y-16">
            {[
              ["A coach that calls back.", "NOVA talks with the employee by phone about where they want to grow and what gets in the way, helps them choose one small step, and calls back after the due date: “Did you get to it? How did your colleagues react?”", "/__l5e/assets-v1/bf1ef906-0a8e-467d-b007-92845e14198a/screen-2-draft-for-manager.jpg", "NOVA app screen showing a drafted message for the manager"],
              ["Honest, anonymous pulse.", "A two-minute voice check-in. NOVA keeps the numbers and a few themes (like “growth” or “workload”), and throws away the words.", "/__l5e/assets-v1/9a9d6235-cf24-4786-bab5-f79b9b939f1e/pulse-scene.jpg", "An employee doing an anonymous voice pulse check-in"],
              ["Managers act, and see if it worked.", "Team trends, top concerns and suggested actions, only for groups of at least 5 people. Every action is published back to employees as “You said, we did”, and its effect shows up in the next check-ins.", "/__l5e/assets-v1/6c1e8983-0a01-47ed-a409-7fe732edb01b/screen-7-action-effect.jpg", "NOVA app screen showing the measured effect of a manager action"],
            ].map(([t, d, img, alt], i) => (
              <div key={t} className="grid items-center gap-8 md:grid-cols-2">
                <div className={i % 2 ? "md:order-2" : ""}>
                  <span className="text-5xl font-extrabold text-gradient">{i + 1}</span>
                  <h3 className="mt-3 text-2xl font-bold tight sm:text-3xl">{t}</h3>
                  <p className="mt-4 text-lg text-muted-foreground">{d}</p>
                </div>
                <img src={img} alt={alt} loading="lazy" className="card w-full p-1" />
              </div>
            ))}
          </div>
        </section>

        {/* Roles */}
        <section className={`${wrap} py-16`}>
          <H2>Built for every role</H2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Employee", "A private space to grow; nothing reaches the company unless they approve the exact sentence.", "/__l5e/assets-v1/67b0b929-4adc-4aaf-9fac-e1247bec9c58/screen-1-my-voice.jpg"],
              ["Manager", "What's in the team's way, questions for 1:1s, and requests people chose to share.", "/__l5e/assets-v1/ef59d682-254b-408a-a307-a88f75c9f424/screen-4-request-reply.jpg"],
              ["Leadership", "Engagement by department, attrition risk per team, and whether decisions actually helped.", "/__l5e/assets-v1/e095ef3c-42ee-4f13-9508-f27dd8a7818a/screen-6-heatmap.jpg"],
              ["HR", "Pulse and engagement campaigns by voice, with closed-loop follow-up.", "/__l5e/assets-v1/4d885f0a-3f9b-430b-b25c-29a6333d12c5/screen-3-team-trend.jpg"],
            ].map(([t, d, img]) => (
              <div key={t} className="card flex flex-col p-5">
                <img src={img} alt={`NOVA app screen for the ${t} role`} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover object-top" />
                <h3 className="mt-5 text-lg font-semibold">{t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Privacy */}
        <section id="privacy" className={`${wrap} scroll-mt-20 py-16`}>
          <H2>Trust is the product.</H2>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div className="card p-7">
              <h3 className="text-xl font-semibold">What the company gets</h3>
              <ul className="mt-4 space-y-3 text-muted-foreground">
                {["Team-level numbers and themes", "Requests an employee approved word for word", "Actions and their measured effect"].map((x) => (
                  <li key={x} className="flex gap-3"><span className="text-positive" aria-hidden>✓</span>{x}</li>
                ))}
              </ul>
            </div>
            <div className="card p-7">
              <h3 className="text-xl font-semibold">What it never gets</h3>
              <ul className="mt-4 space-y-3 text-muted-foreground">
                {["An employee's name next to an answer", "Their words or voice", "Results for teams under 5 people", "Individual “flight risk” scores", "Anything from their private coaching"].map((x) => (
                  <li key={x} className="flex gap-3"><span className="text-negative" aria-hidden>✕</span><s className="decoration-negative decoration-2">{x}</s></li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Sentiment is read from words, never from the voice (EU AI Act). NOVA is a coach, not a therapist: in a crisis it stops and points to real help.
          </p>
        </section>

        {/* Real call */}
        <section className={`${wrap} py-16`}>
          <H2>A real call</H2>
          <div className="card mx-auto mt-10 max-w-2xl space-y-4 p-6 sm:p-8">
            {[
              ["n", "Last time you planned to prepare one proposal for the next team meeting. Did you get to it?"],
              ["e", "Partly. I prepared it, but didn't present it. I got nervous when my manager was in the room."],
              ["n", "Would you like to make that your next step? Sharing your proposal with your manager before the meeting?"],
              ["e", "I will mail my manager the proposal by Wednesday."],
            ].map(([who, t], i) => (
              <div key={i} className={`flex ${who === "e" ? "justify-end" : ""}`}>
                <p className={`max-w-[85%] rounded-2xl px-4 py-3 ${who === "n" ? "rounded-bl-sm bg-primary text-primary-foreground" : "rounded-br-sm bg-warm text-background"}`}>
                  <span className="sr-only">{who === "n" ? "NOVA: " : "Employee: "}</span>
                  {t}
                </p>
              </div>
            ))}
            <div className="flex justify-center pt-2">
              <span className="rounded-full border border-positive/40 bg-positive/15 px-4 py-1.5 text-sm font-medium text-positive">
                ✓ New step saved · NOVA calls back after it's due
              </span>
            </div>
          </div>
        </section>

        {/* Under the hood */}
        <section className={`${wrap} py-16`}>
          <H2>Under the hood</H2>
          <ul className="mt-8 flex flex-wrap gap-3">
            {["Vapi (voice)", "Supabase (Postgres, row-level security, Edge Functions)", "OpenAI (Realtime voice, text analysis)", "Next.js app"].map((c) => (
              <li key={c} className="card px-4 py-2 text-sm">{c}</li>
            ))}
          </ul>
          <p className="mt-5 text-muted-foreground">Privacy rules live in the database itself, with tests for every one of them.</p>
        </section>

        {/* Team */}
        <section className={`${wrap} py-16`}>
          <H2>Team</H2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Oleg Zaim", "AI Product Engineer"],
              ["Viktor Moreev", "Software Architect"],
              ["Nick Kazakov", "Integrations & UI/UX"],
              ["Andrea Pirkov", "Delivery Manager"],
            ].map(([n, r]) => (
              <div key={n} className="card flex items-center gap-4 p-6">
                <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                  {(n ?? "").split(" ").map((w) => w.charAt(0)).join("")}
                </span>
                <div>
                  <h3 className="font-semibold">{n}</h3>
                  <p className="text-sm text-muted-foreground">{r}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className={`${wrap} py-24 text-center`}>
          <p className="mx-auto max-w-3xl text-3xl font-bold tight sm:text-5xl">
            Growth for every employee. <span className="text-gradient">Early, honest signals for every manager.</span>
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href="#demo" className={btnPrimary}>Watch the demo</a>
            <a href={APP} target="_blank" rel="noopener noreferrer" className={btnSecondary}>Open the app</a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className={`${wrap} flex flex-col items-center justify-between gap-3 py-8 text-sm text-muted-foreground sm:flex-row`}>
          <Logo />
          <p>© 2026 NOVA AI · Hackathon project</p>
        </div>
      </footer>
    </>
  );
}
