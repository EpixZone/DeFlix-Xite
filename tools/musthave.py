#!/usr/bin/env python3
"""Check a hand-built list of notable free films against the Internet Archive.

The bulk curation sorts by download count, which finds what is popular rather
than what is good. This checks the canon explicitly so the library cannot be
missing the obvious titles, and reports anything it could not find.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = "EpixScreen-curator/1.0 (library ingest; contact via epixnet)"

# (title to search, year or None, category, note)
WANT = [
    # --- Creative Commons features and shorts of note ---
    ("Sita Sings the Blues", 2008, "Animation", "Nina Paley, CC BY-SA"),
    ("Star Wreck In the Pirkinning", 2005, "Classics", "CC fan feature"),
    ("Valkaama", 2010, "Classics", "CC BY-SA feature"),
    ("The Cosmonaut", 2013, "Classics", "CC crowdfunded feature"),
    ("Boy Who Never Slept", 2005, "Classics", "CC BY feature"),
    ("Steal This Film", 2006, "Documentary", "CC documentary"),
    ("RiP A Remix Manifesto", 2008, "Documentary", "CC BY-NC"),
    ("The Internet's Own Boy", 2014, "Documentary", "CC BY-NC-SA"),
    ("Pioneer One", 2010, "Documentary", "CC BY-NC-SA drama series"),
    ("Zeitgeist Addendum", 2008, "Documentary", "CC"),
    # --- Blender open movies we do not yet hold ---
    ("Charge Blender Open Movie", 2022, "Animation", "CC BY"),
    ("WING IT Blender Open Movie", 2023, "Animation", "CC BY"),
    ("Singularity Blender Open Movie", 2019, "Animation", "CC BY"),
    ("Caminandes Llama Drama", 2013, "Animation", "CC BY, episode 1"),
    # --- public domain canon: silent ---
    ("Metropolis", 1927, "Silent Era", "Lang"),
    ("Nosferatu", 1922, "Silent Era", "Murnau"),
    ("The General", 1926, "Silent Era", "Keaton"),
    ("Sherlock Jr", 1924, "Silent Era", "Keaton"),
    ("Steamboat Bill Jr", 1928, "Silent Era", "Keaton"),
    ("Battleship Potemkin", 1925, "Silent Era", "Eisenstein"),
    ("The Kid", 1921, "Silent Era", "Chaplin"),
    ("Safety Last", 1923, "Silent Era", "Lloyd"),
    ("Un Chien Andalou", 1929, "Silent Era", "Bunuel/Dali"),
    ("A Trip to the Moon", 1902, "Silent Era", "Melies"),
    ("The Birth of a Nation", 1915, "Silent Era", "historically significant, racist content"),
    ("Nanook of the North", 1922, "Documentary", "early documentary"),
    # --- public domain canon: sound ---
    ("Night of the Living Dead", 1968, "Classics", "Romero"),
    ("Carnival of Souls", 1962, "Classics", "Harvey"),
    ("Detour", 1945, "Classics", "film noir"),
    ("D.O.A.", 1949, "Classics", "film noir"),
    ("The Stranger Orson Welles", 1946, "Classics", "Welles"),
    ("Charade", 1963, "Classics", "Donen"),
    ("Plan 9 from Outer Space", 1959, "Classics", "Wood"),
    ("Little Shop of Horrors", 1960, "Classics", "Corman"),
    ("The Last Man on Earth", 1964, "Classics", "Price"),
    ("Beat the Devil", 1953, "Classics", "Huston"),
    ("Meet John Doe", 1941, "Classics", "Capra"),
    ("The 39 Steps", 1935, "Classics", "Hitchcock"),
    ("The Lady Vanishes", 1938, "Classics", "Hitchcock"),
    ("Scarlet Street", 1945, "Classics", "Lang"),
    ("The Hitch-Hiker", 1953, "Classics", "Lupino"),
    ("Dementia 13", 1963, "Classics", "Coppola"),
    ("Teenagers from Outer Space", 1959, "Classics", "b-movie"),
    ("Gulliver's Travels", 1939, "Animation", "Fleischer feature"),
    ("Popeye the Sailor Meets Sindbad", 1936, "Animation", "Fleischer"),
    ("Superman Fleischer", 1941, "Animation", "Fleischer serial"),
    ("Man with a Movie Camera", 1929, "Documentary", "Vertov"),
    ("Triumph of the Will", 1935, "Documentary", "propaganda, historically studied"),
]


def get(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.load(r)
    except Exception:                                   # noqa: BLE001
        return None


def find(entry):
    title, year, category, note = entry
    # Title match, licensed, and actually a film.
    q = f'title:("{title}") AND mediatype:movies AND licenseurl:[* TO *]'
    url = ("https://archive.org/advancedsearch.php?" + urllib.parse.urlencode({
        "q": q,
        "fl[]": ["identifier", "title", "year", "licenseurl", "downloads"],
        "rows": "6", "sort[]": "downloads desc", "output": "json"}, doseq=True))
    data = get(url)
    docs = (data or {}).get("response", {}).get("docs", [])
    if not docs:
        return {"want": title, "year": year, "category": category, "note": note, "found": None}
    # Prefer a result whose year is close, else the most downloaded.
    best = docs[0]
    if year:
        for d in docs:
            try:
                if abs(int(str(d.get("year"))[:4]) - year) <= 1:
                    best = d
                    break
            except (TypeError, ValueError):
                continue
    return {"want": title, "year": year, "category": category, "note": note,
            "found": {"identifier": best.get("identifier"),
                      "title": str(best.get("title"))[:70],
                      "year": best.get("year"),
                      "licenseurl": best.get("licenseurl", ""),
                      "downloads": best.get("downloads", 0)}}


def main(out):
    print(f"checking {len(WANT)} notable titles…\n")
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(find, WANT))
    hit = [r for r in results if r["found"]]
    miss = [r for r in results if not r["found"]]
    for r in hit:
        f = r["found"]
        lic = "PD" if "publicdomain" in (f["licenseurl"] or "").lower() else (
            "CC" if "creativecommons" in (f["licenseurl"] or "").lower() else "?")
        print(f"  OK   {r['want'][:38]:<38} -> {f['title'][:40]:<40} {str(f['year'] or '----')} [{lic}]")
    if miss:
        print("\n  not found with a declared licence:")
        for r in miss:
            print(f"  MISS {r['want'][:38]:<38} ({r['note']})")
    json.dump(results, open(out, "w"), indent=1)
    print(f"\n{len(hit)}/{len(WANT)} available -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "musthave.json")
