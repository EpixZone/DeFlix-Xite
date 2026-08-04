// The watch view: one film, its player, its details, its comments.
//
// The player is a plain DOM widget (js/lib/EpixPlayer.js), so it is mounted
// once into a maquette-owned node and then left alone - re-rendering the page
// around it must never rebuild the <video>, or playback would restart on every
// like. afterCreate mounts it; setVideo tears the old one down.

(function () {
  class Watch {
    constructor() {
      this.video_id = null;
      this.video = null;
      this.player = null;
      this.loaded = false;
      this.missing = false;
      this.submitting_like = false;
      this.sharing = false;
      this.copied = false;
      this.siblings = [];        // episodes of this film's series, in order
      this.rating_hover = 0;
      this.submitting_rating = false;
      this.comments = new Comments();
      this.handleLike = this.handleLike.bind(this);
      this.handleShare = this.handleShare.bind(this);
      this.handleCopy = this.handleCopy.bind(this);
      this.handleCloseShare = this.handleCloseShare.bind(this);
      this.mountShareInput = this.mountShareInput.bind(this);
      this.handleSelectLink = this.handleSelectLink.bind(this);
      this.handleRate = this.handleRate.bind(this);
      this.handleRateHover = this.handleRateHover.bind(this);
      this.handleRateOut = this.handleRateOut.bind(this);
      this.mountPlayer = this.mountPlayer.bind(this);
      this.render = this.render.bind(this);
    }

    setVideo(video_id) {
      if (this.video_id === video_id) return false;
      this.destroyPlayer();
      this.video_id = video_id;
      this.video = null;
      this.loaded = false;
      this.missing = false;
      this.comments.setVideo(video_id);
      this.update();
      return true;
    }

    destroyPlayer() {
      if (this.player) {
        this.player.destroy();
        this.player = null;
      }
      this.mounted_for = null;
    }

    update(cb) {
      if (!this.video_id) return;
      var query = `
        SELECT video.*,
         (SELECT COUNT(*) FROM video_like WHERE video_like.key = video.video_id) AS likes,
         (SELECT COUNT(*) FROM comment WHERE comment.video_id = video.video_id) AS comments,
         (SELECT AVG(stars) FROM rating WHERE rating.key = video.video_id) AS stars,
         (SELECT COUNT(*) FROM rating WHERE rating.key = video.video_id) AS votes
        FROM video WHERE video.video_id = :video_id
      `;
      Page.cmd("dbQuery", [query, { video_id: this.video_id }], (res) => {
        var rows = Page.rows(res);
        if (rows.length) {
          this.video = new Video(rows[0]);
          if (Page.shell) Page.shell.title = this.video.title;
          // The film's media lives in its category's catalogue file; fetch it
          // before the player mounts, then repaint.
          Page.loadCategory(this.video.category, () => {
            this.loaded = true;
            Page.projector.scheduleRender();
          });
          this.loadSiblings();
        } else {
          this.missing = true;
          this.loaded = true;
        }
        Page.projector.scheduleRender();
        if (cb) cb();
      });
      this.comments.update();
    }

    // The other episodes of this film's series, so the page can offer the next
    // one without making the viewer go back to the series.
    loadSiblings() {
      if (!this.video || !this.video.series_id) { this.siblings = []; return; }
      Page.cmd("dbQuery", [`
        SELECT video_id, title, episode FROM video
        WHERE series_id = :sid
        ORDER BY (episode IS NULL), episode, title COLLATE NOCASE
      `, { sid: this.video.series_id }], (res) => {
        this.siblings = Page.rows(res);
        Page.projector.scheduleRender();
      });
    }

    episodeIndex() {
      if (!this.video) return -1;
      return this.siblings.findIndex((r) => r.video_id === this.video.video_id);
    }

    handleRate(e) {
      var n = parseInt(e.currentTarget.getAttribute("data-star"), 10) || 0;
      if (!Page.user.canWrite()) return Page.requireXid();
      if (this.submitting_rating) return false;
      this.submitting_rating = true;
      var mine = Page.user.ratings[this.video_id];
      var done = () => {
        this.submitting_rating = false;
        this.update();
      };
      // Clicking the star you already gave clears the rating.
      if (mine === n) Page.user.unrate(this.video_id, done);
      else Page.user.rate(this.video_id, n, done);
      Page.projector.scheduleRender();
      return false;
    }

    handleRateHover(e) {
      this.rating_hover = parseInt(e.currentTarget.getAttribute("data-star"), 10) || 0;
      Page.projector.scheduleRender();
    }

    handleRateOut() {
      this.rating_hover = 0;
      Page.projector.scheduleRender();
    }

    renderRating() {
      var mine = Page.user.ratings[this.video_id] || 0;
      var show = this.rating_hover || mine;
      var v = this.video;
      return h("div.rate", { key: "rate" }, [
        h("div.rate-stars", { onmouseout: this.handleRateOut },
          [1, 2, 3, 4, 5].map((n) => {
            return h("button.rate-star", {
              key: "r" + n,
              "data-star": String(n),
              classes: { on: show >= n, mine: mine >= n && !this.rating_hover },
              onclick: this.handleRate,
              onmouseover: this.handleRateHover,
              title: mine === n ? _("Clear your rating") : _("Rate {0}").replace("{0}", n),
              disabled: this.submitting_rating
            }, [h("i.star")]);
          })),
        h("div.rate-meta", v.votes
          ? _("{0} from {1} ratings").replace("{0}", v.stars).replace("{1}", v.votes)
          : _("No ratings yet"))
      ]);
    }

    renderEpisodeNav() {
      var v = this.video;
      if (!v || !v.series_id || this.siblings.length < 2) return null;
      var i = this.episodeIndex();
      var prev = i > 0 ? this.siblings[i - 1] : null;
      var next = i >= 0 && i < this.siblings.length - 1 ? this.siblings[i + 1] : null;
      return h("div.epnav", { key: "epnav" }, [
        h("a.epnav-series", {
          href: "?Series/" + v.series_id,
          onclick: Page.handleLinkClick
        }, [
          h("span.epnav-label", v.episode
            ? _("Episode {0} of {1}").replace("{0}", v.episode).replace("{1}", this.siblings.length)
            : _("{0} of {1}").replace("{0}", i + 1).replace("{1}", this.siblings.length)),
          h("span.epnav-name", v.series)
        ]),
        h("div.epnav-links", [
          prev
            ? h("a.btn.btn-ghost", {
                href: "?Watch/" + prev.video_id, onclick: Page.handleLinkClick,
                title: prev.title
              }, _("Previous"))
            : null,
          next
            ? h("a.btn.btn-ghost", {
                href: "?Watch/" + next.video_id, onclick: Page.handleLinkClick,
                title: next.title
              }, _("Next episode"))
            : null
        ].filter(Boolean))
      ]);
    }

    mountPlayer(el) {
      if (!this.video) return;
      // One mount per film; maquette may call afterCreate again on re-key.
      if (this.mounted_for === this.video_id && this.player) return;
      this.destroyPlayer();
      var media = this.video.getMedia();
      if (!media.sources.length) return;
      this.mounted_for = this.video_id;
      this.player = new EpixPlayer(el, {
        key: this.video_id,
        sources: media.sources,
        captions: media.captions,
        poster: media.poster,
        onStats: (cb) => Page.videoStats(this.video_id, cb)
      });
    }

    handleLike() {
      if (!Page.user.canWrite()) return Page.requireXid();
      if (this.submitting_like) return false;
      var liked = !!Page.user.likes[this.video_id];
      this.submitting_like = true;
      if (this.video) this.video.likes += liked ? -1 : 1;
      Page.projector.scheduleRender();
      var done = () => {
        this.submitting_like = false;
        this.update();
      };
      if (liked) Page.user.unlikeVideo(this.video_id, done);
      else Page.user.likeVideo(this.video_id, done);
      return false;
    }

    handleShare() {
      this.sharing = !this.sharing;
      this.copied = false;
      Page.projector.scheduleRender();
      return false;
    }

    handleCloseShare() {
      this.sharing = false;
      Page.projector.scheduleRender();
      return false;
    }

    // Select the link on open so it can be copied by hand if the clipboard
    // API is unavailable - the page runs in a sandboxed frame, where the
    // browser may refuse clipboard access.
    mountShareInput(el) {
      this.share_input = el;
      setTimeout(function () {
        el.focus();
        el.setSelectionRange(0, el.value.length);
      }, 0);
    }

    handleSelectLink(e) {
      e.target.setSelectionRange(0, e.target.value.length);
    }

    handleCopy() {
      var link = Page.shareLink(this.video_id);
      var done = (ok) => {
        this.copied = ok ? "yes" : "manual";
        Page.projector.scheduleRender();
        setTimeout(() => { this.copied = false; Page.projector.scheduleRender(); }, 2500);
      };
      if (this.share_input) {
        this.share_input.focus();
        this.share_input.setSelectionRange(0, this.share_input.value.length);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () { done(true); },
                                                 function () { done(false); });
      } else {
        done(false);
      }
      return false;
    }

    renderShare() {
      var link = Page.shareLink(this.video_id);
      var label = this.copied === "yes" ? _("Copied")
        : (this.copied === "manual" ? _("Press Ctrl+C") : _("Copy"));
      return h("div.share-pop", { key: "share" }, [
        h("div.share-head", [
          h("span.share-title", _("Share this film")),
          h("button.share-x", {
            type: "button", onclick: this.handleCloseShare, "aria-label": _("Close")
          }, "\u00d7")
        ]),
        h("div.share-row", [
          h("input.share-link", {
            type: "text",
            readOnly: "readonly",
            value: link,
            afterCreate: this.mountShareInput,
            onclick: this.handleSelectLink
          }),
          h("button.btn.btn-primary.share-copy", {
            type: "button",
            onclick: this.handleCopy,
            classes: { done: this.copied === "yes" }
          }, label)
        ]),
        h("p.share-note", _("Anyone running EpixNet can open this link."))
      ]);
    }

    renderMissing() {
      return h("div.watch-missing", { key: "missing" }, [
        h("h1", _("Film not found")),
        h("p", _("This link points at a film that is not in the library.")),
        h("a.btn.btn-primary", { href: "?", onclick: Page.handleLinkClick }, _("Back to the library"))
      ]);
    }

    render() {
      if (this.missing) return this.renderMissing();
      if (!this.loaded || !this.video) {
        return h("div.watch-loading", { key: "loading" }, _("Loading..."));
      }
      var v = this.video;
      var liked = !!Page.user.likes[v.video_id];
      var media = v.getMedia();
      return h("div.watch", { key: "watch-" + v.video_id }, [
        media.sources.length
          ? h("div.watch-player", {
              key: "player-" + v.video_id,
              afterCreate: this.mountPlayer
            })
          : h("div.watch-player.watch-player-missing", { key: "noplayer" },
              _("No playable source is listed for this film.")),
        h("div.watch-body", [
          h("h1.watch-title", v.title),
          h("div.watch-bar", [
            h("div.watch-facts", [
              v.year ? h("span.watch-fact", String(v.year)) : null,
              v.duration ? h("span.watch-fact", v.formatDuration()) : null,
              v.size ? h("span.watch-fact", v.formatSize()) : null,
              h("span.watch-fact", { title: Time.date(v.date_added, "long") },
                _("Added {0}").replace("{0}", Time.since(v.date_added)))
            ].filter(Boolean)),
            h("div.watch-actions", [
              h("button.btn.watch-like", {
                classes: { active: liked, loading: this.submitting_like },
                onclick: this.handleLike,
                title: liked ? _("Remove like") : _("Like")
              }, [h("span.icon-heart"), " " + v.likes]),
              h("div.share-wrap", [
                h("button.btn.btn-ghost", {
                  onclick: this.handleShare,
                  classes: { active: this.sharing },
                  "aria-expanded": this.sharing ? "true" : "false"
                }, _("Share")),
                this.sharing ? this.renderShare() : null
              ])
            ])
          ]),
          this.renderEpisodeNav(),
          this.renderRating(),
          v.description
            ? h("div.watch-desc", { innerHTML: Text.renderMarked(v.description) })
            : null,
          v.studio || v.license || v.source
            ? h("div.watch-credits", [
                v.studio ? h("span.watch-credit", v.studio) : null,
                v.license ? h("span.watch-credit.watch-license", v.license) : null,
                v.source
                  ? h("a.watch-credit.watch-source", {
                      href: v.source, target: "_blank", rel: "noopener noreferrer"
                    }, _("Source"))
                  : null
              ].filter(Boolean))
            : null
        ]),
        this.comments.render()
      ]);
    }
  }

  Object.assign(Watch.prototype, LogMixin);

  window.Watch = Watch;
}).call(this);
