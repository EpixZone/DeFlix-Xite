#!/usr/bin/env python3
"""Fetch curated films into the EpixScreen xite on this host.

Resumable: a film already present with the right size is skipped, and partial
downloads continue where they stopped. Writes a manifest fragment per film so
the catalogue can be rebuilt without re-reading every video.

  fetch.py <candidates.json> <xite-dir> [--limit N] [--workers N]
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = "EpixScreen-fetch/1.0 (library ingest; contact via epixnet)"


def head_size(url):
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            return int(r.headers.get("Content-Length") or 0)
    except Exception:                                  # noqa: BLE001
        return 0


def download(url, dest, expect):
    """Resume onto dest; return True when the file is complete."""
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    if expect and have == expect:
        return True
    if have > expect > 0:                              # stale/corrupt, start over
        os.remove(dest)
        have = 0
    for attempt in range(3):
        cmd = ["curl", "-sSL", "--fail", "--connect-timeout", "30", "--max-time", "7200",
               "-A", UA, "-o", dest, url]
        if have:
            cmd[1:1] = ["-C", "-"]
        rc = subprocess.run(cmd, capture_output=True).returncode
        size = os.path.getsize(dest) if os.path.exists(dest) else 0
        if rc == 0 and (not expect or size >= expect * 0.99):
            return True
        have = size
        time.sleep(3 * (attempt + 1))
    return False


def probe(path):
    """Duration in seconds, and the frame height, straight from the file."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "format=duration:stream=height",
             "-of", "json", path],
            capture_output=True, text=True, timeout=180).stdout
        d = json.loads(out)
        dur = float(d.get("format", {}).get("duration") or 0)
        streams = d.get("streams") or [{}]
        return round(dur), int(streams[0].get("height") or 0)
    except Exception:                                  # noqa: BLE001
        return 0, 0


def poster(film, xite, video_rel):
    """Archive.org's own thumbnail, falling back to a frame from the film."""
    dest = os.path.join(xite, "poster", film["video_id"] + ".jpg")
    if os.path.exists(dest) and os.path.getsize(dest) > 3000:
        return "poster/" + film["video_id"] + ".jpg"
    try:
        subprocess.run(["curl", "-sSL", "--fail", "--max-time", "90", "-A", UA,
                        "-o", dest, film["thumb"]], capture_output=True, timeout=120)
    except Exception:                                  # noqa: BLE001
        pass
    if not os.path.exists(dest) or os.path.getsize(dest) < 3000:
        # Grab a frame a little way in, past any title card.
        src = os.path.join(xite, video_rel)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "60", "-i", src,
                        "-frames:v", "1", "-vf", "scale=640:-2", dest],
                       capture_output=True, timeout=300)
    if os.path.exists(dest) and os.path.getsize(dest) > 3000:
        return "poster/" + film["video_id"] + ".jpg"
    if os.path.exists(dest):
        os.remove(dest)
    return None


def one(film, xite):
    ext = os.path.splitext(film["file"])[1].lower() or ".mp4"
    if ext not in (".mp4", ".webm", ".ogv", ".m4v"):
        ext = ".mp4"
    rel = "video/" + film["video_id"] + ext
    dest = os.path.join(xite, rel)
    manifest = os.path.join(xite, "meta", film["video_id"] + ".json")
    if os.path.exists(manifest):
        return "skip", film["video_id"], 0

    expect = film.get("size") or head_size(film["url"])
    if not download(film["url"], dest, expect):
        return "fail", film["video_id"], 0
    size = os.path.getsize(dest)
    dur, height = probe(dest)
    if dur < 20:                                       # not a real film
        os.remove(dest)
        return "fail", film["video_id"], 0

    entry = {
        "video_id": film["video_id"],
        "title": film["title"],
        "year": film.get("year"),
        "category": film["category"],
        "description": film.get("description") or "",
        "studio": film.get("studio"),
        "license": film.get("license"),
        "source": film.get("source"),
        "poster": poster(film, xite, rel),
        "sources": [{"src": rel, "type": "video/webm" if ext == ".webm" else
                     ("video/ogg" if ext == ".ogv" else "video/mp4")}],
        "captions": [],
        "duration": dur,
        "height": height,
        "size": size,
        "date_added": int(time.time()),
    }
    with open(manifest, "w") as fh:
        json.dump(entry, fh)
    return "ok", film["video_id"], size


def main():
    cand, xite = sys.argv[1], sys.argv[2]
    limit = workers = None
    for i, a in enumerate(sys.argv):
        if a == "--limit":
            limit = int(sys.argv[i + 1])
        if a == "--workers":
            workers = int(sys.argv[i + 1])
    films = json.load(open(cand))
    if limit:
        films = films[:limit]
    for d in ("video", "poster", "meta"):
        os.makedirs(os.path.join(xite, d), exist_ok=True)

    done = ok = failed = skipped = 0
    bytes_got = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=workers or 4) as pool:
        futures = [pool.submit(one, f, xite) for f in films]
        for fut in as_completed(futures):
            status, vid, size = fut.result()
            done += 1
            if status == "ok":
                ok += 1
                bytes_got += size
            elif status == "skip":
                skipped += 1
            else:
                failed += 1
                print(f"  FAIL {vid}", flush=True)
            if done % 10 == 0 or done == len(films):
                mins = (time.time() - started) / 60
                print(f"[{done}/{len(films)}] ok={ok} skip={skipped} fail={failed} "
                      f"{bytes_got/1e9:.1f} GB in {mins:.0f}m", flush=True)
    print(f"DONE ok={ok} skipped={skipped} failed={failed} {bytes_got/1e9:.1f} GB")


if __name__ == "__main__":
    main()
