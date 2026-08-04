// The landing view: a row per category, most liked leading the page.
//
// One SQL pass per row builds the whole page, so a library of a thousand films
// costs about what a dozen did. A series occupies a single card in its row
// rather than one card per episode, which is what stops a twelve-chapter
// serial filling the screen on its own.

(function () {
  var ROW_SIZE = 18;          // cards per row; the row scrolls sideways
  var ROW_FETCH = ROW_SIZE * 4;  // fetched before series fold into one card

  class Library {
    constructor() {
      this.rows = [];
      this.loaded = false;
      this.search = "";
      this.results = [];
      this.handleSearch = this.handleSearch.bind(this);
      this.enhanceRow = this.enhanceRow.bind(this);
      this.handleClearSearch = this.handleClearSearch.bind(this);
      this.render = this.render.bind(this);
    }

    // Ranked by likes with ratings weighted by how many people voted, so one
    // five-star vote cannot outrank a well-liked film.
    rowQuery(where, limit) {
      return `
        SELECT video.video_id, video.title, video.year, video.category,
         video.series, video.series_id, video.episode, video.poster,
         video.duration, video.size, video.studio, video.date_added,
         (SELECT COUNT(*) FROM video_like WHERE video_like.key = video.video_id) AS likes,
         (SELECT COUNT(*) FROM comment WHERE comment.video_id = video.video_id) AS comments,
         (SELECT AVG(stars) FROM rating WHERE rating.key = video.video_id) AS stars,
         (SELECT COUNT(*) FROM rating WHERE rating.key = video.video_id) AS votes
        FROM video
        WHERE ${where}
        ORDER BY (likes * 2 + COALESCE(stars, 0) * votes) DESC, date_added DESC
        LIMIT ${limit}
      `;
    }

    update(cb) {
      var jobs = [{
        key: "top",
        title: _("Most liked"),
        link: null,
        query: this.rowQuery("1 = 1", ROW_FETCH)
      }];
      (Page.index.categories || []).forEach((c) => {
        jobs.push({
          key: c.slug,
          title: c.name,
          count: c.count,
          link: "?Category/" + encodeURIComponent(c.name),
          query: this.rowQuery("video.category = '" + c.name.replace(/'/g, "''") + "'", ROW_FETCH)
        });
      });

      var pending = jobs.length;
      var out = new Array(jobs.length);
      jobs.forEach((job, i) => {
        Page.cmd("dbQuery", [job.query, {}], (res) => {
          out[i] = Object.assign({}, job, {
            items: collapse(Page.rows(res)).slice(0, ROW_SIZE)
          });
          if (--pending === 0) {
            this.rows = out.filter((r) => r && r.items.length);
            var series = this.seriesRow();
            if (series) this.rows.splice(1, 0, series);
            this.leadRow();
            this.loaded = true;
            // Every film row empty while the index promises films (or has
            // not landed itself) is a node still ingesting the catalogue
            // after a clone, not an empty library. Keep polling so the rows
            // appear as the db fills, and say what is happening meanwhile.
            var no_films = !out.some((r) => r && r.items.length);
            this.indexing = no_films &&
              (!!Page.db_error || !Page.index_loaded || Page.index.total > 0);
            if (this.indexing && !this.retry_timer) {
              this.retry_timer = setTimeout(() => {
                this.retry_timer = null;
                this.update();
              }, 3000);
            }
            Page.projector.scheduleRender();
            if (cb) cb();
          }
        });
      });
    }

    // The series, straight from the index. Ranked by episode count, so the
    // longest runs lead. No SQL: the index already knows the name, the poster
    // and how many episodes each has.
    seriesRow() {
      var all = (Page.index.series || []).slice()
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      if (all.length < 2) return null;
      return {
        key: "series",
        title: _("Series"),
        count: all.length,
        link: null,
        items: all.map((s) => {
          var v = new Video({
            video_id: s.episodes && s.episodes[0],
            title: s.name,
            series: s.name,
            series_id: s.series_id,
            category: s.category,
            poster: s.poster
          });
          v.is_series = true;
          v.series_count = s.count;
          return v;
        })
      };
    }

    // "Most liked" means nothing until somebody has liked something, and the
    // tiebreak (date added) would fill the row with whatever was fetched last,
    // which is one category twice over. Until there is any engagement at all,
    // lead with one film from each category instead and say so.
    leadRow() {
      var top = this.rows[0];
      if (!top || top.key !== "top") return;
      var engaged = this.rows.some((r) =>
        r.items.some((v) => v.likes > 0 || v.votes > 0));
      if (engaged) { top.title = _("Most liked"); return; }
      var cats = this.rows.slice(1);
      if (!cats.length) return;
      var mixed = [], seen = {};
      for (var i = 0; mixed.length < ROW_SIZE && i < 40; i++) {
        var added = false;
        cats.forEach((c) => {
          var v = c.items[i];
          if (!v || mixed.length >= ROW_SIZE) return;
          var id = v.is_series ? "s-" + v.series_id : v.video_id;
          if (seen[id]) return;
          seen[id] = true;
          mixed.push(v);
          added = true;
        });
        if (!added) break;
      }
      top.title = _("Start here");
      top.items = mixed;
    }

    handleSearch(e) {
      this.search = e.target.value.trim();
      if (!this.search) {
        this.results = [];
        Page.projector.scheduleRender();
        return;
      }
      RateLimit(300, () => {
        if (!this.search) return;
        var q = this.rowQuery(
          "(video.title LIKE :q OR video.description LIKE :q OR video.studio LIKE :q" +
          " OR video.series LIKE :q)", 60);
        Page.cmd("dbQuery", [q, { q: "%" + this.search + "%" }], (res) => {
          this.results = collapse(Page.rows(res));
          Page.projector.scheduleRender();
        });
      });
    }

    handleClearSearch() {
      this.search = "";
      this.results = [];
      Page.projector.scheduleRender();
      return false;
    }

    renderHead() {
      return h("div.library-head", [
        h("div.library-headings", [
          h("h1.library-title", _("Library")),
          h("p.library-count", this.search
            ? _("{0} results").replace("{0}", this.results.length)
            : _("{0} films").replace("{0}", Page.index.total || 0))
        ]),
        h("div.library-controls", [
          h("input.library-search", {
            type: "search",
            placeholder: _("Search films"),
            value: this.search,
            oninput: this.handleSearch,
            "aria-label": _("Search films")
          }),
          this.search
            ? h("button.btn.btn-ghost", { onclick: this.handleClearSearch }, _("Clear"))
            : null
        ].filter(Boolean))
      ]);
    }

    // Wire one row's strip: chevrons page by a screenful, and at-start /
    // at-end classes drive which chevron and edge fade shows. All of it works
    // on the DOM directly, off the projector: scroll position is not app
    // state, and re-rendering 150 cards on every scroll tick would be absurd.
    // Bound once in the constructor; listeners live and die with the element,
    // so nothing global to unhook (this maquette has no afterRemoved).
    enhanceRow(el) {
      var strip = el.querySelector(".row-strip");
      var prev = el.querySelector(".row-nav-prev");
      var next = el.querySelector(".row-nav-next");
      if (!strip || !prev || !next) return;
      var sync = function () {
        var max = strip.scrollWidth - strip.clientWidth;
        el.classList.toggle("at-start", strip.scrollLeft < 4);
        el.classList.toggle("at-end", strip.scrollLeft > max - 4);
        el.classList.toggle("no-overflow", max < 4);
      };
      // Nearly a full screenful per click; the overlap keeps your place.
      var page = function (dir) {
        strip.scrollBy({
          left: dir * Math.max(strip.clientWidth - 140, 200),
          behavior: "smooth"
        });
      };
      prev.addEventListener("click", function () { page(-1); });
      next.addEventListener("click", function () { page(1); });
      strip.addEventListener("scroll", sync, { passive: true });
      // A window resize moves the end edge; re-checking when the pointer
      // returns covers it without a window listener to leak.
      el.addEventListener("mouseenter", sync);
      sync();
    }

    renderRow(row) {
      return h("section.row", { key: row.key }, [
        h("div.row-head", [
          row.link
            ? h("a.row-title", { href: row.link, onclick: Page.handleLinkClick }, [
                row.title, h("span.row-count", String(row.count || row.items.length))
              ])
            : h("span.row-title", row.title),
          row.link
            ? h("a.row-all", { href: row.link, onclick: Page.handleLinkClick }, _("See all"))
            : null
        ].filter(Boolean)),
        // A row scrolls sideways rather than wrapping, so the page stays a
        // list of categories instead of a wall of posters.
        h("div.row-body.at-start", { afterCreate: this.enhanceRow }, [
          h("button.row-nav.row-nav-prev", {
            type: "button", "aria-label": _("Scroll back")
          }),
          h("div.row-strip", row.items.map((v) => v.renderCard())),
          h("button.row-nav.row-nav-next", {
            type: "button", "aria-label": _("Scroll forward")
          })
        ])
      ]);
    }

    render() {
      if (this.search) {
        return h("div.library", { key: "library" }, [
          this.renderHead(),
          this.results.length
            ? h("div.film-grid", this.results.map((v) => v.renderCard()))
            : h("div.library-empty", [
                h("h2", _("Nothing matches that")),
                h("p", _("Try a different title, studio or word from a description."))
              ])
        ]);
      }
      return h("div.library", { key: "library" }, [
        this.renderHead(),
        this.renderBody()
      ]);
    }

    renderBody() {
      if (!this.loaded) {
        return h("div.library-empty", { key: "loading" }, [h("p", _("Loading..."))]);
      }
      // An empty library with a failed query is a node still indexing, not an
      // empty library. Say which, so nobody reads it as "there is nothing here".
      if (!this.rows.length) {
        var still = Page.db_error || this.indexing;
        return h("div.library-empty", { key: "empty" }, [
          h("h2", still ? _("The library is still being indexed") : _("Nothing here yet")),
          h("p", still
            ? _("This node is still reading the catalogue. Films appear as it loads.")
            : _("No films have been added to this xite."))
        ]);
      }
      var rows = this.rows.map((r) => this.renderRow(r));
      if (this.indexing) {
        // The series row renders from the index alone, so it can stand while
        // every film row is still empty - without this line that reads as a
        // series-only library.
        rows.unshift(h("div.library-empty", { key: "indexing" }, [
          h("p", _("The library is still being indexed. Films appear as it loads."))
        ]));
      }
      return h("div.rows", rows);
    }
  }

  // Fold a series' episodes into one card carrying the series' own totals.
  function collapse(rows) {
    var out = [], seen = {};
    rows.forEach((r) => {
      if (!r.series_id) { out.push(new Video(r)); return; }
      if (seen[r.series_id]) return;
      seen[r.series_id] = true;
      var v = new Video(r);
      var s = Page.series_by_id[r.series_id];
      v.is_series = true;
      v.series_count = s ? s.count : null;
      if (s && s.poster) v.poster = s.poster;
      out.push(v);
    });
    return out;
  }

  window.collapseSeries = collapse;

  Object.assign(Library.prototype, LogMixin);

  window.Library = Library;
}).call(this);
