// EpixPlayer - a self-contained HTML5 video player for EpixNet xites.
//
// Standalone on purpose: it takes a plain options object, builds its own DOM
// inside a host element, and talks to the page only through the callbacks in
// `opts`. Nothing here imports the app, so any xite can drop in this file plus
// the .epix-player rules from css/all.css and get the same player.
//
//   var player = new EpixPlayer(el, {
//     sources:  [{src: "video/x.webm", type: "video/webm"}],
//     captions: [{src: "captions/x.en.vtt", lang: "en", label: "English"}],
//     poster:   "poster/x.jpg",
//     autoplay: false,
//     start:    0,                       // resume position in seconds
//     onTime:   function(t, dur) {},     // playback progress
//     onEnded:  function() {},
//     onStats:  function(cb) {}          // optional: transfer stats provider
//   });
//   player.destroy();
//
// Playback position, volume and the caption choice persist per video in
// localStorage, so a reload or a permalink revisit resumes where you left off.

(function (window) {
  "use strict";

  var STORE_KEY = "epix-player";

  function h(tag, attrs, children) {
    var parts = tag.split(".");
    var el = document.createElement(parts[0] || "div");
    if (parts.length > 1) el.className = parts.slice(1).join(" ");
    for (var k in attrs || {}) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      el.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function icon(path) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path);
    svg.appendChild(p);
    return svg;
  }

  var ICON = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    back: "M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
    fwd: "M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z",
    vol: "M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z",
    mute: "M3 9v6h4l5 5V4L7 9H3zm16.5 3l2.5 2.5-1.4 1.4L18 13.4l-2.6 2.5-1.4-1.4 2.5-2.5-2.5-2.6 1.4-1.4 2.6 2.5 2.6-2.5 1.4 1.4z",
    cc: "M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 12H4V7h16v10zM10.2 10.6a1.6 1.6 0 0 0-2.9.9v1a1.6 1.6 0 0 0 2.9.9l1.3.7a3.1 3.1 0 0 1-5.7-1.6v-1a3.1 3.1 0 0 1 5.7-1.6zM17.7 10.6a1.6 1.6 0 0 0-2.9.9v1a1.6 1.6 0 0 0 2.9.9l1.3.7a3.1 3.1 0 0 1-5.7-1.6v-1a3.1 3.1 0 0 1 5.7-1.6z",
    full: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
    exit: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
  };

  // Minimal WebVTT reader for [EpixPlayer.loadCaption]: blocks separated by
  // blank lines, one "start --> end" line per block, text underneath. Cue
  // settings after the end stamp and inline tags (<i>, voice spans) are
  // dropped; a leading BOM (some files carry one before the first cue id) is
  // ignored.
  function parseVtt(text) {
    var cues = [];
    var stamp = function (s) {
      var m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s);
      if (!m) return null;
      return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 +
        parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
    };
    String(text).replace(/^\uFEFF/, "").split(/\r?\n\r?\n+/).forEach(function (block) {
      var lines = block.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var at = lines[i].indexOf("-->");
        if (at === -1) continue;
        var start = stamp(lines[i].slice(0, at));
        var end = stamp(lines[i].slice(at + 3));
        if (start === null || end === null) break;
        var body = lines.slice(i + 1).join("\n").replace(/<[^>]*>/g, "").trim();
        if (body) cues.push({ start: start, end: end, text: body });
        break;
      }
    });
    return cues;
  }

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var s = Math.floor(t % 60);
    var m = Math.floor(t / 60) % 60;
    var hh = Math.floor(t / 3600);
    var mm = hh ? String(m).padStart(2, "0") : String(m);
    return (hh ? hh + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  }

  function loadStore() {
    try { return JSON.parse(window.localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveStore(store) {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode */ }
  }

  function EpixPlayer(host, opts) {
    this.host = host;
    this.opts = opts || {};
    this.key = this.opts.key || (this.opts.sources && this.opts.sources[0] && this.opts.sources[0].src) || "";
    this.store = loadStore();
    this.seeking = false;
    this.hide_timer = null;
    this.build();
    this.wire();
  }

  EpixPlayer.prototype.build = function () {
    var o = this.opts;

    this.video = h("video", {
      playsinline: "",
      preload: "metadata",
      poster: o.poster || null,
      crossorigin: "anonymous"
    });
    (o.sources || []).forEach(function (s) {
      this.video.appendChild(h("source", { src: s.src, type: s.type || null }));
    }, this);
    // Caption tracks are fetched and parsed by the player itself
    // (loadCaption): GeckoView never starts a <track> fetch for a
    // controls-less video (the element's readyState stays NONE forever), so
    // native TextTracks cannot be relied on. The CC menu turns one on.
    this.tracks = (o.captions || []).map(function (c, i) {
      return { meta: c, index: i };
    });
    this._cues = {}; // lang -> parsed cue list

    // The Epix mark IS the play button: it sits small inside the buffering
    // ring while the stream opens, then grows to fill the badge with a white
    // triangle over its hollow centre. `mark` points at the mark SVG (the
    // host xite ships its own copy).
    this.ring = h("span.epix-player-ring");
    this.mark = h("img.epix-player-mark", {
      src: o.mark || "img/epix-mark.svg", alt: "", draggable: "false"
    });
    this.hole = h("span.epix-player-hole");
    this.tri = icon(ICON.play);
    this.tri.setAttribute("class", "epix-player-tri");
    this.big = h("button.epix-player-badge", { type: "button", "aria-label": "Play" },
      [this.ring, this.mark, this.hole, this.tri]);
    this.msg = h("div.epix-player-msg", {}, ["Preparing to play…"]);
    this.veil = h("div.epix-player-veil", {}, [this.big, this.msg]);

    this.cur = h("div.epix-player-cur");
    this.buf = h("div.epix-player-buf");
    this.knob = h("div.epix-player-knob");
    this.bar = h("div.epix-player-bar", {}, [this.buf, this.cur, this.knob]);
    this.tip = h("div.epix-player-tip", {}, ["0:00"]);
    this.seek = h("div.epix-player-seek", { role: "slider", tabindex: "0", "aria-label": "Seek" }, [this.bar, this.tip]);

    this.btn_play = h("button.epix-player-btn", { type: "button", "aria-label": "Play" }, [icon(ICON.play)]);
    this.btn_back = h("button.epix-player-btn.epix-player-skip", { type: "button", "aria-label": "Back 10 seconds" }, [icon(ICON.back)]);
    this.btn_fwd = h("button.epix-player-btn.epix-player-skip", { type: "button", "aria-label": "Forward 10 seconds" }, [icon(ICON.fwd)]);
    this.btn_vol = h("button.epix-player-btn", { type: "button", "aria-label": "Mute" }, [icon(ICON.vol)]);
    this.vol = h("input.epix-player-vol", { type: "range", min: "0", max: "1", step: "0.05", "aria-label": "Volume" });
    this.time = h("div.epix-player-time", {}, ["0:00 / 0:00"]);
    this.btn_cc = this.tracks.length
      ? h("button.epix-player-btn", { type: "button", "aria-label": "Subtitles", title: "Subtitles (" + this.tracks.length + " languages)" }, [icon(ICON.cc)])
      : null;
    this.cc_menu = this.tracks.length ? h("div.epix-player-menu") : null;
    this.btn_full = h("button.epix-player-btn", { type: "button", "aria-label": "Full screen" }, [icon(ICON.full)]);

    // The state pill says in one word where playback is - and, clicked, opens
    // the transfer panel that explains why, per peer, the way a torrent client
    // does. "Buffering" on its own tells a viewer nothing about whether the
    // swarm is slow, absent, or simply outrun by the film's bitrate.
    // Four ascending bars, lit by how much film the node holds ahead of the
    // play head - the number that actually decides whether playback stalls.
    this.bars = h("span.epix-player-bars", {}, [h("i"), h("i"), h("i"), h("i")]);
    this.state_label = h("span.epix-player-statelbl", {}, ["connecting"]);
    this.pill = o.onStats
      ? h("button.epix-player-pill", { type: "button", title: "Transfer details" }, [this.bars, this.state_label])
      : h("span.epix-player-pill.epix-player-pill-plain", {}, [this.bars, this.state_label]);
    this.stats_box = o.onStats ? h("div.epix-player-statsbox") : null;

    // The menu nests in the right button cluster, so it drops directly above
    // the CC button like a menu should - not above the bar's gradient.
    var right = h("div.epix-player-right", {},
      [this.btn_cc, this.btn_full, this.cc_menu].filter(Boolean));
    var row = h("div.epix-player-row", {}, [
      this.btn_play, this.btn_back, this.btn_fwd,
      h("div.epix-player-volwrap", {}, [this.btn_vol, this.vol]),
      this.time, h("div.epix-player-spacer"), this.pill, right
    ]);
    this.controls = h("div.epix-player-controls", {}, [this.seek, row]);

    // Cues render into this bar, not natively: GeckoView (the Android shell)
    // never paints native cue text - its caption overlay belongs to the
    // native controls widget this player replaces - so the active track runs
    // "hidden" (parsed, firing cuechange) and every engine draws the same way.
    this.cue_bar = h("div.epix-player-cues", { "aria-live": "off" });

    this.root = h("div.epix-player", {}, [
      this.video, this.cue_bar, this.veil, this.stats_box, this.controls
    ].filter(Boolean));
    this.host.appendChild(this.root);

    // Nothing in the bar can do anything useful until metadata lands, so it
    // starts disabled. The transfer pill is deliberately left alive: while the
    // stream is opening it is the one control worth reaching for.
    this.setControlsEnabled(false);

    var saved = this.store[this.key] || {};
    this.video.volume = typeof saved.volume === "number" ? saved.volume : 1;
    this.vol.value = this.video.volume;
    this.start_at = this.opts.start || saved.time || 0;
    if (this.opts.autoplay) this.video.autoplay = true;
    this.buildCcMenu(saved.caption);
  };

  EpixPlayer.prototype.buildCcMenu = function (want_lang) {
    if (!this.cc_menu) return;
    var self = this;
    this.cc_menu.innerHTML = "";
    var mk = function (label, lang) {
      var b = h("button.epix-player-menu-item", { type: "button" }, [label]);
      b.addEventListener("click", function () { self.setCaption(lang); self.cc_menu.classList.remove("open"); });
      if (lang === self.caption_lang) b.classList.add("active");
      return b;
    };
    this.cc_menu.appendChild(mk("Off", null));
    this.tracks.forEach(function (t) { self.cc_menu.appendChild(mk(t.meta.label || t.meta.lang, t.meta.lang)); });
    if (want_lang) this.setCaption(want_lang);
  };

  EpixPlayer.prototype.setCaption = function (lang) {
    this.caption_lang = lang || null;
    if (lang && !this._cues[lang]) this.loadCaption(lang);
    this._cue_sig = null;
    this.renderCues();
    this.remember({ caption: this.caption_lang });
    if (this.btn_cc) this.btn_cc.classList.toggle("active", !!lang);
    this.buildCcMenu();
  };

  // Fetch and parse one caption track. The player owns the whole caption
  // pipeline (no <track>/TextTrack API): GeckoView never fetches tracks for
  // a controls-less video, and engines disagree on MIME strictness and
  // cuechange timing - one fetch and forty lines of parser sidestep all of
  // it identically everywhere.
  EpixPlayer.prototype.loadCaption = function (lang) {
    var self = this;
    var track = this.tracks.filter(function (t) { return t.meta.lang === lang; })[0];
    if (!track || this._cues[lang]) return;
    this._cues[lang] = []; // marks the fetch in flight; replaced on parse
    fetch(track.meta.src)
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (text) {
        self._cues[lang] = parseVtt(text);
        self._cue_sig = null; // repaint with the fresh cues
        self.renderCues();
      })
      .catch(function () {});
  };

  // Draw the cues covering the current playback position. Driven from
  // timeupdate and seeked; only touches the DOM when the active set changes.
  EpixPlayer.prototype.renderCues = function () {
    if (!this.cue_bar) return;
    var t = this.video.currentTime || 0;
    var cues = (this.caption_lang && this._cues[this.caption_lang]) || [];
    var active = [];
    var sig = this.caption_lang || "";
    for (var i = 0; i < cues.length; i++) {
      if (cues[i].start <= t && t < cues[i].end) {
        active.push(cues[i]);
        sig += "|" + cues[i].start;
      }
    }
    if (sig === this._cue_sig) return;
    this._cue_sig = sig;
    this.cue_bar.innerHTML = "";
    for (var j = 0; j < active.length; j++) {
      this.cue_bar.appendChild(h("div.epix-player-cue", {}, [active[j].text]));
    }
    this.cue_bar.classList.toggle("on", active.length > 0);
  };

  EpixPlayer.prototype.remember = function (patch) {
    var cur = this.store[this.key] || {};
    for (var k in patch) cur[k] = patch[k];
    this.store[this.key] = cur;
    saveStore(this.store);
  };

  EpixPlayer.prototype.wire = function () {
    var self = this;
    var v = this.video;

    this.on(v, "loadedmetadata", function () {
      self.root.classList.add("ready");
      self.msg.textContent = "";
      self.setControlsEnabled(true);
      self.refreshState();
      if (self.start_at > 0 && self.start_at < v.duration - 5) v.currentTime = self.start_at;
      self.paint();
    });
    this.on(v, "play", function () { self.root.classList.add("playing"); self.swapPlayIcon(true); self.autoHide(); self.refreshState(); self.pumpStats(); });
    this.on(v, "pause", function () { self.root.classList.remove("playing"); self.swapPlayIcon(false); self.show(); self.refreshState(); });
    this.on(v, "waiting", function () { self.root.classList.add("buffering"); self.refreshState(); self.pumpStats(); });
    this.on(v, "playing", function () { self.root.classList.remove("buffering"); self.refreshState(); });
    this.on(v, "timeupdate", function () {
      if (!self.seeking) self.paint();
      // Belt and braces for captions: cuechange is the primary signal, but
      // drive the cue bar from playback time too, so an engine with an
      // unreliable cuechange (or a paused seek that never fires it) still
      // paints the right cue within a frame or two.
      self.renderCues();
      // Throttle the resume write: timeupdate fires ~4x a second.
      var now = Date.now();
      if (!self._last_save || now - self._last_save > 5000) {
        self._last_save = now;
        if (v.currentTime > 3) self.remember({ time: v.currentTime });
      }
      if (self.opts.onTime) self.opts.onTime(v.currentTime, v.duration);
    });
    this.on(v, "progress", function () { self.paint(); });
    this.on(v, "seeking", function () { self.refreshState(); });
    this.on(v, "seeked", function () { self.refreshState(); self.renderCues(); });
    this.on(v, "ended", function () {
      self.remember({ time: 0 });
      self.root.classList.remove("playing");
      self.refreshState();
      self.swapPlayIcon(false);
      self.show();
      if (self.opts.onEnded) self.opts.onEnded();
    });
    this.on(v, "volumechange", function () {
      self.vol.value = v.volume;
      self.btn_vol.replaceChild(icon(v.muted || v.volume === 0 ? ICON.mute : ICON.vol), self.btn_vol.firstChild);
      self.remember({ volume: v.volume });
    });
    this.on(v, "error", function () { self.fail(); self.refreshState(); });

    this.on(this.big, "click", function () { self.toggle(); });
    this.on(this.btn_play, "click", function () { self.toggle(); });
    this.on(v, "click", function () { self.toggle(); });
    this.on(this.btn_back, "click", function () { v.currentTime = Math.max(0, v.currentTime - 10); });
    this.on(this.btn_fwd, "click", function () { v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); });
    this.on(this.btn_vol, "click", function () { v.muted = !v.muted; });
    this.on(this.vol, "input", function () { v.volume = parseFloat(self.vol.value); v.muted = false; });

    if (this.btn_cc) {
      this.on(this.btn_cc, "click", function (e) {
        e.stopPropagation();
        // Clamp the menu to the space above the controls INSIDE the player:
        // its css max-height (260px) is taller than a phone's whole player,
        // and the player's overflow:hidden cut the top items (Off, English)
        // off with no way to scroll to them.
        var pr = self.root.getBoundingClientRect();
        var cr = self.controls.getBoundingClientRect();
        self.cc_menu.style.maxHeight = Math.max(90, cr.top - pr.top - 14) + "px";
        self.cc_menu.classList.toggle("open");
        if (self.cc_menu.classList.contains("open")) {
          var act = self.cc_menu.querySelector(".active");
          if (act) act.scrollIntoView({ block: "nearest" });
          else self.cc_menu.scrollTop = 0; // "Off" and the first languages
        }
      });
      this.on(document, "click", function (e) {
        if (self.cc_menu && !self.cc_menu.contains(e.target) && e.target !== self.btn_cc) self.cc_menu.classList.remove("open");
      });
    }
    if (this.opts.onStats) {
      this.on(this.pill, "click", function (e) {
        e.stopPropagation();
        var open = self.stats_box.classList.toggle("open");
        if (open) self.pumpStats(); else clearTimeout(self._stats_timer);
      });
      this.on(document, "click", function (e) {
        if (self.stats_box && !self.stats_box.contains(e.target) && !self.pill.contains(e.target)) {
          self.stats_box.classList.remove("open");
        }
      });
    }
    this.on(this.btn_full, "click", function () { self.fullscreen(); });
    this.on(document, "fullscreenchange", function () {
      var on = document.fullscreenElement === self.root;
      self.root.classList.toggle("fullscreen", on);
      self.btn_full.replaceChild(icon(on ? ICON.exit : ICON.full), self.btn_full.firstChild);
    });

    // Seek: pointer events cover mouse and touch with one path.
    var seekTo = function (e) {
      var r = self.bar.getBoundingClientRect();
      var x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      return x * (v.duration || 0);
    };
    this.on(this.seek, "pointerdown", function (e) {
      if (!self._controls_on) return;
      self.seeking = true;
      self.seek.setPointerCapture(e.pointerId);
      v.currentTime = seekTo(e);
      self.paint();
    });
    this.on(this.seek, "pointermove", function (e) {
      if (!self._controls_on) return;
      var t = seekTo(e);
      var r = self.bar.getBoundingClientRect();
      self.tip.textContent = fmt(t);
      self.tip.style.left = Math.min(Math.max(e.clientX - r.left, 0), r.width) + "px";
      if (self.seeking) { v.currentTime = t; self.paint(); }
    });
    this.on(this.seek, "pointerup", function (e) {
      self.seeking = false;
      self.refreshState();
      try { self.seek.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    });

    this.on(this.root, "pointermove", function () { self.show(); self.autoHide(); });
    this.on(this.root, "pointerleave", function () { if (!v.paused) self.hide(); });

    // Keyboard, only while the player has focus or is fullscreen, so page-level
    // typing (the comment box) never steers playback.
    this.key_handler = function (e) {
      if (!self._controls_on) return;
      if (!self.root.contains(document.activeElement) && document.fullscreenElement !== self.root) return;
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      var handled = true;
      switch (e.key) {
        case " ": case "k": self.toggle(); break;
        case "ArrowLeft": case "j": v.currentTime = Math.max(0, v.currentTime - 10); break;
        case "ArrowRight": case "l": v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); break;
        case "ArrowUp": v.volume = Math.min(1, v.volume + 0.1); break;
        case "ArrowDown": v.volume = Math.max(0, v.volume - 0.1); break;
        case "m": v.muted = !v.muted; break;
        case "f": self.fullscreen(); break;
        case "c": if (self.tracks.length) self.setCaption(self.caption_lang ? null : self.tracks[0].meta.lang); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    };
    document.addEventListener("keydown", this.key_handler);
    this.root.tabIndex = 0;
  };

  EpixPlayer.prototype.on = function (el, ev, fn) {
    if (!this._off) this._off = [];
    el.addEventListener(ev, fn);
    this._off.push([el, ev, fn]);
  };

  EpixPlayer.prototype.swapPlayIcon = function (playing) {
    this.btn_play.replaceChild(icon(playing ? ICON.pause : ICON.play), this.btn_play.firstChild);
    this.btn_play.setAttribute("aria-label", playing ? "Pause" : "Play");
  };

  EpixPlayer.prototype.toggle = function () {
    if (!this._controls_on) return;
    if (this.video.paused) {
      var p = this.video.play();
      if (p && p.catch) p.catch(function () { /* autoplay blocked; the veil stays */ });
    } else {
      this.video.pause();
    }
  };

  EpixPlayer.prototype.fullscreen = function () {
    if (document.fullscreenElement === this.root) {
      document.exitFullscreen();
    } else if (this.root.requestFullscreen) {
      this.root.requestFullscreen().catch(function () { /* denied */ });
    } else if (this.video.webkitEnterFullscreen) {
      this.video.webkitEnterFullscreen(); // iOS only exposes native video fullscreen
    }
  };

  EpixPlayer.prototype.paint = function () {
    var v = this.video;
    var d = v.duration || 0;
    var pct = d ? (v.currentTime / d) * 100 : 0;
    this.cur.style.width = pct + "%";
    this.knob.style.left = pct + "%";
    var buffered = 0;
    if (v.buffered && v.buffered.length) {
      for (var i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) buffered = v.buffered.end(i);
      }
    }
    this.buf.style.width = (d ? (buffered / d) * 100 : 0) + "%";
    this.time.textContent = fmt(v.currentTime) + " / " + fmt(d);
    this.seek.setAttribute("aria-valuenow", Math.floor(v.currentTime));
    this.seek.setAttribute("aria-valuemax", Math.floor(d));
  };

  EpixPlayer.prototype.show = function () { this.root.classList.remove("idle"); };
  EpixPlayer.prototype.hide = function () { if (!this.video.paused) this.root.classList.add("idle"); };
  EpixPlayer.prototype.autoHide = function () {
    var self = this;
    clearTimeout(this.hide_timer);
    this.hide_timer = setTimeout(function () { self.hide(); }, 2600);
  };

  EpixPlayer.prototype.fail = function () {
    this.root.classList.add("failed");
    this.root.classList.remove("ready");
    this.setControlsEnabled(false);
    this.msg.textContent = "This film is not available from any peer right now.";
  };

  // The one-word state, and the class that colours its dot.
  EpixPlayer.prototype.setState = function (cls, label) {
    if (this._state_label !== label) {
      this._state_label = label;
      this.state_label.textContent = label;
    }
    var want = "epix-player-pill" + (this.opts.onStats ? "" : " epix-player-pill-plain") +
      (cls ? " " + cls : "");
    if (this.pill.className !== want) this.pill.className = want;
  };

  EpixPlayer.prototype.setControlsEnabled = function (on) {
    this._controls_on = on;
    [this.btn_play, this.btn_back, this.btn_fwd, this.btn_vol, this.btn_cc, this.btn_full]
      .forEach(function (b) {
        if (!b) return;
        if (on) b.removeAttribute("disabled");
        else b.setAttribute("disabled", "");
      });
    if (this.vol) this.vol.disabled = !on;
    this.seek.classList.toggle("epix-player-off", !on);
    this.seek.setAttribute("aria-disabled", on ? "false" : "true");
    this.seek.setAttribute("tabindex", on ? "0" : "-1");
  };

  // How healthy the stream is, 0 to 4 bars. Lead (seconds of film the node
  // holds past the play head) is the honest signal: the instantaneous rate
  // reads zero whenever the node is far enough ahead to stop fetching, which
  // is the healthy case, not a failure.
  EpixPlayer.prototype.signal = function (stats) {
    var s = stats || {};
    var peers = s.peers || [];
    if (s.have != null && s.size && s.have >= s.size) return { bars: 4, cls: "good" };
    if (!stats) return { bars: 0, cls: "bad" };
    var lead = this.leadSecs(stats);
    var need = this.needed(stats);
    var starved = need && s.rate_in != null && s.rate_in < need * 0.9;
    if (lead === null) return peers.length ? { bars: 2, cls: "warn" } : { bars: 0, cls: "bad" };
    var bars;
    if (lead > 30) bars = 4;
    else if (lead > 15) bars = 3;
    else if (lead > 8) bars = 2;
    else if (lead > 3) bars = 1;
    else bars = 0;
    // Arriving slower than the film plays: the lead is being spent, so show
    // one bar less than the lead alone would suggest.
    if (starved && bars > 0) bars -= 1;
    if (!peers.length && bars > 1) bars = 1;
    var cls = bars >= 3 ? "good" : (bars === 2 ? "ok" : (bars === 1 ? "warn" : "bad"));
    return { bars: bars, cls: cls };
  };

  EpixPlayer.prototype.setSignal = function (stats) {
    var sig = this.signal(stats);
    var want = "epix-player-bars b" + sig.bars + " " + sig.cls;
    if (this.bars.className !== want) this.bars.className = want;
    this.pill.title = this.opts.onStats
      ? this.verdict(stats)[1] + " (click for detail)"
      : this.verdict(stats)[1];
  };

  // Work out what to say from the element alone, except "waiting for peer",
  // which only the node can tell us (no peer holds the bytes) and which is
  // otherwise indistinguishable from ordinary buffering.
  EpixPlayer.prototype.refreshState = function () {
    var v = this.video;
    if (this.root.classList.contains("failed")) return this.setState("", "failed");
    if (v.ended) return this.setState("", "ended");
    if (v.seeking) return this.setState("wait", "jumping ahead");
    if (!this.root.classList.contains("ready")) return this.setState("wait", "connecting");
    if (v.paused) return this.setState("", "ready");
    if (v.readyState < 3) {
      return this.setState("wait", this._no_peers ? "waiting for peer" : "buffering");
    }
    return this.setState("live", "streaming");
  };

  // Poll the node for transfer numbers. Runs whenever playback is live (so the
  // pill can say "waiting for peer") and more often while the panel is open.
  EpixPlayer.prototype.pumpStats = function () {
    var self = this;
    if (!this.opts.onStats) return;
    clearTimeout(this._stats_timer);
    this.opts.onStats(function (stats) {
      self._no_peers = !!(stats && Array.isArray(stats.peers) && stats.peers.length === 0);
      self._last_stats = stats;
      self.sampleRate(stats);
      self.setSignal(stats);
      self.refreshState();
      if (self.stats_box && self.stats_box.classList.contains("open")) {
        self.renderStats(stats);
      }
      self._stats_at = Date.now();
      var open = self.stats_box && self.stats_box.classList.contains("open");
      if (open || !self.video.paused || self.video.readyState < 4) {
        self._stats_timer = setTimeout(function () { self.pumpStats(); }, 1000);
      }
    });
  };

  // Sample the arrival rate so the panel can draw a short history of it.
  EpixPlayer.prototype.sampleRate = function (stats) {
    if (!this._samples) this._samples = [];
    this._samples.push(stats && stats.rate_in ? stats.rate_in : 0);
    if (this._samples.length > 90) this._samples.shift();
  };

  // Bytes per second this film needs to play in real time: the node knows the
  // file size, the element knows the duration.
  EpixPlayer.prototype.needed = function (stats) {
    var v = this.video;
    if (!stats || !stats.size || !v.duration || !isFinite(v.duration)) return null;
    return stats.size / v.duration;
  };

  // Seconds of film the NODE holds past the read head.
  EpixPlayer.prototype.leadSecs = function (stats) {
    var need = this.needed(stats);
    if (!stats || stats.have_ahead === undefined || !need) return null;
    return stats.have_ahead / need;
  };

  // Seconds continuously buffered in the ELEMENT past the play head - the only
  // number that decides whether playback is about to stall.
  EpixPlayer.prototype.bufferAhead = function () {
    var v = this.video, t = v.currentTime;
    for (var i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= t + 0.25 && v.buffered.end(i) >= t) {
        return v.buffered.end(i) - t;
      }
    }
    return 0;
  };

  // One plain sentence saying whether the network is keeping up, and why not.
  EpixPlayer.prototype.verdict = function (stats) {
    var need = this.needed(stats);
    var got = stats ? stats.rate_in : null;
    var peers = (stats && stats.peers) || [];
    var have = stats ? stats.have : null;
    var lead = this.leadSecs(stats);
    if (!stats || (!peers.length && !have)) {
      return ["bad", "No peer is serving this film to your node right now."];
    }
    if (have !== null && stats.size && have >= stats.size) {
      return ["ok", "The whole film is on this node, playing from local storage."];
    }
    // A comfortable lead means the network is not the problem, whatever the
    // instantaneous rate reads (it drops to 0 once the node stops fetching).
    if (lead !== null && lead > 20) {
      return ["ok", "This node holds " + secs(lead) + " of film past the play head" +
        (got ? ", still pulling " + kbs(got) + "." : " and has paused fetching.")];
    }
    if (!peers.length) {
      return ["warn", "No peer is delivering right now" +
        (lead > 1 ? ", playing from " + secs(lead) + " of film already here." : ".")];
    }
    if (need && got !== null && got < need * 0.9) {
      return [lead !== null && lead > 8 ? "warn" : "bad",
        "Pulling " + kbs(got) + " from " + peers.length + " peer" +
        (peers.length === 1 ? "" : "s") + ", but this film needs " + kbs(need) +
        " to play without stopping."];
    }
    if (lead !== null && lead < 5 && !this.video.paused) {
      return ["warn", "Only " + secs(lead) + " of film past the play head is here."];
    }
    return ["ok", "Keeping ahead: " + (got ? kbs(got) : "idle") +
      (need ? " against " + kbs(need) + " needed." : ".")];
  };

  // The panel: a verdict, the numbers behind it in two columns, a rate
  // history, and who is actually delivering.
  EpixPlayer.prototype.renderStats = function (stats) {
    var box = this.stats_box;
    var self = this;
    var s = stats || {};
    var need = this.needed(stats);
    var lead = this.leadSecs(stats);
    var peers = s.peers || [];
    box.innerHTML = "";

    var close = h("button.epix-player-statx", { type: "button", title: "Close", "aria-label": "Close" }, ["\u00d7"]);
    close.addEventListener("click", function (e) {
      e.stopPropagation();
      box.classList.remove("open");
      clearTimeout(self._stats_timer);
    });
    box.appendChild(h("h4.epix-player-stattitle", {}, ["Transfer", close]));

    var vd = this.verdict(stats);
    box.appendChild(h("div.epix-player-verdict." + vd[0], {}, [vd[1]]));

    // Two columns: thirteen numbers fit without the panel ever scrolling.
    var grid = h("div.epix-player-statgrid");
    var row = function (k, val) {
      grid.appendChild(h("div", {}, [
        h("span", {}, [k]),
        h("b", {}, [val])
      ]));
    };
    var cachedPct = s.served ? Math.round((s.served_cached || 0) / s.served * 100) : null;
    row("Downloading", kbs(s.rate_in));
    row("Film needs", need ? kbs(need) : "--");
    row("Node ahead", lead === null ? mb(s.have_ahead) : secs(lead));
    row("Player buffer", secs(this.bufferAhead()));
    row("Have", mb(s.have) + (s.size ? " / " + mb(s.size) : ""));
    row("To player", kbs(s.rate_out));
    row("Chunks in flight", s.inflight === undefined ? "--" : String(s.inflight));
    row("From cache", cachedPct === null ? "--" : cachedPct + "%");
    row("Requests", (s.requests || 0) + (s.duplicates ? " +" + s.duplicates + " dup" : ""));
    row("Failed chunks", String(s.batch_failures || 0));
    row("Peers dialed", s.session && s.session.dialed
      ? (s.session.connected || 0) + " / " + s.session.dialed
      : (s.peers_known || 0) + " known");
    row("Reading ahead", s.readahead ? mb(s.readahead.end - s.readahead.start) : "idle");
    row("Session", secs(s.elapsed));
    box.appendChild(grid);

    var canvas = h("canvas.epix-player-spark", { height: "44" });
    box.appendChild(canvas);

    var total = 0;
    peers.forEach(function (p) { total += p.rate || 0; });
    box.appendChild(h("div.epix-player-stathead", {}, [
      "Peers (" + peers.length + (peers.length ? ", fastest first" : "") + ")"
    ]));
    if (peers.length) {
      peers.slice().sort(function (a, b) { return (b.rate || 0) - (a.rate || 0); }).forEach(function (p) {
        var sub = [mb(p.bytes) + " delivered", (p.requests || 0) + " req"];
        if (p.failed) sub.push(p.failed + " failed");
        if (p.inflight) sub.push(p.inflight + " in flight");
        if (p.last_ms) sub.push(p.last_ms + " ms/chunk");
        if (p.idle > 3) sub.push("idle " + secs(p.idle));
        var share = total ? Math.round((p.rate || 0) / total * 100) : 0;
        var fill = h("i");
        fill.style.width = share + "%";
        var tp = String(p.transport || "?");
        box.appendChild(h("div.epix-player-peer", {}, [
          h("div.epix-player-peertop", {}, [
            h("span.epix-player-tp." + (/^[a-z0-9]+$/i.test(tp) ? tp : "other"), {}, [tp]),
            h("span.epix-player-nm", { title: String(p.peer || "") }, [peerName(p.peer)]),
            h("span.epix-player-sp", {}, [kbs(p.rate)])
          ]),
          h("div.epix-player-peersub", {}, [sub.join(" \u00b7 ")]),
          h("div.epix-player-peerbar", {}, [fill])
        ]));
      });
    } else {
      box.appendChild(h("div.epix-player-statnote", {}, [
        "Nothing is delivering right now" +
        (s.peers_known ? " (" + s.peers_known + " peer" + (s.peers_known === 1 ? "" : "s") +
          " known for this library)." : ".")
      ]));
    }

    var err = s.last_error || (s.error ? { error: s.error } : null);
    if (err && err.error) {
      box.appendChild(h("div.epix-player-staterr", {}, [
        "Last error" + (err.at ? " (" + secs(err.at) + " ago)" : "") + ": " + err.error
      ]));
    }

    // The raw reply, for pasting into a bug report: the panel summarises, and
    // whoever reads the report wants the numbers it left out.
    var copy = h("button.epix-player-copy", { type: "button" }, ["copy raw"]);
    copy.addEventListener("click", function (e) {
      e.stopPropagation();
      var blob = JSON.stringify({
        at: Math.round(self.video.currentTime),
        duration: Math.round(self.video.duration || 0),
        player_buffered: Math.round(self.bufferAhead()),
        needs_bytes_per_sec: Math.round(need || 0),
        rate_history: self._samples || [],
        node: stats
      }, null, 1);
      var done = function (ok) {
        copy.textContent = ok ? "copied" : "copy failed";
        setTimeout(function () { copy.textContent = "copy raw"; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(blob).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    });
    box.appendChild(h("div.epix-player-statfoot", {}, [
      h("span", {}, ["Chunks are verified against the film\u2019s signed hash as they arrive." +
        (this._stats_at ? "  Updated " + Math.round((Date.now() - this._stats_at) / 1000) + "s ago." : "")]),
      " ", copy
    ]));

    // Draw after layout so clientWidth is real.
    this.drawSpark(canvas, need);
  };

  // Rate history. Bars go amber when bytes arrive slower than the film plays.
  EpixPlayer.prototype.drawSpark = function (canvas, need) {
    var samples = this._samples || [];
    var ctx = canvas.getContext("2d");
    var w = canvas.clientWidth || 260, hgt = 44;
    if (canvas.width !== w) canvas.width = w;
    ctx.clearRect(0, 0, w, hgt);
    if (!samples.length) return;
    var peak = Math.max.apply(null, samples.concat(need ? [need] : [1]));
    if (peak <= 0) peak = 1;
    var bw = w / 90;
    for (var i = 0; i < samples.length; i++) {
      var bh = Math.max(1, (samples[i] / peak) * (hgt - 6));
      var x = w - (samples.length - i) * bw;
      ctx.fillStyle = samples[i] === 0 ? "rgba(255,255,255,.16)"
        : (need && samples[i] < need ? "rgba(226,124,124,.75)" : "rgba(105,233,245,.75)");
      ctx.fillRect(x, hgt - bh, Math.max(1, bw - 1), bh);
    }
    if (need) {
      var y = hgt - (need / peak) * (hgt - 6);
      ctx.strokeStyle = "rgba(255,255,255,.42)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  function peerName(p) {
    if (!p) return "?";
    p = String(p);
    return p.length <= 26 ? p : p.slice(0, 12) + "\u2026" + p.slice(-11);
  }
  function secs(n) {
    if (n === null || n === undefined || !isFinite(n)) return "--";
    n = Math.round(n);
    if (n < 60) return n + "s";
    var m = Math.floor(n / 60);
    return m + "m " + (n % 60) + "s";
  }
  function kbs(bps) {
    if (bps === null || bps === undefined || !isFinite(bps)) return "--";
    if (!bps) return "idle";
    if (bps >= 1024 * 1024) return (bps / 1024 / 1024).toFixed(1) + " MB/s";
    return Math.round(bps / 1024) + " KB/s";
  }
  function mb(bytes) {
    if (bytes === null || bytes === undefined || !isFinite(bytes)) return "--";
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return Math.round(bytes / 1024 / 1024) + " MB";
  }

  EpixPlayer.prototype.destroy = function () {
    clearTimeout(this.hide_timer);
    clearTimeout(this._stats_timer);
    document.removeEventListener("keydown", this.key_handler);
    (this._off || []).forEach(function (o) { o[0].removeEventListener(o[1], o[2]); });
    this._off = [];
    try { this.video.pause(); } catch (e) { /* already gone */ }
    // Drop the buffer so a detached player stops holding the range fetches open.
    this.video.removeAttribute("src");
    while (this.video.firstChild) this.video.removeChild(this.video.firstChild);
    try { this.video.load(); } catch (e) { /* ignore */ }
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  EpixPlayer.fmt = fmt;
  window.EpixPlayer = EpixPlayer;
})(window);
