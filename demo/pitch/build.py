#!/usr/bin/env python3
"""Builds the 2-minute NOVA Coach pitch: timeline.json (scenes + subtitles) and audio.wav.

Inputs (real material, not committed): the two Vapi call recordings, the Vapi call JSON
(timings/transcripts), the phone screen recording and the local FE recording.
    python3 demo/pitch/build.py <workdir>   (expects <workdir>/inputs.json, see render.sh)
Subtitles follow the call transcripts; obvious speech-recognition slips are corrected
(marked in SUBS below) and long lines are split by word count across the spoken time.
"""
import json, subprocess, sys
from pathlib import Path

work = Path(sys.argv[1])
cfg = json.loads((work / "inputs.json").read_text())
FFMPEG = cfg["ffmpeg"]

def msgs(call_json):
    return [m for m in json.loads(Path(call_json).read_text())["messages"] if m.get("role") in ("bot", "user")]

# (source start, source end, speaker, subtitle). Times are seconds in the call recording.
COACH = [
    (1.30, 8.20, "NOVA", "Hi Oleg, it's NOVA, your coach. Last time you planned to prepare one proposal for the next team meeting. Did you get to it?"),
    # ASR heard "after 30, it's" for "partly, I prepared it"
    (11.65, 19.35, "Oleg", "Partly. I prepared it, but didn't present it. I got nervous when my manager was in the room."),
    (21.15, 27.95, "NOVA", "It sounds like you prepared well, but felt nervous about presenting. What do you think made you nervous about your manager being there?"),
    (31.15, 35.00, "Oleg", "Others spoke first, and I felt my idea wasn't really ready."),
    (48.60, 52.40, "Oleg", "Send it to my manager before the meeting, so it's already on the table."),
    (55.85, 62.65, "NOVA", "That sounds like a proactive idea. Would you like to make that your next step? Sharing your proposal with your manager before the meeting?"),
    (64.85, 68.35, "Oleg", "I will mail my manager the proposal by Wednesday."),
    (71.70, 77.60, "NOVA", "That's great, Oleg. You've committed to emailing your manager the proposal by Wednesday."),
]
PULSE = [
    (2.45, 7.60, "NOVA", "Hi. This is NOVA with a two-minute anonymous check-in from your company. Is now a good time?"),
    (18.35, 22.20, "NOVA", "Let's get started. From 1 to 5, how was your work week?"),
    (44.95, 47.00, "Oleg", "From 1 to 5, it's 3."),
    (49.90, 52.00, "NOVA", "Thank you. What makes it a 3?"),
    (53.00, 57.30, "Oleg", "I get the same kind of tasks every week, and I'm not learning much."),
]
GAP = 0.35

scenes, subs, audio = [], [], []
t = 0.0

def scene(kind, dur, **kw):
    global t
    scenes.append({"kind": kind, "start": round(t, 3), "end": round(t + dur, 3), **kw})
    t += dur

def caption(text, start, end, speaker=None):
    subs.append({"start": round(start, 3), "end": round(end, 3), "speaker": speaker, "text": text})

def speech(segments, src, extra=None):
    """Places call segments back to back from the current time; returns (start, events)."""
    global t
    events = []
    for a, b, who, text in segments:
        dur = b - a
        audio.append({"src": src, "from": a, "to": b, "at": round(t, 3)})
        words = text.split()
        chunks = [words[i:i + 11] for i in range(0, len(words), 11)]
        if len(chunks) > 1 and len(chunks[-1]) < 4:
            last = chunks.pop()
            chunks[-1] += last
        at = t
        for c in chunks:
            d = dur * len(c) / len(words)
            caption(" ".join(c), at, at + d, who)
            at += d
        events.append({"src_from": a, "at": round(t, 3), "dur": round(dur, 3), "speaker": who})
        t += dur + GAP
    return events

# 0. Hook
scene("hook", 5.0)

# 1. Real coach call (phone screen + audio)
start = t
ev = speech(COACH, "coach")
commit_at = next(e["at"] for e in ev if e["src_from"] == 64.85) + 3.6  # coach_commit_step fired at 68.5 s
scenes.append({"kind": "call", "start": round(start, 3), "end": round(t, 3), "segments": ev,
               "phone_offset": cfg["phone_offset"], "commit_at": round(commit_at, 3)})

