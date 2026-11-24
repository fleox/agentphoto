#!/usr/bin/env python3
"""Assemble the AgentPhoto demo film. Usage: build.py [assets|segments|final|all]"""
import json, os, subprocess, sys, re, math
from urllib.parse import urlencode

ROOT = "/tmp/ap-film"
C = f"{ROOT}/clips"
P = f"{ROOT}/cards/png"
S = f"{ROOT}/seg"
REC = "/tmp/ap-rec"
STUDIO = f"{ROOT}/rec/out/studio-raw.mp4"
FPS = 30
XF = 0.4  # crossfade between segments
DUR = json.load(open(f"{ROOT}/tts/wav/durations.json"))
LINES = dict(json.load(open(f"{ROOT}/tts/lines.json")))
os.makedirs(S, exist_ok=True)

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(" ".join(cmd)[:3000]); print(r.stderr[-3000:]); sys.exit(1)

# ---------- layout rects ----------
FULL = (160, 24, 1600, 900)
def rect(w, h):
    return (160 + (1600 - w) // 2, 24 + (900 - h) // 2, w, h)

# ---------- segments ----------
# each: id, dur, kind, params, lines [(id, start)]
SEG = []
def seg(id, dur, kind, lines=(), **kw):
    SEG.append(dict(id=id, dur=dur, kind=kind, lines=list(lines), **kw))

seg("teaser", 4.2, "clip", [("a1", 0.6)], src=f"{C}/food.mp4", start=0.0, size=(1350, 900),
    chip=("before → after", "one adjustment layer"))
seg("title", 13.4, "cards", [("a2", 0.4), ("b1", 5.0), ("b2", 7.65), ("b3", 10.0)],
    states=[("title0", 0), ("title1", 4.85), ("title2", 7.5), ("title3", 9.85)])
seg("retouch", 0, "term", [("c1", 0.4), ("c2", 6.1), ("c3", 12.4)],
    src=f"{REC}/retouch.mp4", real=(9.5, 15.8), fast=(15.8, 108.0), speed=16, hold=3.4)
seg("retouch-still", 4.6, "clip", [("c4", 0.6)], src=f"{C}/lake.mp4", start=0.0, size=(1350, 900),
    chip=("result", "the agent's own before / after"))
seg("cutout", 0, "term", [("d1", 0.4), ("d2", 5.2)],
    src=f"{REC}/cutout.mp4", real=(9.5, 15.3), fast=(15.3, 136.0), speed=16, hold=1.2)
seg("cutout-still", 3.0, "still", [("d3", 0.4)], src=f"{REC}/still-cutout.jpg", size=(880, 880),
    chip=("result", "the agent's export, 2000 × 2000 JPEG"))
seg("design", 0, "term", [("e1", 0.4)],
    src=f"{REC}/design-clean.mp4", real=(9.5, 15.5), fast=(15.5, 174.0), speed=32, hold=1.2)
seg("design-still", 2.8, "still", [("e2", 0.5)], src=f"{REC}/still-design.png", size=(1600, 432),
    chip=("result", "the agent's thumbnail and link preview"))
seg("showcase", 0, "montage", [("f1", 0.3), ("f2", 2.9), ("f3", 6.6)],
    shots=[
        ("youtube-thumbnail.mp4", 0.0, 1.5, (1600, 900), "youtube-thumbnail"),
        ("og-article.mp4", 0.0, 1.4, (1600, 840), "og-article"),
        ("story-promo.mp4", 0.0, 1.3, (506, 900), "story-promo"),
        ("sale-banner.mp4", 0.0, 1.4, (1600, 500), "sale-banner"),
        ("product-white.mp4", 0.0, 1.4, (900, 900), "product-white"),
        ("portrait.mp4", 0.6, 2.4, (1350, 900), "portrait retouch"),
        ("polaroid.mp4", 0.0, 1.2, (720, 900), "polaroid"),
        ("city.mp4", 0.6, 2.2, (1350, 900), "black and white"),
        ("social-quote.mp4", 0.0, 1.3, (900, 900), "social-quote"),
    ])
seg("studio", 0, "studio", [("g1", 0.3), ("g2", 4.4), ("g3", 13.2)],
    cuts=[(1.4, 6.2), (12.6, 17.6), (21.8, 25.8), (40.2, 45.4)])
seg("how", 11.2, "image", [("h1", 0.4), ("h2", 6.9)], src=f"{os.environ['REPO']}/.github/assets/how-it-works-dark.png", pos=(60, 132))
seg("export", 11.4, "cards", [("i1", 0.4), ("i2", 5.4), ("i3", 8.5)],
    states=[("export1", 0), ("export2", 5.25), ("export3", 8.35)])
seg("end", 8.8, "cards", [("j1", 0.5), ("k1", 4.6)], states=[("end", 0)], fadeout=1.0)

def term_dur(s):
    return (s["real"][1] - s["real"][0]) + (s["fast"][1] - s["fast"][0]) / s["speed"] + s["hold"]
for s in SEG:
    if s["kind"] == "term":
        s["dur"] = round(term_dur(s), 3)
    if s["kind"] == "montage":
        s["dur"] = round(sum(x[2] for x in s["shots"]), 3)
    if s["kind"] == "studio":
        s["dur"] = round(sum(b - a for a, b in s["cuts"]), 3)

# ---------- assets (Chrome renders) ----------
def subtitle_chunks(text, dur):
    # split long lines at punctuation into chunks of <= 58 chars
    if len(text) <= 58:
        return [(text, 0, dur)]
    parts = re.split(r"(?<=[,:.?])\s+", text)
    chunks, cur = [], ""
    for p in parts:
        if cur and len(cur) + 1 + len(p) > 58:
            chunks.append(cur); cur = p
        else:
            cur = (cur + " " + p).strip()
    if cur: chunks.append(cur)
    out, t, total = [], 0.0, sum(len(c) for c in chunks)
    for c in chunks:
        d = dur * len(c) / total
        out.append((c, t, t + d)); t += d
    return out

def jobs():
    j = [("v=bg", "bg.png")]
    for n in range(4): j.append((f"v=title&n={n}", f"title{n}.png"))
    for n in (1, 2, 3): j.append((f"v=export&n={n}", f"export{n}.png"))
    j.append(("v=end", "end.png"))
    sizes = {(1600, 900)}
    for s in SEG:
        if s.get("size"): sizes.add(tuple(s["size"]))
        for sh in s.get("shots", []): sizes.add(tuple(sh[3]))
    for (w, h) in sizes:
        x, y, _, _ = rect(w, h)
        j.append((urlencode(dict(v="frame", x=x, y=y, w=w, h=h)), f"frame-{w}x{h}.png"))
        j.append((urlencode(dict(v="mask", w=w, h=h, r=18)) , f"mask-{w}x{h}.png"))
    chips = {}
    for s in SEG:
        if s.get("chip"): chips[s["chip"]] = None
        for sh in s.get("shots", []): chips[("template", sh[4])] = None
    chips[("Studio", "real time")] = None
    chips[("", "Real Claude Code session")] = None
    for i, (k, t) in enumerate(chips):
        j.append((urlencode(dict(v="chip", x=0, y=0, k=k, t=t)), f"chip-{i}.png"))
    for sp in sorted({s["speed"] for s in SEG if s["kind"] == "term"}):
        j.append((urlencode(dict(v="speed", r=0, y=0, t=f"sped up ×{sp}")), f"speed-{sp}.png"))
    subs = []
    for s in SEG:
        for lid, st in s["lines"]:
            for k, (c, a, b) in enumerate(subtitle_chunks(LINES[lid], DUR[lid])):
                subs.append((lid, k, c, a, b))
                j.append((urlencode(dict(v="sub", t=c)), f"sub-{lid}-{k}.png"))
    json.dump(j, open(f"{ROOT}/cards/jobs.json", "w"))
    json.dump({f"{k}|{t}": f"chip-{i}.png" for i, (k, t) in enumerate(chips)}, open(f"{ROOT}/cards/chips.json", "w"))
    return j

def build_assets():
    jobs()
    subprocess.run(["node", f"{ROOT}/rec/rec.mjs", "about:blank", f"{ROOT}/rec/shots.mjs", P],
                   env={**os.environ, "JOBS": f"{ROOT}/cards/jobs.json"}, timeout=600)
    # trim chips / speed labels to their content (they were rendered at 0,0 on a 1920x1080 transparent page)
    for f in os.listdir(P):
        if f.startswith(("chip-", "speed-")):
            run(["magick", f"{P}/{f}", "-trim", "+repage", f"{P}/{f}"])
        if f.startswith("mask-"):
            run(["magick", f"{P}/{f}", "-crop", f[5:-4] + "+0+0", "+repage", f"{P}/{f}"])
        if f.startswith("sub-"):
            run(["magick", f"{P}/{f}", "-crop", "1920x160+0+920", "+repage", f"{P}/{f}"])

def png_w(f):
    return int(subprocess.run(["magick", "identify", "-format", "%w", f], capture_output=True, text=True).stdout)

def chip(k, t):
    return f"{P}/" + json.load(open(f"{ROOT}/cards/chips.json"))[f"{k}|{t}"]

ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", "-r", str(FPS)]

def clip_in_frame(inputs, vf_pre, size, chip_png, out, dur, extra_overlays=(), corner="tl"):
    """inputs: list of ffmpeg input args producing [0:v] = video; size = (w,h)."""
    w, h = size; x, y, _, _ = rect(w, h)
    args = ["ffmpeg", "-v", "error", "-y", *inputs,
            "-loop", "1", "-i", f"{P}/frame-{w}x{h}.png",
            "-loop", "1", "-i", f"{P}/mask-{w}x{h}.png",
            "-loop", "1", "-i", chip_png]
    n = inputs.count("-i")
    g = (f"{vf_pre}scale={w}:{h}:flags=lanczos,setsar=1,format=rgba[v];"
         f"[{n+1}:v]format=gray,scale={w}:{h}[m];[v][m]alphamerge[vm];"
         f"[{n}:v][vm]overlay={x}:{y}:shortest=0[b];[b][{n+2}:v]overlay=" + (f"{x+18}:{y+18}" if corner == "tl" else f"{x+w-18}-w:{y+h-18}-h") + "[o]")
    args += ["-filter_complex", g, "-map", "[o]", "-t", f"{dur:.3f}", *ENC, out]
    run(args)

def build_segments(only=None):
    for s in SEG:
        if only and s["id"] not in only: continue
        out = f"{S}/{s['id']}.mp4"; d = s["dur"]; k = s["kind"]
        print("segment", s["id"], k, d, flush=True)
        if k == "fullclip":
            run(["ffmpeg", "-v", "error", "-y", "-ss", str(s["start"]), "-i", s["src"], "-vf",
                 "scale=1920:1080:flags=lanczos,setsar=1", "-t", f"{d:.3f}", *ENC, out])
        elif k == "cards":
            ins, g, prev = [], "", None
            st = s["states"]
            for i, (name, t0) in enumerate(st):
                t1 = st[i + 1][1] if i + 1 < len(st) else d
                ln = t1 - t0 + (0.35 if i + 1 < len(st) else 0)
                ins += ["-loop", "1", "-framerate", str(FPS), "-t", f"{ln:.3f}", "-i", f"{P}/{name}.png"]
            if len(st) == 1:
                g = "[0:v]format=yuv420p"
                if s.get("fadeout"): g += f",fade=t=out:st={d - s['fadeout']:.3f}:d={s['fadeout']}"
                g += "[o]"
            else:
                cur = "[0:v]"
                for i in range(1, len(st)):
                    g += f"{cur}[{i}:v]xfade=transition=fade:duration=0.35:offset={st[i][1]:.3f}[x{i}];"
                    cur = f"[x{i}]"
                g += f"{cur}format=yuv420p[o]"
            run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", g, "-map", "[o]", "-t", f"{d:.3f}", *ENC, out])
        elif k == "term":
            r0, r1 = s["real"]; f0, f1 = s["fast"]; sp = s["speed"]; hold = s["hold"]
            fd = (f1 - f0) / sp; t_fast = r1 - r0
            x, y, w, h = FULL
            CHIPW = png_w(chip("", "Real Claude Code session"))
            g = (f"[0:v]trim={r0}:{r1},setpts=PTS-STARTPTS,fps={FPS}[a];"
                 f"[0:v]trim={f0}:{f1},setpts=(PTS-STARTPTS)/{sp},fps={FPS}[b];"
                 f"[0:v]trim={f1}:{f1 + hold + 0.5},setpts=PTS-STARTPTS,fps={FPS}[c];"
                 f"[a][b][c]concat=n=3:v=1:a=0,scale={w}:{h}:flags=lanczos,setsar=1,format=rgba[v];"
                 f"[2:v]format=gray,scale={w}:{h}[m];[v][m]alphamerge[vm];"
                 f"[1:v][vm]overlay={x}:{y}[b1];"
                 f"[b1][3:v]overlay=W-{160+16}-w:{y+10}[b2];"
                 f"[b2][4:v]overlay=W-{160+16+10}-w-{CHIPW}:{y+10}:enable='between(t,{t_fast:.3f},{t_fast+fd:.3f})'[o]")
            run(["ffmpeg", "-v", "error", "-y", "-i", s["src"],
                 "-loop", "1", "-i", f"{P}/frame-1600x900.png", "-loop", "1", "-i", f"{P}/mask-1600x900.png",
                 "-loop", "1", "-i", chip("", "Real Claude Code session"), "-loop", "1", "-i", f"{P}/speed-{sp}.png",
                 "-filter_complex", g, "-map", "[o]", "-t", f"{d:.3f}", *ENC, out])
        elif k == "still":
            w, h = s["size"]
            clip_in_frame(["-loop", "1", "-framerate", str(FPS), "-i", s["src"]], "[0:v]", (w, h), chip(*s["chip"]), out, d)
        elif k == "clip":
            w, h = s["size"]
            clip_in_frame(["-ss", str(s["start"]), "-i", s["src"]], "[0:v]tpad=stop_mode=clone:stop_duration=5,", (w, h), chip(*s["chip"]), out, d)
        elif k == "image":
            x, y = s["pos"]
            run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", str(FPS), "-i", f"{P}/bg.png", "-loop", "1", "-i", s["src"],
                 "-filter_complex", f"[0:v][1:v]overlay={x}:{y},format=yuv420p[o]", "-map", "[o]", "-t", f"{d:.3f}", *ENC, out])
        elif k == "montage":
            parts = []
            for i, (src, st0, ln, size, label) in enumerate(s["shots"]):
                p = f"{S}/shot-{i}.mp4"
                clip_in_frame(["-ss", str(st0), "-i", f"{C}/{src}"], "[0:v]tpad=stop_mode=clone:stop_duration=5,", size, chip("template", label), p, ln)
                parts.append(p)
            lst = f"{S}/montage.txt"
            open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
            run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out])
        elif k == "studio":
            g = ""; labels = ""
            for i, (a, b) in enumerate(s["cuts"]):
                g += f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS,fps={FPS}[s{i}];"; labels += f"[s{i}]"
            g += f"{labels}concat=n={len(s['cuts'])}:v=1:a=0,"
            # clip_in_frame expects a pre-chain ending with ','
            clip_in_frame(["-i", STUDIO], g, (1600, 900), chip("Studio", "real time"), out, d, corner="br")

