#!/usr/bin/env python3
"""Builds the 2-minute NOVA Coach pitch: timeline.json (scenes + subtitles) and audio.wav.

Inputs (real material, not committed): the two Vapi call recordings, the Vapi call JSON
(timings/transcripts), the phone screen recording and the local FE recording.
    python3 demo/pitch/build.py <workdir>   (expects <workdir>/inputs.json, see render.sh)
Subtitles follow the call transcripts; obvious speech-recognition slips are corrected
(marked in SUBS below) and long lines are split by word count across the spoken time.
"""
import hashlib, json, os, re, subprocess, sys, urllib.error, urllib.request
from pathlib import Path

work = Path(sys.argv[1])
cfg = json.loads((work / "inputs.json").read_text())
FFMPEG = cfg["ffmpeg"]
FFPROBE = cfg.get("ffprobe") or "ffprobe"

# ElevenLabs voiceover for the text-only parts (hook, description captions, outro).
# The real call voices come from the recordings and are never re-narrated (see VO below).
EL_KEY = os.environ.get("ELEVENLABS_API_KEY")
EL_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # default: Rachel
EL_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
VO_CACHE = Path(__file__).parent / ".vo-cache"  # keyed by voice+model+text, survives reruns

def say_text(text):
    """Make a caption readable aloud: drop decorative glyphs, spell out symbols."""
    text = text.strip().lstrip("….")
    for a, b in (("“", ""), ("”", ""), ("‘", ""), ("’", "'"), ("—", ", "),
                 (" → ", " to "), ("→", " to "), ("5+", "five plus"), ("1–5", "1 to 5"), ("–", "-")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()

def synth(text, speed=1.0):
    """Return a path to an mp3 of `text` in the narrator voice (cached). `speed` (ElevenLabs, ~0.7-1.2)
    shortens a naturally slow line without pitch artifacts; it only joins the cache key when non-default."""
    text = say_text(text)
    VO_CACHE.mkdir(exist_ok=True)
    tag = f"{EL_VOICE}|{EL_MODEL}|{text}" + (f"|s{speed}" if abs(speed - 1.0) > 1e-6 else "")
    out = VO_CACHE / (hashlib.sha1(tag.encode()).hexdigest()[:16] + ".mp3")
    if out.exists():
        return out
    if not EL_KEY:
        sys.exit("ELEVENLABS_API_KEY is not set and the voiceover is not cached — "
                 "export it (and optionally ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL) before rendering.")
    body = json.dumps({"text": text, "model_id": EL_MODEL,
                       "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.0, "use_speaker_boost": True, "speed": speed}}).encode()
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{EL_VOICE}?output_format=mp3_44100_128",
        data=body, headers={"xi-api-key": EL_KEY, "content-type": "application/json", "accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs TTS failed ({e.code}): {e.read().decode(errors='replace')[:300]}")
    out.write_bytes(data)
    return out

def probe_dur(p):
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())

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
t += 4.1  # room for the "Stored" voiceover to land at a natural pace
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

# Voiceover plan: narrate only the text-only moments. The hook and outro have on-screen text but no
# subtitle; every caption without a speaker is description (speaker-attributed captions are the real
# call voices and are left alone, so nothing is doubled). at/end bound each clip to its on-screen window.
outro = next(s for s in scenes if s["kind"] == "outro")
VO = [{"text": "Your employees won't tell you what's wrong. They'll tell NOVA.", "at": 0.6, "end": 4.8}]
# The "Stored" line reads slowly, so narrate it a touch faster (speed, not pitch) to fit its short beat.
VO += [{"text": c["text"], "at": c["start"] + 0.25, "end": c["end"] - 0.1,
        "speed": 1.2 if c["text"].startswith("Stored") else 1.0} for c in subs if c["speaker"] is None]
VO += [{"text": "Growth for every employee. Early, honest signals for every manager.",
        "at": outro["start"] + 0.5, "end": outro["end"] - 0.3}]

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

# Voiceover clips: synthesize, fit into their window (speed up only if they overrun), place at `at`.
# vo.json records the fitted clips so add_voiceover.py can lay them onto an already-rendered video.
vo_parts, vo_labels, vo_spans, vo_manifest = [], [], [], []
for j, v in enumerate(VO):
    clip = synth(v["text"], v.get("speed", 1.0))
    d = probe_dur(clip)
    inputs += ["-i", str(clip)]
    avail = max(0.5, v["end"] - v["at"])
    tempo = min(1.6, max(1.0, d / avail))  # never slow down; cap the speed-up to stay natural
    fd = d / tempo
    atempo = f"atempo={tempo:.4f}," if tempo > 1.001 else ""
    delay = int(round(v["at"] * 1000))
    vo_parts.append(
        f"[{2 + j}:a]aformat=sample_rates=48000:channel_layouts=stereo,{atempo}"
        f"afade=t=in:d=0.05,afade=t=out:st={max(0.0, fd - 0.14):.3f}:d=0.14,volume=1.1,"
        f"adelay={delay}|{delay}[n{j}]")
    vo_labels.append(f"[n{j}]")
    vo_spans.append((v["at"], v["at"] + fd))
    vo_manifest.append({"at": round(v["at"], 3), "tempo": round(tempo, 4), "dur": round(fd, 3),
                        "file": str(clip), "text": say_text(v["text"])})
(work / "vo.json").write_text(json.dumps(vo_manifest, indent=1))

speech_spans = []
for s in scenes:
    if s["kind"] in ("call", "pulse"):
        speech_spans.append((s["start"], s.get("stored_at", s["end"])))
duck = "+".join(f"between(t,{a - 0.4:.2f},{b + 0.2:.2f})" for a, b in speech_spans + vo_spans)
pad = (
    f"sine=f=220:d={total},volume=0.5[p1];sine=f=277.18:d={total},volume=0.35[p2];sine=f=329.63:d={total},volume=0.3[p3];"
    f"sine=f=110:d={total},volume=0.4[p4];[p1][p2][p3][p4]amix=inputs=4,lowpass=f=900,tremolo=f=0.15:d=0.5,"
    f"aformat=sample_rates=48000:channel_layouts=stereo,volume='0.6*(1-0.9*min(1,{duck}))':eval=frame,"
    f"afade=t=in:d=2,afade=t=out:st={total - 2.5}:d=2.5[pad]"
)
graph_parts = parts + vo_parts + [pad,
    "".join(labels) + f"amix=inputs={len(labels)}:normalize=0,dynaudnorm=f=300:g=11:m=6[speech]"]
mix = ["[speech]", "[pad]"]
if vo_labels:
    graph_parts.append("".join(vo_labels) + f"amix=inputs={len(vo_labels)}:normalize=0[vo]")
    mix.insert(1, "[vo]")
graph_parts.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0,alimiter=limit=0.95[out]")
graph = ";".join(graph_parts)
subprocess.run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[out]", "-t", str(total),
                "-ar", "48000", str(work / "audio.wav")], check=True)
print(f"timeline {total:.1f}s, {len(subs)} subtitles, {len(audio)} audio segments, {len(VO)} voiceover clips")