# 2. Consent: only the approved sentence goes to the manager
scene("fe", 6.0, clip="f1", chapter="Private by default", focus=[0.33, 0.57, 1.55])
caption("Oleg approves one sentence for his manager. Everything else stays private.", t - 6.0, t)

# 3. Anonymous pulse (audio + what is stored)
start = t
ev = speech(PULSE, "pulse")
scene_end_speech = t
t += 3.5
scenes.append({"kind": "pulse", "start": round(start, 3), "end": round(t, 3), "segments": ev, "stored_at": round(scene_end_speech, 3)})
caption("Stored: numbers and themes. No name, no words, no voice.", scene_end_speech, t)

# 4. Manager
for clip, dur, focus, text in [
    ("f2", 5.0, [0.36, 0.44, 1.5], "His manager sees how the team is doing, only for groups of 5+ people."),
    ("f3", 7.5, [0.5, 0.64, 1.28], "…and the request Oleg chose to share. One click: “Will act”."),
    ("f4", 5.5, [0.42, 0.42, 1.45], "AI suggests an action from team-level results. Published as “You said, we did”."),
]:
    scene("fe", dur, clip=clip, chapter="Manager", focus=focus)
    caption(text, t - dur, t)
scene("fe", 5.0, clip="f5", chapter="Employee", focus=[0.33, 0.58, 1.65])
caption("Oleg sees his manager's answer. The loop is closed.", t - 5.0, t)

# 5. Leadership
scene("fe", 5.0, clip="f6", chapter="Leadership", focus=[0.55, 0.86, 1.5])
caption("Leadership: engagement by department. Teams under 5 people stay hidden.", t - 5.0, t)
scene("fe", 6.0, clip="f7", chapter="Leadership", focus=[0.2, 0.52, 2.1])
caption("And it measures whether the action worked: engagement 55 → 60.", t - 6.0, t)

# 6. Outro
scene("outro", 5.0)
total = round(t, 3)

(work / "timeline.json").write_text(json.dumps({"total": total, "fps": 30, "scenes": scenes, "subs": subs}, indent=1))

# Audio: call segments at their timeline positions (short fades at cuts) over a quiet pad that ducks under speech.
inputs = ["-i", cfg["coach_wav"], "-i", cfg["pulse_wav"]]
parts, labels = [], []
for i, a in enumerate(audio):
    idx = 0 if a["src"] == "coach" else 1
    d = a["to"] - a["from"]
    parts.append(
        # Vapi records the employee on the left and the assistant on the right: centre both.
        f"[{idx}:a]atrim={a['from']}:{a['to']},asetpts=PTS-STARTPTS,pan=stereo|c0=c0+c1|c1=c0+c1,aformat=sample_rates=48000:channel_layouts=stereo,"
        f"afade=t=in:d=0.06,afade=t=out:st={d - 0.12:.3f}:d=0.12,volume=1.6,adelay={int(a['at'] * 1000)}|{int(a['at'] * 1000)}[s{i}]"
    )
    labels.append(f"[s{i}]")
speech_spans = []
for s in scenes:
    if s["kind"] in ("call", "pulse"):
        speech_spans.append((s["start"], s.get("stored_at", s["end"])))
duck = "+".join(f"between(t,{a - 0.4:.2f},{b + 0.2:.2f})" for a, b in speech_spans)
pad = (
    f"sine=f=220:d={total},volume=0.5[p1];sine=f=277.18:d={total},volume=0.35[p2];sine=f=329.63:d={total},volume=0.3[p3];"
    f"sine=f=110:d={total},volume=0.4[p4];[p1][p2][p3][p4]amix=inputs=4,lowpass=f=900,tremolo=f=0.15:d=0.5,"
    f"aformat=sample_rates=48000:channel_layouts=stereo,volume='0.6*(1-0.9*min(1,{duck}))':eval=frame,"
    f"afade=t=in:d=2,afade=t=out:st={total - 2.5}:d=2.5[pad]"
)
graph = ";".join(parts + [pad,
    "".join(labels) + f"amix=inputs={len(labels)}:normalize=0,dynaudnorm=f=300:g=11:m=6[speech]",
    "[speech][pad]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]"])
subprocess.run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[out]", "-t", str(total),
                "-ar", "48000", str(work / "audio.wav")], check=True)
print(f"timeline {total:.1f}s, {len(subs)} subtitles, {len(audio)} audio segments")
