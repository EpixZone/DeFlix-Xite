// One category, in full: a grid with sorting, a rating filter and paging.
//
// This is where "See all" from a landing-page row leads. Series still collapse
// to a single card, so a category of 300 films with four serials in it browses
// as 300 minus the episodes those serials swallow.

(function () {
  var PAGE = 48;

  class Browse {
    constructor() {
      this.category = null;
      this.videos = [];
      this.total = 0;
      this.loaded = false;
      this.sort = "top";
      this.min_stars = 0;
      this.limit = PAGE;
      this.handleSort = this.handleSort.bind(this);
      this.handleStars = this.handleStars.bind(this);
      this.handleMore = this.handleMore.bind(this);
      this.render = this.render.bind(this);
    }

    setCategory(name) {
      if (this.category === name) return false;
      this.category = name;
      this.videos = [];
      this.loaded = false;
      this.limit = PAGE;
      this.update();
      return true;
    }

    SORTS() {
      return [
        { key: "top", label: _("Top") },
        { key: "rated", label: _("Best rated") },
        { key: "new", label: _("Newest") },
        { key: "title", label: _("A to Z") },
        { key: "duration", label: _("Longest") }
      ];
    }

    orderBy() {
      switch (this.sort) {
        // A rating needs a few votes behind it before it can lead the page.
        case "rated": return "(COALESCE(stars, 0) * MIN(votes, 5)) DESC, likes DESC";
        case "new": return "date_added DESC";
        case "title": return "title COLLATE NOCASE ASC";
        case "duration": return "duration DESC";
        default: return "(likes * 2 + COALESCE(stars, 0) * votes) DESC, date_added DESC";
      }
    }

    update(cb) {
      if (!this.category) return;
      var where = "video.category = :cat";
      var params = { cat: this.category };
      var having = this.min_stars
        ? "HAVING stars >= " + this.min_stars + " AND votes > 0"
        : "";
      var query = `
        SELECT video.video_id, video.title, video.year, video.category,
         video.series, video.series_id, video.episode, video.poster,
         video.duration, video.size, video.studio, video.date_added,
         (SELECT COUNT(*) FROM video_like WHERE video_like.key = video.video_id) AS likes,
         (SELECT COUNT(*) FROM comment WHERE comment.video_id = video.video_id) AS comments,
         (SELECT AVG(stars) FROM rating WHERE rating.key = video.video_id) AS stars,
         (SELECT COUNT(*) FROM rating WHERE rating.key = video.video_id) AS votes
        FROM video
        WHERE ${where}
        GROUP BY video.video_id
        ${having}
        ORDER BY ${this.orderBy()}
      `;
      Page.cmd("dbQuery", [query, params], (res) => {
        var rows = Page.rows(res);
        this.videos = collapseSeries(rows);
        // Films, not cards: a series folds into one card but is still twelve
        // films, and the row heading on the library says so too.
        this.total = rows.length;
        this.loaded = true;
        Page.projector.scheduleRender();
        if (cb) cb();
      });
    }

    handleSort(e) {
      var key = e.currentTarget.getAttribute("data-sort");
      if (key === this.sort) return false;
      this.sort = key;
      this.limit = PAGE;
      this.update();
      return false;
    }

    handleStars(e) {
      var n = parseInt(e.currentTarget.getAttribute("data-stars"), 10) || 0;
      this.min_stars = this.min_stars === n ? 0 : n;
      this.limit = PAGE;
      this.update();
      return false;
    }

    handleMore() {
      this.limit += PAGE;
      Page.projector.scheduleRender();
      return false;
    }

    render() {
      var shown = this.videos.slice(0, this.limit);
      return h("div.browse", { key: "browse-" + this.category }, [
        h("div.library-head", [
          h("div.library-headings", [
            h("a.browse-back", { href: "?", onclick: Page.handleLinkClick }, _("Library")),
            h("h1.library-title", this.category || ""),
            h("p.library-count", this.loaded
              ? _("{0} films").replace("{0}", this.total)
              : _("Loading..."))
          ]),
          h("div.library-controls", [
            h("div.library-sorts", this.SORTS().map((s) => {
              return h("button.library-sort", {
                key: s.key,
                "data-sort": s.key,
                classes: { active: this.sort === s.key },
                onclick: this.handleSort
              }, s.label);
            })),
            h("div.star-filter", [3, 4, 5].map((n) => {
              return h("button.star-filter-btn", {
                key: "f" + n,
                "data-stars": String(n),
                classes: { active: this.min_stars === n },
                onclick: this.handleStars,
                title: _("{0} stars and up").replace("{0}", n)
              }, [String(n), h("i.star.full")]);
            }))
          ])
        ]),
        shown.length
          ? h("div.film-grid", shown.map((v) => v.renderCard()))
          : h("div.library-empty", { key: "empty" }, [
              h("h2", this.min_stars ? _("Nothing rated that highly yet") : _("Nothing here")),
              this.min_stars
                ? h("p", _("Ratings come from viewers, so a new library has few."))
                : null
            ].filter(Boolean)),
        this.videos.length > this.limit
          ? h("div.library-more", [
              h("button.btn.btn-more", { onclick: this.handleMore }, _("Show more"))
            ])
          : null
      ]);
    }
  }

  Object.assign(Browse.prototype, LogMixin);

  window.Browse = Browse;
}).call(this);
