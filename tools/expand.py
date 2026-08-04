#!/usr/bin/env python3
"""Top the library up past a target, and fold in the canonical must-haves.

Two jobs the bulk curation did not do:
  1. musthave.json holds identifiers found by title but never turned into
     downloadable entries, so the canon was researched and then dropped.
  2. The bulk targets leave us short once download attrition is counted.

Everything added goes through the same content and licence checks.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, ".")
from curate import (META, UA, clean, get, licence_of, pick_file, search, slugify)
from screen_filter import licence_doubtful, rejected

# Deeper documentary and feature seams, since that is what was asked for.
TOP_UP = [
    ("Documentary", 'collection:prelinger AND mediatype:movies AND licenseurl:[* TO *] AND subject:("documentary")'),
    ("Documentary", 'mediatype:movies AND licenseurl:*publicdomain* AND (subject:"newsreel" OR title:"march of time")'),
    ("Documentary", 'mediatype:movies AND licenseurl:[* TO *] AND (subject:"nature" OR subject:"wildlife" OR subject:"science")'),
    ("Classics", 'collection:feature_films AND mediatype:movies AND licenseurl:*publicdomain* AND year:[1930 TO 1969]'),
    ("Classics", 'mediatype:movies AND licenseurl:*publicdomain* AND (subject:"film noir" OR subject:"western" OR subject:"mystery")'),
    ("Silent Era", 'mediatype:movies AND licenseurl:[* TO *] AND year:[1895 TO 1929] AND -title:"home movie"'),
    ("Animation", 'collection:animationandcartoons AND mediatype:movies AND licenseurl:*publicdomain*'),
    ("Space & Science", 'collection:nasa AND mediatype:movies AND -title:"ISS Update"'),
]


def entry_from(ident, doc_meta, category, title=None):
    """Turn an archive.org identifier into a catalogue candidate, or None."""
    meta = get(META + ident)
    if not meta or "files" not in meta:
        return None
    md = meta.get("metadata", {})
    title = title or clean(md.get("title"), 90)
    if not title:
        return None
    desc = clean(md.get("description"))
    year = md.get("year") or str(md.get("date", ""))[:4]
    try:
        year = int(str(year)[:4])
    except (TypeError, ValueError):
        year = None
    licence = licence_of(md.get("licenseurl") or (doc_meta or {}).get("licenseurl"))
    src = f"https://archive.org/details/{ident}"
    gov = category == "Space & Science"
    if rejected(title, desc) or licence_doubtful(title, year, licence, desc, src, gov_hint=gov):
        return None
    f = pick_file(meta["files"])
    if not f:
        return None
    return {
        "title": title, "year": year, "category": category, "description": desc,
        "studio": clean(md.get("creator"), 60) or None, "license": licence,
        "source": src, "identifier": ident, "file": f["name"], "size": f["size"],
        "height": f["height"],
        "url": f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}",
        "thumb": f"https://archive.org/services/img/{ident}",
    }


def main(target):
    films = json.load(open("candidates.json"))
    slugs = {f["video_id"] for f in films}
    seen = {re.sub(r"[^a-z0-9]", "", f["title"].lower())[:40] for f in films}
    idents = {f.get("identifier") for f in films}
    added_must = added_bulk = 0

    # 1. the canon, by identifier
    must = json.load(open("musthave.json"))
    pending = [(m["found"]["identifier"], m["category"], m["want"])
               for m in must if m.get("found") and m["found"]["identifier"] not in idents]
    print(f"resolving {len(pending)} must-have titles…")
    with ThreadPoolExecutor(max_workers=5) as pool:
        for e, (ident, cat, want) in zip(
                pool.map(lambda p: entry_from(p[0], None, p[1]), pending), pending):
            if not e:
                print(f"   skip {want[:40]}")
                continue
            k = re.sub(r"[^a-z0-9]", "", e["title"].lower())[:40]
            if k in seen or e["identifier"] in idents:
                continue
            e["video_id"] = slugify(e["title"], slugs)
            seen.add(k); idents.add(e["identifier"]); films.append(e); added_must += 1
    print(f"   added {added_must}")

    # 2. top up until the target is comfortably clear of attrition
    for category, query in TOP_UP:
        if len(films) >= target:
            break
        print(f"\n== top-up {category}: {query[:64]}")
        docs = search(query, 400)
        todo = []
        for d in docs:
            ident = d.get("identifier")
            t = clean(d.get("title"), 90)
            if not ident or not t or ident in idents:
                continue
            k = re.sub(r"[^a-z0-9]", "", t.lower())[:40]
            if k in seen:
                continue
            todo.append((ident, d, t, k))
        got = 0
        with ThreadPoolExecutor(max_workers=6) as pool:
            for e, (ident, d, t, k) in zip(
                    pool.map(lambda p: entry_from(p[0], p[1], category, p[2]), todo), todo):
                if len(films) >= target:
                    break
                if not e or k in seen or ident in idents:
                    continue
                e["video_id"] = slugify(e["title"], slugs)
                seen.add(k); idents.add(ident); films.append(e); got += 1; added_bulk += 1
        print(f"   +{got} (total {len(films)})")
        time.sleep(0.5)

    json.dump(films, open("candidates.json", "w"), indent=1)
    gb = sum(f["size"] for f in films) / 1e9
    print(f"\n{len(films)} candidates ({added_must} canon + {added_bulk} top-up), {gb:.1f} GB")
    print(f"after ~9% attrition, plus 14 originals: ~{int(len(films) * 0.91) + 14} films")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 1150)
