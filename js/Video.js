// One entry in the library: a film, or the card that stands for a whole series.
//
// The database row carries everything a card needs. Sources and captions live
// in the per-category catalogue file and are only fetched when a film is
// actually played.

(function () {
  class Video {
    constructor(row) {
      this.setRow(row || {});
    }

    setRow(row) {
      this.row = row;
      this.video_id = row.video_id;
      this.title = row.title || row.video_id || "";
      this.year = row.year || null;
      this.category = row.category || null;
      this.series = row.series || null;
      this.series_id = row.series_id || null;
      this.episode = row.episode || null;
      this.description = row.description || "";
      this.poster = row.poster || null;
      this.duration = row.duration || 0;
      this.size = row.size || 0;
      this.studio = row.studio || null;
      this.license = row.license || null;
      this.source = row.source || null;
      this.date_added = row.date_added || 0;
      this.likes = row.likes || 0;
      this.comments = row.comments || 0;
      this.stars = row.stars ? Math.round(row.stars * 10) / 10 : 0;
      this.votes = row.votes || 0;
      this.is_series = false;
      this.series_count = null;
      return this;
    }

    getLink() {
      // A collapsed series card opens the series, not one of its episodes.
      return this.is_series && this.series_id
        ? "?Series/" + this.series_id
        : "?Watch/" + this.video_id;
    }

    // Sources and captions, once the film's category has been fetched.
    getMedia() {
      var entry = (Page.catalog || {})[this.video_id] || {};
      return {
        sources: entry.sources || [],
        captions: entry.captions || [],
        poster: entry.poster || this.poster
      };
    }

    formatDuration() {
      if (!this.duration) return "";
      var s = Math.floor(this.duration % 60);
      var m = Math.floor(this.duration / 60) % 60;
      var hr = Math.floor(this.duration / 3600);
      return hr
        ? hr + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
        : m + ":" + String(s).padStart(2, "0");
    }

    formatSize() {
      if (!this.size) return "";
      var mb = this.size / (1024 * 1024);
      return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : Math.round(mb) + " MB";
    }

    // Five glyphs, filled to the nearest half. Rendered as one element per
    // star with a stable key so a rating landing mid-render never reshapes it.
    static renderStars(value, extra_class) {
      var v = value || 0;
      return h("span.stars" + (extra_class ? "." + extra_class : ""),
        [1, 2, 3, 4, 5].map(function (n) {
          var cls = v >= n - 0.25 ? "full" : (v >= n - 0.75 ? "half" : "empty");
          return h("i.star", { key: "s" + n, classes: { full: cls === "full", half: cls === "half" } });
        }));
    }

    renderCard() {
      var media = this.getMedia();
      var poster = media.poster || this.poster;
      return h("a.film-card", {
        href: this.getLink(),
        key: this.is_series ? "s-" + this.series_id : this.video_id,
        onclick: Page.handleLinkClick,
        title: this.is_series ? this.series : this.title
      }, [
        h("div.film-thumb", [
          poster
            ? h("img.film-poster", { src: poster, alt: "", loading: "lazy" })
            : h("div.film-poster.film-poster-empty"),
          this.is_series
            ? h("span.film-episodes", (this.series_count || "") + " " + _("episodes"))
            : (this.duration ? h("span.film-duration", this.formatDuration()) : null)
        ].filter(Boolean)),
        h("div.film-meta", [
          h("h3.film-title", this.is_series ? this.series : this.title),
          h("div.film-sub", [
            this.year ? h("span.film-year", String(this.year)) : null,
            this.studio ? h("span.film-studio", this.studio) : null
          ].filter(Boolean)),
          this.is_series ? null : h("div.film-stats", [
            this.votes
              ? h("span.film-stat.film-rating", { title: _("{0} ratings").replace("{0}", this.votes) },
                  [Video.renderStars(this.stars, "tiny"), " " + this.stars])
              : null,
            h("span.film-stat", { title: _("Likes") }, [h("span.icon-heart"), " " + this.likes]),
            h("span.film-stat", { title: _("Comments") }, [h("span.icon-comment"), " " + this.comments])
          ].filter(Boolean))
        ].filter(Boolean))
      ]);
    }
  }

  Object.assign(Video.prototype, LogMixin);

  window.Video = Video;
}).call(this);
