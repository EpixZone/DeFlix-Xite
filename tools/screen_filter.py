#!/usr/bin/env python3
"""Keep the library general-audience.

Public domain collections carry a lot that is legal to share but not wanted
here: propaganda, films built on racial caricature, exploitation and adult
material. This drops them by explicit title and by keyword. It errs toward
dropping - a false drop costs one film out of thousands, a false keep is
published under the owner's name.
"""
import re

# Titles that go regardless of how they are worded.
BLOCK_TITLES = {
    "the birth of a nation",
    "triumph of the will",
    "der ewige jude",
    "the eternal jew",
    "sex madness",
    "reefer madness",
    "diary of a nudist",
    "marihuana",
    "mom and dad",
    "child bride",
    "the road to ruin",
    "sex hygiene",
    "birth of a baby",
    "coonskin",
    "song of the south",
    "indian love burlesque",
    # Holocaust denial, antisemitic conspiracy, and far-right propaganda. Named
    # explicitly rather than by keyword: "holocaust" alone would also drop
    # genuine survivor documentaries and archival footage.
    "one third of the holocaust",
    "hidden history - actual footage from nazi",
    "zionists sign a deal with hitler",
    "mike cernovich",
    "hoaxed",
    "the ww1 conspiracy",
    "auslandstonwoche",
    "the greatest story never told",
}

# Any of these in a title or description drops the film.
BLOCK_PATTERNS = [
    # adult / exploitation
    r"\bnudist\b", r"\bnudie\b", r"\bstriptease\b", r"\bstripper\b", r"\bstrip tease\b", r"\bburlesque (show|queen|dancer)\b", r"\bporn",
    r"\bsexploitation\b", r"\bsex hygiene\b", r"\bvd\b", r"\bvenereal\b",
    r"\bprostitut", r"\bwhite slavery\b", r"\bvice squad\b",
    # racial caricature and slurs
    r"\bcoon\b", r"\bdarkie\b", r"\bpickaninny\b", r"\bmammy\b", r"\bsambo\b",
    r"\bnigger", r"\bjungle jinks\b", r"\bblackface\b", r"\bminstrel\b",
    r"\bchink\b", r"\bjap\b(?!an)", r"\byellow peril\b",
    # nazi / fascist propaganda
    r"\bnazi propaganda\b", r"\bhitler youth\b", r"\bdas dritte reich\b",
    r"\bpropagandafilm\b",
    # graphic / shock
    r"\bmondo\b", r"\b(public|filmed|mass) execution", r"\batrocit", r"\bautopsy\b", r"\bgore\b",
    # anti-semitic / hate
    r"\bjewish question\b", r"\bracial hygiene\b", r"\beugenic",
]

# Wartime propaganda is kept when it is documentary in character (Why We Fight,
# Memphis Belle) but not when it is a hate piece; the patterns above draw that
# line, and these are explicitly allowed back in.
ALLOW_TITLES = {
    "why we fight: prelude to war",
    "the memphis belle: a story of a flying fortress",
    "the last bomb",
}

# Hate propaganda that hides behind neutral-sounding titles.
# Films whose uploader tagged a licence they have no standing to grant. The
# giveaway is a bare description with no studio and no year: a real CC release
# says who made it. The Sweatbox is Trudie Styler's documentary about Disney's
# production of The Emperor's New Groove, which Disney blocked and which has
# only ever circulated unofficially.
BLOCK_TITLES.update({
    "the sweatbox documentary",
    "the sweatbox",
})

# Network and studio content with fabricated licences, caught by hand in the
# published library (the giveaway is always the same: no studio, no year,
# uploader-supplied licence). Plus a URAA trap: a pre-1946 FOREIGN film can be
# US-copyrighted even when its age suggests otherwise - restoration in 1996
# re-covered anything still protected at home (The Lady Vanishes, 1938, is
# Criterion's to sell, not ours to seed).
BLOCK_TITLES.update({
    "dateline to catch a predator",
    "to catch a predator",
    "welcome to north korea",
    "clutch city",
    "monty python",
    "pocket monsters",
    "pokemon",
    "jbvo",
    "the lady vanishes",
    "march of time",
    "hawaii's spectacular volcano eruptions",
    "space thunder kids",
    "die greul von nemmersdorf",
    "evidence of revision",
    "two girl hitchhikers",
})

