# DeFlix

Decentralized Flix: open cinema on EpixNet. A library of films that stream peer to peer, with likes
and threaded comments from anyone holding a xID.

This is the source for the xite at
`epix1jaahfehr280m9uqlf44vtkrz9hjkvq8fewz68v` (formerly EpixScreen, before that the Epix Media Library).

## What it does

- **Library page** listing every film, most liked first, with search and other
  sort orders. Adding a film means adding an entry to `data/videos.json`; there
  is no per-film page to write.
- **Watch page** at `?Watch/<video_id>`, rendered from the database. Permalinks
  open straight onto a film and Back returns to the library.
- **Likes and comments** for anyone with a xID. Comments nest, replies can be
  replied to, and any comment can be liked.
- **A reusable player** in `js/lib/EpixPlayer.js`.

## Adding a film

1. Put the media in `video/`, a poster in `poster/`, and any WebVTT subtitles in
   `captions/`.
2. Add an entry to `data/videos.json`:

```json
{
 "video_id": "my-film",
 "title": "My Film",
 "year": 2026,
 "description": "One or two sentences.",
 "studio": "Someone",
 "license": "CC BY 4.0",
 "poster": "poster/my-film.jpg",
 "sources": [{"src": "video/my-film.webm", "type": "video/webm"}],
 "captions": [{"src": "captions/my-film.en.vtt", "lang": "en", "label": "English"}],
 "duration": 630,
 "size": 159000000,
 "date_added": 1785500000
}
```

3. Sign and publish:

```sh
epix-server siteSign epix1jaahfehr280m9uqlf44vtkrz9hjkvq8fewz68v
epix-server sitePublish epix1jaahfehr280m9uqlf44vtkrz9hjkvq8fewz68v
```

`video_id` is the permalink, so keep it stable once a film is published.
Video files are declared optional (see the `optional` key in `content.json`), so
peers fetch them on demand; posters and captions are small and always served.

## Reusing the player

`js/lib/EpixPlayer.js` has no dependency on this app. Copy it plus the
`.epix-player` rules at the bottom of `css/all.css`, then:

```js
var player = new EpixPlayer(element, {
  sources:  [{src: "video/x.webm", type: "video/webm"}],
  captions: [{src: "captions/x.en.vtt", lang: "en", label: "English"}],
  poster:   "poster/x.jpg",
  onStats:  function (cb) { /* optional: feed the transfer panel */ }
});
player.destroy();
```

It handles play/pause, seeking, volume, subtitles, fullscreen, keyboard
shortcuts (space, arrows, `f`, `m`, `c`) and remembers playback position,
volume and subtitle choice per video in localStorage.

## Data model

| File | Written by | Feeds |
|---|---|---|
| `data/videos.json` | the xite owner | `video` table, plus the player's sources and captions |
| `data/users/<xid>/comments.json` | each viewer | `comment` table |
| `data/users/<xid>/video_likes.json` | each viewer | `video_like` table |
| `data/users/<xid>/comment_likes.json` | each viewer | `comment_like` table |

Everything a viewer writes is an individually signed CRDT record
(`epix-orset-1`), union merged by the node, so one person's write can never
overwrite another's and a stale publish merges to a no-op. Likes are key based
(one record per viewer per target, re-toggling supersedes), comments are nonce
based. Only `xid.epix` certificates may write, set by `cert_signers` in
`data/users/content.json`.
