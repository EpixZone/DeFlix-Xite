#!/usr/bin/env python3
"""Pick films for EpixScreen from the Internet Archive.

Only items that declare a licence (Creative Commons or a public-domain mark)
are considered, and every candidate must expose a directly playable derivative.
Writes a candidate list; downloads nothing.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from screen_filter import rejected

UA = "EpixScreen-curator/1.0 (library ingest; contact via epixnet)"
SEARCH = "https://archive.org/advancedsearch.php"
META = "https://archive.org/metadata/"

# Per category: a query, how many to keep, and how the row is labelled.
CATEGORIES = [
    ("Animation", 150,
     'collection:animationandcartoons AND mediatype:movies AND licenseurl:[* TO *]'),
    ("Classics", 200,
     'collection:feature_films AND mediatype:movies AND licenseurl:[* TO *] AND year:[1930 TO 1979]'),
    ("Silent Era", 150,
     'mediatype:movies AND licenseurl:[* TO *] AND year:[1900 TO 1930]'),
    ("Space & Science", 150,
     'collection:nasa AND mediatype:movies'),
    ("Archival", 200,
     'collection:prelinger AND mediatype:movies AND licenseurl:*creativecommons*'),
    ("Documentary", 150,
     'mediatype:movies AND licenseurl:[* TO *] AND subject:documentary'),
]

# Playable in a browser without transcoding, best first.
GOOD_FORMATS = ["h.264", "h.264 ia", "mpeg4", "512kb mpeg4", "webm", "ogg video"]
MIN_BYTES = 8 * 1024 * 1024
MAX_BYTES = 3 * 1024 * 1024 * 1024


def get(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as exc:                      # noqa: BLE001 - report and retry
            if attempt == tries - 1:
                print(f"  ! {exc} :: {url[:90]}", file=sys.stderr)
                return None
            time.sleep(2 * (attempt + 1))
    return None


def search(query, rows):
    """Page through the search API until `rows` docs are gathered."""
    out, page, per = [], 1, 200
    while len(out) < rows and page <= 40:
        params = {
            "q": query,
            "fl[]": ["identifier", "title", "year", "description", "licenseurl",
                     "creator", "downloads", "subject"],
            "rows": str(per),
            "page": str(page),
            "sort[]": "downloads desc",
            "output": "json",
        }
        url = SEARCH + "?" + urllib.parse.urlencode(params, doseq=True)
        data = get(url)
        docs = (data or {}).get("response", {}).get("docs", [])
        if not docs:
            break
        out.extend(docs)
        page += 1
        time.sleep(0.4)
    return out[:rows]


def pick_file(files):
    """Best playable derivative: prefer mp4, then a sane size, then quality."""
    best = None
    for f in files:
        name = f.get("name", "")
        fmt = (f.get("format") or "").lower()
        if not re.search(r"\.(mp4|webm|ogv|m4v)$", name, re.I):
            continue
        try:
            size = int(f.get("size", 0))
        except (TypeError, ValueError):
            continue
        if size < MIN_BYTES or size > MAX_BYTES:
            continue
        try:
            height = int(f.get("height", 0) or 0)
        except (TypeError, ValueError):
            height = 0
        rank = GOOD_FORMATS.index(fmt) if fmt in GOOD_FORMATS else len(GOOD_FORMATS)
        is_mp4 = 0 if name.lower().endswith((".mp4", ".m4v")) else 1
        # Prefer mp4, then a known-good format, then the taller of the two.
        score = (is_mp4, rank, -height)
        if best is None or score < best[0]:
            best = (score, {"name": name, "size": size, "format": f.get("format"),
                            "height": height,
                            "length": f.get("length")})
    return best[1] if best else None


def clean(text, limit=420):
    if not text:
        return ""
    if isinstance(text, list):
        text = " ".join(str(t) for t in text)
    text = re.sub(r"<[^>]+>", " ", str(text))
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        cut = text[:limit].rsplit(". ", 1)
        text = (cut[0] + ".") if len(cut) > 1 and len(cut[0]) > 120 else text[:limit].rstrip() + "…"
    return text


def licence_of(url):
    if not url:
        return "Public domain"
    u = url.lower()
    if "publicdomain" in u or "/mark/" in u:
        return "Public domain"
    m = re.search(r"licenses/([a-z-]+)/([0-9.]+)", u)
    if m:
        return "CC " + m.group(1).upper().replace("-", "-") + " " + m.group(2)
    return "Creative Commons"


def slugify(title, taken):
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-")[:48].strip("-")
    if not s:
        s = "film"
    base, n = s, 2
    while s in taken:
        s = f"{base}-{n}"
        n += 1
    taken.add(s)
    return s


def main(out_path):
    picked, slugs, seen_titles = [], set(), set()
    skipped_content = []
    for category, want, query in CATEGORIES:
        print(f"\n== {category}: {query[:70]}")
        docs = search(query, want * 3)
        print(f"   {len(docs)} results, inspecting…")
        # Pre-filter, then look up metadata a few at a time.
        todo = []
        for doc in docs:
            ident = doc.get("identifier")
            title = clean(doc.get("title"), 90)
            if not ident or not title:
                continue
            key = re.sub(r"[^a-z0-9]", "", title.lower())[:40]
            if key in seen_titles or any(t[2] == key for t in todo):
                continue
            todo.append((doc, ident, key))
        metas = {}
        with ThreadPoolExecutor(max_workers=6) as pool:
            for ident, meta in zip([t[1] for t in todo],
                                   pool.map(lambda i: get(META + i), [t[1] for t in todo])):
                metas[ident] = meta
        kept = 0
        for doc, ident, key in todo:
            if kept >= want:
                break
            title = clean(doc.get("title"), 90)
            meta = metas.get(ident)
            if not meta or "files" not in meta:
                continue
            md = meta.get("metadata", {})
            why = rejected(title, clean(doc.get("description") or md.get("description")),
                           str(doc.get("subject", "")))
            if why:
                skipped_content.append((title, why))
                continue
            f = pick_file(meta["files"])
            if not f:
                continue
            year = doc.get("year") or md.get("year") or md.get("date", "")[:4]
            try:
                year = int(str(year)[:4])
            except (TypeError, ValueError):
                year = None
            seen_titles.add(key)
            kept += 1
            picked.append({
                "video_id": slugify(title, slugs),
                "title": title,
                "year": year,
                "category": category,
                "description": clean(doc.get("description") or md.get("description")),
                "studio": clean(doc.get("creator") or md.get("creator"), 60) or None,
                "license": licence_of(doc.get("licenseurl") or md.get("licenseurl")),
                "source": f"https://archive.org/details/{ident}",
                "identifier": ident,
                "file": f["name"],
                "size": f["size"],
                "height": f["height"],
                "url": f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}",
                "thumb": f"https://archive.org/services/img/{ident}",
            })
        print(f"   kept {kept}")

    if skipped_content:
        print(f"\nleft out for content ({len(skipped_content)}):")
        for t, why in skipped_content[:15]:
            print(f"  - {t[:52]:<52} {why}")
    total = sum(p["size"] for p in picked)
    with open(out_path, "w") as fh:
        json.dump(picked, fh, indent=1)
    print(f"\n{len(picked)} films, {total / 1e9:.1f} GB -> {out_path}")
    for cat, _, _ in CATEGORIES:
        rows = [p for p in picked if p["category"] == cat]
        gb = sum(r["size"] for r in rows) / 1e9
        print(f"  {cat:<16} {len(rows):>3} films  {gb:>6.1f} GB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "candidates.json")