BLOCK_TITLES.update({
    "europa: the last battle",
    "the greatest story never told",
    "hellstorm",
})

# Signs a "licence" is an uploader's assertion about someone else's film.
COMMERCIAL_HINTS = re.compile(
    r"\b(broadcast by|television (drama|series|network)|mbc\d?|bbc|hbo|netflix|"
    r"paramount|universal pictures|warner bros|columbia pictures|walt disney|"
    r"miramax|lionsgate|weinstein|radius-twc|oscar[- ]winning|academy award)\b", re.I)

_block_re = re.compile("|".join(BLOCK_PATTERNS), re.I)


def gov_work(text):
    """US government output is public domain by statute, whatever its date."""
    return bool(re.search(
        r"\b(nasa|jpl|noaa|usgs|national archives|library of congress|"
        r"u\.?s\.? (government|army|navy|air force|marine)|department of (defense|energy|"
        r"agriculture|state)|public\.resource)\b", text or "", re.I))


# Modern works whose authors put them in the public domain deliberately. The
# date rule below cannot tell a creator's dedication from an uploader's guess,
# so these are recorded by hand after checking the creator's own statement.
AUTHOR_FREED = {
    "sita sings the blues",        # Nina Paley dedicated it to the public domain, 2013
    "steal this film",             # released free by its makers
    "steal this film ii",
    "sintel", "big buck bunny", "elephants dream", "tears of steel",
    "cosmos laundromat", "sprite fright", "coffee run", "spring", "hero",
    "glass half", "wing it", "charge", "singularity", "caminandes",
    "the daily dweebs", "agent 327",
}


def licence_doubtful(title, year, licence, description="", source="", gov_hint=False):
    """Return a reason when a licence claim should not be trusted.

    Archive.org licence tags are supplied by whoever uploaded the file, not by
    the rightsholder, and they are demonstrably wrong on modern commercial work
    (a 2012 television drama tagged CC, an Oscar-winning documentary tagged
    public domain). Anything published from 1978 on is copyrighted the moment
    it is made, so a bare public-domain claim on a modern film needs a reason,
    and government authorship is the usual honest one.
    """
    text = f"{title} {description} {source}"
    try:
        year = int(year or 0)
    except (TypeError, ValueError):
        year = 0
    if gov_work(text) or gov_hint:
        return None
    t = norm(title)
    if any(a in t for a in AUTHOR_FREED):
        return None
    # Published before 1931: public domain in the US by age, whoever made it.
    if 0 < year <= 1930:
        return None
    if COMMERCIAL_HINTS.search(text):
        return "looks like a commercial release"
    if year >= 1978 and licence == "Public domain" and not gov_work(text):
        return f"modern film ({year}) claiming public domain"
    return None


def norm(s):
    return re.sub(r"[^a-z0-9 :]", "", (s or "").lower()).strip()


def rejected(title, description="", subject=""):
    """Return a reason string when this film should be left out, else None."""
    t = norm(title)
    if t in ALLOW_TITLES:
        return None
    for blocked in BLOCK_TITLES:
        if blocked in t:
            return f"blocked title ({blocked})"
    hay = f"{title} {description} {subject}"
    m = _block_re.search(hay)
    if m:
        return f"blocked term ({m.group(0).strip()})"
    return None


def filter_films(films, key_title="title", key_desc="description", key_subj="subject"):
    kept, dropped = [], []
    for f in films:
        why = rejected(f.get(key_title, ""), str(f.get(key_desc, "")), str(f.get(key_subj, "")))
        (dropped if why else kept).append((f, why) if why else f)
    return kept, dropped
