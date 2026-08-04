// A series: its episodes, in order, each individually watchable.
//
// Episodes keep their own likes, ratings and comments; the series page is a
// way in, not a separate thing. Numbered episodes lead, unnumbered ones follow
// alphabetically, because a serial's chapter order is the point and a cartoon
// run has no order to speak of.

(function () {
  class SeriesView {
    constructor() {
      this.series_id = null;
      this.info = null;
      this.episodes = [];
      this.loaded = false;
      this.missing = false;
      this.render = this.render.bind(this);
    }

    setSeries(series_id) {
      if (this.series_id === series_id) return false;
      this.series_id = series_id;
      this.info = Page.series_by_id[series_id] || null;
      this.episodes = [];
      this.loaded = false;
      this.missing = false;
      this.retry_count = 0;
      if (this.retry_timer) {
        clearTimeout(this.retry_timer);
        this.retry_timer = null;
      }
      if (Page.shell) Page.shell.title = this.info ? this.info.name : " ";
      this.update();
      return true;
    }

    update(cb) {
      if (!this.series_id) return;
      var query = `
        SELECT video.video_id, video.title, video.year, video.category,
         video.series, video.series_id, video.episode, video.poster,
         video.duration, video.size, video.studio, video.description,
         video.date_added,
         (SELECT COUNT(*) FROM video_like WHERE video_like.key = video.video_id) AS likes,
         (SELECT COUNT(*) FROM comment WHERE comment.video_id = video.video_id) AS comments,
         (SELECT AVG(stars) FROM rating WHERE rating.key = video.video_id) AS stars,
         (SELECT COUNT(*) FROM rating WHERE rating.key = video.video_id) AS votes
        FROM video
        WHERE video.series_id = :sid
        ORDER BY (video.episode IS NULL), video.episode, video.title COLLATE NOCASE
      `;
      Page.cmd("dbQuery", [query, { sid: this.series_id }], (res) => {
        this.episodes = Page.rows(res).map((r) => new Video(r));
        if (!this.info) this.info = Page.series_by_id[this.series_id] || null;
        // No rows is only a missing series once the index is in and does not
        // know the id either. A known id, a db error, or an index that has
        // not landed yet mean the node is still ingesting the catalogue
        // after a clone - keep the loading state and poll until it fills.
        this.missing = this.episodes.length === 0
          && Page.index_loaded && !Page.db_error && !this.info;
        if (!this.info && this.episodes.length) {
          this.info = {
            name: this.episodes[0].series,
            category: this.episodes[0].category,
            count: this.episodes.length
          };
        }
        if (Page.shell && this.info) Page.shell.title = this.info.name;
        this.loaded = this.missing || this.episodes.length > 0;
        if (!this.loaded && !this.retry_timer && (this.retry_count = (this.retry_count || 0) + 1) <= 100) {
          var sid = this.series_id;
          this.retry_timer = setTimeout(() => {
            this.retry_timer = null;
            if (this.series_id === sid) this.update();
          }, 3000);
        }
        Page.projector.scheduleRender();
        if (cb) cb();
      });
    }

    totalRuntime() {
      var secs = this.episodes.reduce((n, e) => n + (e.duration || 0), 0);
      if (!secs) return "";
      var m = Math.round(secs / 60);
      var h_ = Math.floor(m / 60);
      m = m % 60;
      return h_ ? h_ + "h " + m + "m" : m + "m";
    }

    // On a page headed "Betty Boop", twenty-five rows each beginning
    // "Betty Boop:" say nothing. Drop the series name where the rest of the
    // title still stands on its own.
    episodeTitle(v) {
      var name = (this.info && this.info.name) || "";
      if (!name) return v.title;
      var t = v.title;
      if (t.toLowerCase().indexOf(name.toLowerCase()) !== 0) return t;
      var rest = t.slice(name.length).replace(/^[\s:\-–—,.]+/, "");
      return rest.length >= 3 ? rest : t;
    }

    renderEpisode(v, i) {
      return h("a.episode", {
        href: "?Watch/" + v.video_id,
        key: v.video_id,
        onclick: Page.handleLinkClick
      }, [
        h("div.episode-num", v.episode ? String(v.episode) : String(i + 1)),
        v.poster
          ? h("img.episode-thumb", { src: v.poster, alt: "", loading: "lazy" })
          : h("div.episode-thumb.episode-thumb-empty"),
        h("div.episode-body", [
          h("h3.episode-title", this.episodeTitle(v)),
          h("div.episode-sub", [
            v.duration ? h("span", v.formatDuration()) : null,
            v.year ? h("span", String(v.year)) : null,
            v.votes ? h("span", [Video.renderStars(v.stars, "tiny"), " " + v.stars]) : null,
            h("span", [h("span.icon-heart"), " " + v.likes])
          ].filter(Boolean))
        ])
      ]);
    }

    render() {
      if (this.missing) {
        return h("div.watch-missing", { key: "missing" }, [
          h("h1", _("Series not found")),
          h("a.btn.btn-primary", { href: "?", onclick: Page.handleLinkClick }, _("Back to the library"))
        ]);
      }
      if (!this.loaded || !this.info) {
        return h("div.watch-loading", { key: "loading" }, _("Loading..."));
      }
      var cat = this.info.category;
      return h("div.series", { key: "series-" + this.series_id }, [
        h("div.library-head", [
          h("div.library-headings", [
            cat
              ? h("a.browse-back", {
                  href: "?Category/" + encodeURIComponent(cat),
                  onclick: Page.handleLinkClick
                }, cat)
              : h("a.browse-back", { href: "?", onclick: Page.handleLinkClick }, _("Library")),
            h("h1.library-title", this.info.name),
            h("p.library-count", [
              _("{0} episodes").replace("{0}", this.episodes.length),
              this.totalRuntime() ? "  ·  " + this.totalRuntime() : ""
            ].join(""))
          ])
        ]),
        h("div.episode-list", this.episodes.map((v, i) => this.renderEpisode(v, i)))
      ]);
    }
  }

  Object.assign(SeriesView.prototype, LogMixin);

  window.SeriesView = SeriesView;
}).call(this);