def timeline():
    t, starts = 0.0, []
    for i, s in enumerate(SEG):
        starts.append(t)
        t += s["dur"] - (XF if i + 1 < len(SEG) else 0)
    return starts, t

def build_final():
    starts, total = timeline()
    ins = []
    for s in SEG: ins += ["-i", f"{S}/{s['id']}.mp4"]
    g, cur, acc = "", "[0:v]", 0.0
    for i in range(1, len(SEG)):
        acc += SEG[i - 1]["dur"] - XF
        g += f"{cur}[{i}:v]xfade=transition=fade:duration={XF}:offset={acc:.3f}[v{i}];"
        cur = f"[v{i}]"
    # subtitles + narration
    n = len(SEG); sub_in, audio, k = [], [], 0
    srt = []
    for si, s in enumerate(SEG):
        for lid, st in s["lines"]:
            t0 = starts[si] + st
            for c, (text, a, b) in enumerate(subtitle_chunks(LINES[lid], DUR[lid])):
                a0, b0 = t0 + a, t0 + b + (0.3 if c == len(subtitle_chunks(LINES[lid], DUR[lid])) - 1 else 0.0)
                srt.append([a0, b0, text, f"{P}/sub-{lid}-{c}.png"])
            audio.append((lid, t0))
    srt.sort()
    for i in range(len(srt) - 1):
        srt[i][1] = min(srt[i][1], srt[i + 1][0] - 0.04)
    for a0, b0, text, png in srt:
        sub_in += ["-loop", "1", "-i", png]
        g += f"{cur}[{n + k}:v]overlay=0:920:shortest=0:enable='between(t,{a0:.3f},{b0:.3f})'[u{k}];"
        cur = f"[u{k}]"; k += 1
    na = len(audio); ai = []
    for lid, t0 in audio: ai += ["-i", f"{ROOT}/tts/wav/{lid}.wav"]
    for j, (lid, t0) in enumerate(audio):
        ms = int(round(t0 * 1000))
        g += f"[{n + k + j}:a]aresample=48000,adelay={ms}|{ms}[a{j}];"
    g += "".join(f"[a{j}]" for j in range(na)) + f"amix=inputs={na}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,afade=t=out:st={total-1.0:.3f}:d=1,apad[aout];"
    g += f"{cur}format=yuv420p[vout]"
    out = sys.argv[2] if len(sys.argv) > 2 else f"{ROOT}/agentphoto-demo.mp4"
    run(["ffmpeg", "-v", "error", "-y", *ins, *sub_in, *ai, "-filter_complex", g, "-map", "[vout]", "-map", "[aout]",
         "-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "slow", "-crf", os.environ.get("CRF", "21"), "-maxrate", os.environ.get("MAXRATE", "2400k"), "-bufsize", "4800k",
         "-pix_fmt", "yuv420p", "-r", str(FPS), "-profile:v", "high", "-c:a", "aac", "-b:a", "128k", "-ac", "1", "-movflags", "+faststart", out])
    # report
    with open(f"{ROOT}/chapters.txt", "w") as f:
        for s, t in zip(SEG, starts): f.write(f"{t:7.2f}  {s['id']}  ({s['dur']:.2f}s)\n")
        f.write(f"total {total:.2f}\n")
        for a, b, text, _ in srt: f.write(f"  {a:7.2f}-{b:7.2f}  {text}\n")
    print(open(f"{ROOT}/chapters.txt").read())

if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("assets", "all"): build_assets()
    if what in ("segments", "all"): build_segments()
    if what.startswith("seg:"): build_segments(what[4:].split(","))
    if what in ("final", "all"): build_final()
    if what == "plan":
        starts, total = timeline()
        for s, t in zip(SEG, starts):
            ends = [(lid, st, st + DUR[lid]) for lid, st in s["lines"]]
            over = [f"{lid}:{a:.2f}-{b:.2f}" + (" OVER" if b > s["dur"] - 0.1 else "") for lid, a, b in ends]
            print(f"{t:7.2f} {s['id']:14s} {s['dur']:6.2f}  " + "  ".join(over))
        print("total", round(total, 2))
