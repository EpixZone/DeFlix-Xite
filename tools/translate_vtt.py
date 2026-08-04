#!/usr/bin/env python3
"""Translate a VTT by SENTENCE, not by cue.

The source is YouTube ASR: no punctuation, and each cue is an arbitrary
fragment ("me down this path of questioning things"). Translating cue by cue
gives nonsense, because a machine translator needs a whole clause to pick
tense, gender and word order. So: join cues into sentence-sized blocks, send
the block, then hand the translated text back to the original cues in
proportion to how much of the block each one held. Timing never moves.
"""
import json, re, sys, time, urllib.parse, urllib.request

BLOCK_CHARS = 320          # a paragraph the translator can reason about
GAP_BREAK = 1.6            # seconds of silence that end a thought


def parse(path):
    cues = []
    for block in re.split(r"\n\n+", open(path, encoding="utf-8").read()):
        m = re.match(r"([\d:.]+) --> ([\d:.]+)", block.strip())
        if not m:
            continue
        text = " ".join(l.strip() for l in block.strip().splitlines()[1:] if l.strip())
        if text:
            cues.append({"start": m.group(1), "end": m.group(2), "text": text})
    return cues


def secs(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def blocks_of(cues):
    """Group consecutive cues into translatable blocks."""
    out, cur = [], []
    for i, c in enumerate(cues):
        cur.append(i)
        joined = " ".join(cues[j]["text"] for j in cur)
        gap = secs(cues[i + 1]["start"]) - secs(c["end"]) if i + 1 < len(cues) else 99
        if len(joined) >= BLOCK_CHARS or gap >= GAP_BREAK:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def gtranslate(text, target, tries=6):
    """Google's public translate endpoint, with backoff. Returns None on failure."""
    q = urllib.parse.urlencode({"client": "gtx", "sl": "en", "tl": target, "dt": "t", "q": text})
    url = "https://translate.googleapis.com/translate_a/single?" + q
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            raw = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
            data = json.loads(raw)
            return "".join(seg[0] for seg in data[0] if seg and seg[0])
        except Exception:
            time.sleep(min(2 ** attempt, 30))
    return None


# Where a line may be cut when a language writes without spaces.
CJK_BREAKS = "、。！？；：，）」』】・ "


def redistribute(translated, idxs, cues):
    """Split a translated block back over its cues, proportional to the share
    of the English each cue held.

    Two modes, because not every language delimits words with spaces. With
    spaces, hand out words. Without (Japanese, Chinese), whitespace splitting
    yields one giant token, every cue after the first gets nothing, and two
    thirds of the subtitles silently vanish - so hand out CHARACTERS instead,
    snapping each cut to nearby punctuation so lines break where a reader
    would pause.
    """
    if not translated.strip():
        return {}
    weights = [max(1, len(cues[i]["text"].split())) for i in idxs]
    total = sum(weights)
    tokens = translated.split()
    # Enough tokens to give most cues one? Then it is a spaced language.
    if len(tokens) >= max(2, len(idxs) * 0.8):
        out, pos = {}, 0
        for n, i in enumerate(idxs):
            take = len(tokens) - pos if n == len(idxs) - 1 else round(len(tokens) * weights[n] / total)
            take = max(0, min(take, len(tokens) - pos))
            out[i] = " ".join(tokens[pos:pos + take])
            pos += take
        return out

    text = translated.strip()
    out, pos = {}, 0
    for n, i in enumerate(idxs):
        if n == len(idxs) - 1:
            cut = len(text)
        else:
            cut = pos + max(1, round(len(text) * weights[n] / total))
            cut = min(cut, len(text))
            # Snap to a break character within a few glyphs, so a cue does not
            # end mid-compound when a natural pause is right there.
            window = range(max(pos + 1, cut - 3), min(len(text), cut + 4))
            snapped = [k for k in window if text[k - 1] in CJK_BREAKS]
            if snapped:
                cut = min(snapped, key=lambda k: abs(k - cut))
        out[i] = text[pos:cut].strip()
        pos = cut
    return out


def write_vtt(cues, texts, path):
    out = ["WEBVTT", ""]
    for i, c in enumerate(cues):
        t = texts.get(i, "").strip()
        if not t:
            continue
        out += [f"{c['start']} --> {c['end']}", t, ""]
    open(path, "w", encoding="utf-8").write("\n".join(out))


def main(src, target, out_path, pause=0.25):
    cues = parse(src)
    groups = blocks_of(cues)
    texts, failed = {}, 0
    for n, idxs in enumerate(groups):
        joined = " ".join(cues[i]["text"] for i in idxs)
        tr = gtranslate(joined, target)
        if tr is None:
            failed += 1
            continue
        texts.update(redistribute(tr, idxs, cues))
        time.sleep(pause)
        if n % 50 == 0:
            print(f"  {target}: {n}/{len(groups)} blocks", flush=True)
    write_vtt(cues, texts, out_path)
    print(f"{target}: {len(groups)} blocks, {failed} failed -> {out_path}", flush=True)
    return failed


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1], sys.argv[2], sys.argv[3]) > len(sys.argv) else 0)
