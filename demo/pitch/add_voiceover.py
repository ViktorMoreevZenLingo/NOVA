#!/usr/bin/env python3
"""Lay the ElevenLabs voiceover onto an already-rendered pitch video (no re-render needed).

The narration only lands in the text-only windows (hook, description captions, outro), which in the
rendered video carry just the quiet music pad — so the voice sits clearly on top without touching the
real call audio. Each clip is level-matched (loudnorm) so it reads like the in-call voice.

    python3 demo/pitch/add_voiceover.py <vo.json> <in.mp4> <out.mp4>
      <vo.json>  manifest written by build.py (at / tempo / file per clip)
      FFMPEG=... overrides the ffmpeg binary.
"""
import json, os, subprocess, sys
from pathlib import Path

vo = json.loads(Path(sys.argv[1]).read_text())
src, dst = sys.argv[2], sys.argv[3]
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")

inputs = ["-i", src]
parts, labels = [], []
for j, c in enumerate(vo):
    inputs += ["-i", c["file"]]
    delay = int(round(c["at"] * 1000))
    atempo = f"atempo={c['tempo']:.4f}," if c.get("tempo", 1.0) > 1.001 else ""
    # loudnorm matches each clip to the call loudness; afade avoids clicks; adelay places it on the timeline.
    parts.append(
        f"[{j + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,{atempo}"
        f"loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.05,afade=t=out:st={max(0.0, c['dur'] - 0.14):.3f}:d=0.14,"
        f"adelay={delay}|{delay}[n{j}]")
    labels.append(f"[n{j}]")

# Mix the original audio with every voiceover clip; limiter guards the sum from clipping.
graph = ";".join(parts + [
    "[0:a]" + "".join(labels) + f"amix=inputs={len(labels) + 1}:normalize=0,alimiter=limit=0.97[out]"])
subprocess.run([FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", graph,
                "-map", "0:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart", dst], check=True)
print(f"wrote {dst}  ({len(vo)} voiceover clips)")
