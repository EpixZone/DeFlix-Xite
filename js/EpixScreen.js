// DeFlix (Decentralized Flix) - open cinema on EpixNet.
//
// One page, two views: the library grid and a film. There is no per-film HTML
// file; ?Watch/<video_id> is routed here and the film is rendered from the DB,
// so a permalink opens straight onto the film and Back returns to the library.

(function () {
  var EpixFrame = window.EpixFrame;

  window.h = maquette.h;

  class EpixScreen extends EpixFrame {
    init() {
      this.site_info = null;
      this.server_info = null;
      this.catalog = {};             // video_id -> catalog entry (sources/captions)
      this.index = { categories: [], series: [], total: 0 };
      this.series_by_id = {};
      this.loaded_categories = {};
      this.category_waiters = {};
      this.xid_profiles = {};        // "name.epix" -> {name, tld, avatar, bio}
      this.db_error = null;          // last dbQuery failure, shown in place of a view
      this.xid_site = "epix1xid5nn6nkzqn8urx7ykhq5xzfncjyjzzrx0e4x";
      this.user = new User();
      this.shell = new Shell();
      this.library = new Library();
      this.browse = new Browse();
      this.series = new SeriesView();
      this.watch = new Watch();
      this.content = this.library;
      this.history_state = {};
      this.handleLinkClick = this.handleLinkClick.bind(this);
      this.renderShell = this.renderShell.bind(this);
      this.on_site_info = new Deferred();
      this.projector = maquette.createProjector();

      // Escape and outside clicks close the share popover wherever it is open.
      this.share_dismiss = (e) => {
        if (!this.watch || !this.watch.sharing) return;
        if (e.type === "keydown" && e.key !== "Escape") return;
        if (e.type === "click" && e.target.closest && e.target.closest(".share-wrap")) return;
        this.watch.sharing = false;
        this.projector.scheduleRender();
      };
      document.addEventListener("keydown", this.share_dismiss);
      document.addEventListener("click", this.share_dismiss);

      this.cmd("wrapperGetState", [], (state) => {
        this.history_state = state || {};
      });
      this.cmd("siteInfo", {}, (site_info) => {
        this.setSiteInfo(site_info);
        this.loadCatalog(() => {
          this.route(window.location.search.replace("?", ""));
          this.projector.replace($("#Shell"), this.renderShell);
          this.hideLoading();
        });
      });
      return this.cmd("serverInfo", {}, (server_info) => {
        this.server_info = server_info;
      });
    }

    // The index is small: category names, series, counts. The films themselves
    // live in one file per category and are fetched only when something needs
    // a film's sources or captions, which at ~1,150 films keeps the page load
    // to about 10 KB instead of over a megabyte.
    loadCatalog(cb) {
      this.cmd("fileGet", { "inner_path": "data/videos.json", "required": false }, (data) => {
        var parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
        this.index = parsed || { categories: [], series: [], total: 0 };
        this.index_loaded = !!parsed;
        this.series_by_id = {};
        (this.index.series || []).forEach((s) => { this.series_by_id[s.series_id] = s; });
        // On a fresh clone the index may not have hit the disk yet; keep
        // asking until it does, so deep links and the library heal without
        // a manual reload.
        if (!parsed && !this.index_retry) {
          this.index_retry = setTimeout(() => {
            this.index_retry = null;
            this.loadCatalog(() => { this.projector.scheduleRender(); });
          }, 3000);
        }
        if (cb) cb();
      });
    }

    categorySlug(name) {
      var hit = (this.index.categories || []).find((c) => c.name === name);
      return hit ? hit.slug : String(name || "other").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }

    // Fetch one category's films, once, and fold them into the lookup the
    // watch page reads. Concurrent callers share the same request.
    loadCategory(name, cb) {
      var slug = this.categorySlug(name);
      if (this.loaded_categories[slug]) return cb(true);
      if (!this.category_waiters[slug]) {
        this.category_waiters[slug] = [];
        this.cmd("fileGet", { "inner_path": "data/catalog/" + slug + ".json", "required": false }, (data) => {
          var parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
          (parsed && parsed.video ? parsed.video : []).forEach((entry) => {
            this.catalog[entry.video_id] = entry;
          });
          this.loaded_categories[slug] = true;
          var waiting = this.category_waiters[slug] || [];
          delete this.category_waiters[slug];
          waiting.forEach((fn) => fn(!!parsed));
        });
      }
      this.category_waiters[slug].push(cb);
    }

    // A film's media, fetching its category first if we have not seen it.
    needVideo(video_id, category, cb) {
      if (this.catalog[video_id]) return cb(this.catalog[video_id]);
      if (!category) return cb(null);
      this.loadCategory(category, () => cb(this.catalog[video_id] || null));
    }

    // dbQuery answers with an array of rows, or an object carrying an error
    // when the schema is not in place yet (a fresh clone, a schema change
    // still rebuilding). Every view goes through here so one failing query
    // shows a message instead of throwing partway through a render.
    rows(res) {
      if (Array.isArray(res)) { this.db_error = null; return res; }
      this.db_error = (res && res.error) ? String(res.error) : _("The library is still being indexed.");
      this.log("dbQuery failed:", this.db_error);
      return [];
    }

    hideLoading() {
      var overlay = document.getElementById("loading-overlay");
      if (!overlay) return;
      overlay.classList.add("fade-out");
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 500);
    }

    // Look up xID profiles for a set of user directories ("name.epix", or the
    // "users/name.epix" the database reports) so comments can show real
    // avatars. Cached per name; unknown names are cached as empty so a missing
    // profile is not re-asked on every render.
    resolveXids(names, cb) {
      var want = [];
      var seen = {};
      (names || []).forEach((raw) => {
        var name = User.displayDir(raw);
        if (!name || seen[name] || this.xid_profiles[name]) return;
        seen[name] = true;
        want.push(name);
      });
      if (!want.length) { if (cb) cb(false); return; }
      this.cmd("xidResolveBatch", [want], (results) => {
        want.forEach((n) => { this.xid_profiles[n] = (results && results[n]) || {}; });
        if (cb) cb(true);
      });
    }

    // The avatar URL for a user directory, or "" when they have none.
    xidAvatar(raw) {
      var p = this.xid_profiles[User.displayDir(raw)];
      return (p && p.avatar) || "";
    }

    setSiteInfo(site_info) {
      this.site_info = site_info;
      var cert_changed = this.user.update(site_info);
      if (!this.on_site_info.resolved) this.on_site_info.resolve();
      if (cert_changed) {
        // The header shows the signed-in user's own avatar, but resolveXids
        // otherwise only ever runs for comment authors - so a user who had
        // not commented on the open page stayed a letter forever.
        if (this.user.canWrite()) {
          this.resolveXids([this.user.userDir()], (found) => {
            if (found) this.projector.scheduleRender();
          });
        }
        this.projector.scheduleRender();
      }
      return cert_changed;
    }

    route(query) {
      this.params = Text.queryParse(query);
      if (!this.params.urls) this.params.urls = [""];
      var target = this.params.urls[0];
      var arg = this.params.urls[1];
      if (target === "Watch" && arg) {
        this.content = this.watch;
        this.watch.setVideo(arg);
      } else if (target === "Series" && arg) {
        this.content = this.series;
        this.watch.destroyPlayer();
        this.series.setSeries(arg);
      } else if (target === "Category" && arg) {
        this.content = this.browse;
        this.shell.title = null;
        this.watch.destroyPlayer();
        this.browse.setCategory(decodeURIComponent(arg));
      } else {
        this.content = this.library;
        this.shell.title = null;
        // Coming back from a film: stop its download and free the buffer.
        this.watch.destroyPlayer();
        this.library.update();
      }
      this.projector.scheduleRender();
    }

    setUrl(url, mode) {
      if (mode == null) mode = "push";
      url = url.replace(/.*?\?/, "");
      if (this.history_state["url"] === url) {
        this.content.update();
        return false;
      }
      this.history_state["url"] = url;
      this.history_state["scrollTop"] = 0;
      if (mode === "replace") this.cmd("wrapperReplaceState", [this.history_state, "", url]);
      else this.cmd("wrapperPushState", [this.history_state, "", url]);
      this.route(url);
      window.scrollTo(0, 0);
      return false;
    }

    handleLinkClick(e) {
      var el = e.currentTarget;
      var href = el.getAttribute("href");
      if (!href || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return true;
      this.setUrl(href);
      e.preventDefault();
      return false;
    }

    // A full link a viewer can paste anywhere: the wrapper knows the real host.
    shareLink(video_id) {
      var base = (this.site_info && this.site_info.address) || "";
      return "epix://" + base + "/?Watch/" + video_id;
    }

    // Live transfer numbers for the player's state pill and panel. The reply
    // is handed over as-is; the player knows how to read it.
    videoStats(video_id, cb) {
      var entry = this.catalog[video_id];
      var inner = entry && entry.sources && entry.sources[0] ? entry.sources[0].src : null;
      if (!inner) return cb(null);
      this.cmd("fileTransferStats", { "inner_path": inner }, (stats) => {
        cb(stats && !stats.error ? stats : null);
      });
    }

    // Every write needs a xID; point the viewer at the one place to get one.
    requireXid() {
      this.cmd("wrapperConfirm", [
        _("Liking and commenting needs a xID, your identity on EpixNet."),
        _("Get a xID")
      ], (confirmed) => {
        if (confirmed) this.user.openXid();
      });
      return false;
    }

    renderShell() {
      return h("div.shell-root", { key: "root" }, [this.shell.render(this.content.render())]);
    }

    onRequest(cmd, message) {
      if (cmd === "setSiteInfo") {
        var changed = this.setSiteInfo(message.params);
        var event = message.params.event || [];
        if (event[0] === "file_done" || event[0] === "file_failed") {
          // New records arrived from a peer: refresh whatever is on screen.
          RateLimit(1500, () => this.content.update());
        }
        if (changed) {
          this.user.loadMine();
          this.content.update();
        }
      } else if (cmd === "wrapperPopState") {
        var state = message.params.state;
        this.route((state && state.url) || "");
        if (state && state.scrollTop) window.scrollTo(0, state.scrollTop);
      } else if (cmd === "wrapperOpenedWebsocket") {
        this.cmd("siteInfo", {}, (site_info) => {
          this.setSiteInfo(site_info);
          this.content.update();
        });
      }
    }
  }

  window.Page = new EpixScreen();
}).call(this);
