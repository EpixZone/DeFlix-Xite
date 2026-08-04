# Catalogue pipeline

The films in DeFlix are not hand-picked one at a time. These scripts find
them, check they are ours to share, download them, and build the catalogue the
xite reads. They run on whichever machine holds the media, not on a laptop:
1,156 films is about 235 GB.

Run them in this order.

## 1. curate.py

Searches archive.org for candidates in six categories (Documentary, Classics,
Archival, Animation, Silent Era, Space & Science), pages through the results and
fetches each item's metadata in parallel.

    python3 curate.py candidates.json

## 2. screen_filter.py

The gate, imported by the other scripts rather than run on its own. Two jobs:

**Licence.** archive.org's licence field is uploader-supplied and often wrong,
so a claimed CC licence is not enough. `licence_doubtful()` rejects anything
that looks like a commercial release with a licence bolted on: a studio name in
the credits, a copyright year inside the term, a title known to be under
copyright. Films are kept when they are US public domain by date, a US
government work, or carry a licence the uploader is plausibly able to grant.

**Content.** `BLOCK_TITLES` and `BLOCK_PATTERNS` drop propaganda, hate material
and conspiracy films. This is deliberately a blocklist of named titles rather
than keywords: a keyword like "holocaust" would also throw out a survivor's
testimony, which is exactly the sort of film that belongs here.

Both are pattern matching over metadata for films nobody has watched. Treat the
first published batch as reviewable, not as verified.

## 3. musthave.py and expand.py

`musthave.py` checks a list of canonical titles that the library should not be
without, and reports which are missing. `expand.py` merges those into the
candidate list and tops it up to a target size.

Some films that belong in the library are not on archive.org at all. The Blender
open movies (Big Buck Bunny, Sintel, Tears of Steel, Cosmos Laundromat, and the
Caminandes shorts) come from Wikimedia Commons instead.

## 4. fetch.py

Downloads in parallel, resumable, and writes one manifest per film to
`<xite>/meta/`. Reads duration with ffprobe, takes a poster frame, and discards
anything shorter than 20 seconds (archive.org items are often a trailer or a
scan of the reel label).

    python3 fetch.py candidates.json <xite-dir> --workers 10

The manifests are the pipeline's record, not the xite's: `meta/` is in
content.json's `ignore`, so it never ships to peers.

## 5. build_catalog.py

Turns the manifests into what the browser loads:

    data/videos.json          index: categories, series, counts (about 10 KB)
    data/catalog/<slug>.json  the films of one category, with sources/captions

Split by category on purpose. At this size a single catalogue is over a
megabyte, and the page only needs sources for the one film being played. The
database still sees every film, so search and sorting stay one SQL pass.

This step also detects series from the titles: a numbered run needs two
episodes to count, a shared prefix needs three.

    python3 build_catalog.py <xite-dir>

## 6. stale.py

Lists files in the xite directory that nothing declares, so a purged film does
not leave 2 GB behind. It refuses to touch `data/users/` and anything named in
`includes`, which is where other people's comments and ratings live.

## Then sign

Signing hashes every film, so it takes a while at this size. Sign the include
first, then the root:

    epix-server siteSign <address> <privatekey> data/users/content.json
    epix-server siteSign <address> <privatekey>
    epix-server sitePublish <address>

Read the key from a file into a variable. Anything on a command line is visible
to every user on the box through the process list.
