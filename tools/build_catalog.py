#!/usr/bin/env python3
"""Assemble the EpixScreen catalogue from the per-film manifests.

Split by category on purpose: at ~1,150 films a single catalogue is over a
megabyte, and the browser only ever needs the sources and captions for the one
film it is playing. So:

  data/videos.json           small index: categories, series, counts
  data/catalog/<slug>.json   the films of one category, with sources/captions

The database still sees every film (the dbschema maps catalog/*.json into the
video table), so sorting and search stay one SQL pass over the whole library.
"""
import glob
import json
import os
import re
import sys
from collections import defaultdict

ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8,
         "ix": 9, "x": 10, "xi": 11, "xii": 12, "xiii": 13, "xiv": 14, "xv": 15}
NUMBERED = re.compile(
    r"^(?P<series>.{4,60}?)\s*[-–—:,(]*\s*"
    r"(?:chapter|chap\.?|part|pt\.?|episode|ep\.?|no\.?|volume|vol\.?)\s*"
    r"(?P<num>[0-9]{1,3}|[ivxIVX]{1,5})\b", re.I)
PREFIXED = re.compile(r"^(?P<a>.{6,60}?)\s*[:–—]\s*|^(?P<b>.{6,60}?)\s+-\s+")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:48] or "other"


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip(" -–—:,("))


def skey(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def detect_series(films):
    """Group films whose titles announce a series. Two or more, never one."""
    strong, weak = defaultdict(list), defaultdict(list)
    for f in films:
        t = f["title"]
        m = NUMBERED.match(t)
        if m:
            raw = m.group("num").lower()
            n = int(raw) if raw.isdigit() else ROMAN.get(raw)
            name = norm(m.group("series"))
            if n and len(name) >= 4:
                strong[skey(name)].append((name, n, f))
                continue
        p = PREFIXED.match(t)
        if p:
            name = norm(p.group("a") or p.group("b") or "")
            if len(name) >= 6:
                weak[skey(name)].append((name, None, f))

    series, taken = {}, set()
    for bucket, kind, floor in ((strong, "numbered", 2), (weak, "prefix", 3)):
        for k, members in bucket.items():
            if len(members) < floor:
                continue
            eps = [(n, f) for (_, n, f) in members if f["video_id"] not in taken]
            if len(eps) < 2:
                continue
            name = sorted((m[0] for m in members), key=len)[0]
            sid = slug(name)
            for n, f in eps:
                taken.add(f["video_id"])
                f["series"] = name
                f["series_id"] = sid
                if n:
                    f["episode"] = n
            eps.sort(key=lambda e: (e[0] is None, e[0] or 0, e[1]["title"]))
            series[sid] = {
                "series_id": sid, "name": name,
                "category": eps[0][1]["category"],
                "count": len(eps),
                "poster": next((e[1].get("poster") for e in eps if e[1].get("poster")), None),
                "episodes": [e[1]["video_id"] for e in eps],
            }
    return series


def main(xite):
    meta_dir = os.path.join(xite, "meta")
    films = []
    for name in sorted(os.listdir(meta_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(meta_dir, name)
        try:
            film = json.load(open(path))
        except (ValueError, OSError):
            print(f"  ! unreadable manifest: {name}", file=sys.stderr)
            continue
        # fetch.py does not record when it downloaded a film, and without a
        # date every film claims the epoch, "Newest" sorts at random and the
        # ranking tiebreak does nothing. The manifest is written the moment the
        # download finishes, so its mtime is that timestamp.
        #
        # Derive it ONCE and write it back. Reading mtime on every build made
        # the date a property of the file rather than of the film: editing a
        # manifest for any reason (adding captions, fixing a label) reset the
        # film to "added just now". Persisting it makes later edits harmless.
        if not film.get("date_added"):
            film["date_added"] = int(os.path.getmtime(path))
            try:
                json.dump(film, open(path, "w"))
            except OSError:
                pass  # read-only tree: the date still holds for this build
        films.append(film)

    # Films added by hand rather than by the pipeline (the Blender open movies
    # come from Wikimedia Commons, not archive.org) have no manifest. Carry
    # them over from the catalogue this run is about to replace, so a rebuild
    # never drops a film just because nothing downloaded it.
    known = {f["video_id"] for f in films}
    for old in sorted(glob.glob(os.path.join(xite, "data", "catalog", "*.json"))):
        try:
            rows = json.load(open(old)).get("video", [])
        except (ValueError, OSError):
            continue
        for v in rows:
            if v.get("video_id") in known:
                continue
            src = (v.get("sources") or [{}])[0].get("src", "")
            if src and os.path.exists(os.path.join(xite, src)):
                v.setdefault("category", "Animation")
                v.setdefault("date_added", int(os.path.getmtime(os.path.join(xite, src))))
                known.add(v["video_id"])
                films.append(v)

    # Drop anything whose media went missing (a purge, a failed fetch).
    live = []
    for f in films:
        src = (f.get("sources") or [{}])[0].get("src")
        if src and os.path.exists(os.path.join(xite, src)):
            live.append(f)
    films = live

    series = detect_series(films)

    by_cat = defaultdict(list)
    for f in films:
        by_cat[f.get("category") or "Other"].append(f)

    cat_dir = os.path.join(xite, "data", "catalog")
    os.makedirs(cat_dir, exist_ok=True)
    for stale in os.listdir(cat_dir):
        os.remove(os.path.join(cat_dir, stale))

    categories = []
    for cat, rows in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
        rows.sort(key=lambda f: (f.get("series_id") or "", f.get("episode") or 0, f["title"]))
        s = slug(cat)
        with open(os.path.join(cat_dir, s + ".json"), "w") as fh:
            json.dump({"category": cat, "video": rows}, fh, separators=(",", ":"))
        categories.append({
            "name": cat, "slug": s, "count": len(rows),
            "series": sorted({f["series_id"] for f in rows if f.get("series_id")}),
        })

    index = {
        "categories": categories,
        "series": sorted(series.values(), key=lambda s: (-s["count"], s["name"])),
        "total": len(films),
        "generated": int(os.path.getmtime(meta_dir)),
    }
    with open(os.path.join(xite, "data", "videos.json"), "w") as fh:
        json.dump(index, fh, separators=(",", ":"))

    idx_kb = os.path.getsize(os.path.join(xite, "data", "videos.json")) / 1024
    print(f"{len(films)} films, {len(categories)} categories, {len(series)} series")
    print(f"index: {idx_kb:.0f} KB")
    for c in categories:
        kb = os.path.getsize(os.path.join(cat_dir, c["slug"] + ".json")) / 1024
        print(f"  {c['name']:<18} {c['count']:>5} films  {kb:>6.0f} KB  "
              f"{len(c['series'])} series")


if __name__ == "__main__":
    main(sys.argv[1])
