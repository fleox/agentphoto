import json, re, sys, soundfile as sf, numpy as np
from kokoro_onnx import Kokoro
IPA = {
 "AgentPhoto": "ˈeɪdʒənt fˈoʊɾoʊ", "PNG": "pˌiːˌɛnˈdʒiː", "JPEG": "dʒˈeɪpɛɡ", "WebP": "wˈɛb pˈiː", "YouTube": "jˈuːtuːb", "Agent3D": "ˈeɪdʒənt θɹˈiː dˈiː", "3D": "θɹˈiː dˈiː", "CLI": "sˌiːˌɛlˈaɪ", "MCP": "ˌɛmsˌiːpˈiː",
 "AI": "ˌeɪˈaɪ", "WebGL": "wˈɛb dʒˌiːˈɛl", "JSON": "dʒˈeɪsən", "npm": "ˌɛnpˌiːˈɛm", "npx": "ˌɛnpˌiːˈɛks",
 "Three.js": "θɹˈiː dʒˌeɪˈɛs", "SaaS": "sˈæs", "HDRI": "ˌeɪtʃdˌiːˌɑːɹˈaɪ", "CC0": "sˌiːsˈiː zˈiəɹoʊ",
 "GIF": "ɡˈɪf", "MP4": "ˌɛmpˌiːfˈɔːɹ", "Claude Code": "klˈɔːd kˈoʊd", "Hermes": "hˈɜːmiːz", "HTML": "ˌeɪtʃtˌiːˌɛmˈɛl",
}
pat = re.compile(r"(?<![\w.])(" + "|".join(re.escape(k) for k in sorted(IPA, key=len, reverse=True)) + r")(?![\w])")
k = Kokoro(sys.argv[1], sys.argv[2])
lines = json.load(open(sys.argv[3])); out = sys.argv[4]
durs = {}
for lid, text in lines:
    parts = []; pos = 0
    for m in pat.finditer(text):
        pre = text[pos:m.start()]
        if pre.strip(): parts.append(k.tokenizer.phonemize(pre, "en-us"))
        parts.append(IPA[m.group(1)]); pos = m.end()
    rest = text[pos:]
    if rest.strip(): parts.append(k.tokenizer.phonemize(rest, "en-us"))
    parts = [re.sub(r"(^|\s)ˈeɪ$", r"\1ɐ", p.strip()) for p in parts]
    ph = " ".join(p.strip() for p in parts)
    ph = re.sub(r"\s+([,.:?!])", r"\1", ph)
    audio, sr = k.create(ph, voice="af_heart", speed=0.95, is_phonemes=True)
    sf.write(f"{out}/{lid}.wav", audio, sr)
    durs[lid] = round(len(audio)/sr, 3)
    print(lid, durs[lid], ph, flush=True)
json.dump(durs, open(f"{out}/durations.json","w"), indent=1)
