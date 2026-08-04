// Threaded comments under a film: replies to replies, likes on any of them.
//
// The DB returns one flat list; we build the tree here by reply_to, which holds
// the parent's comment_uri ("<comment_id>_<directory>"). A reply whose parent
// has not arrived yet is kept and shown at the top level rather than dropped,
// so a partially synced thread never hides anyone's words.

(function () {
  class Comments {
    constructor() {
      this.video_id = null;
      this.rows = [];
      this.tree = [];
      this.total = 0;
      this.loaded = false;
      this.sort = "top";
      this.reply_to = null;      // comment_uri being replied to
      this.draft = "";
      this.reply_draft = "";
      this.submitting = false;
      this.collapsed = {};       // comment_uri -> true
      this.handleSort = this.handleSort.bind(this);
      this.handleDraft = this.handleDraft.bind(this);
      this.handleReplyTo = this.handleReplyTo.bind(this);
      this.handleCancelReply = this.handleCancelReply.bind(this);
      this.handleSubmit = this.handleSubmit.bind(this);
      this.handleLike = this.handleLike.bind(this);
      this.handleDelete = this.handleDelete.bind(this);
      this.handleCollapse = this.handleCollapse.bind(this);
      this.handleSelectCert = this.handleSelectCert.bind(this);
      this.handleOpenXid = this.handleOpenXid.bind(this);
      this.mountInput = this.mountInput.bind(this);
      this.render = this.render.bind(this);
    }

    setVideo(video_id) {
      if (this.video_id === video_id) return false;
      this.video_id = video_id;
      this.rows = [];
      this.tree = [];
      this.loaded = false;
      this.reply_to = null;
      this.draft = "";
      return true;
    }

    update(cb) {
      if (!this.video_id) return;
      var query = `
        SELECT comment.comment_id, comment.body, comment.date_added, comment.reply_to,
         json.directory AS directory,
         comment.comment_id || '_' || json.directory AS comment_uri,
         (SELECT COUNT(*) FROM comment_like
           WHERE comment_like.key = comment.comment_id || '_' || json.directory) AS likes
        FROM comment
        LEFT JOIN json USING (json_id)
        WHERE comment.video_id = :video_id
        ORDER BY comment.date_added ASC
      `;
      Page.cmd("dbQuery", [query, { video_id: this.video_id }], (res) => {
        var rows = Page.rows(res);
        this.rows = rows || [];
        this.total = this.rows.length;
        this.tree = this.buildTree(this.rows);
        this.loaded = true;
        Page.projector.scheduleRender();
        // Avatars arrive after the words: resolve the authors we have not seen
        // before and repaint only if something new came back.
        Page.resolveXids(this.rows.map((r) => r.directory), (found) => {
          if (found) Page.projector.scheduleRender();
        });
        if (cb) cb();
      });
    }

    buildTree(rows) {
      var byUri = {};
      rows.forEach((r) => {
        r.children = [];
        byUri[r.comment_uri] = r;
      });
      var roots = [];
      rows.forEach((r) => {
        var parent = r.reply_to ? byUri[r.reply_to] : null;
        if (parent && parent !== r) parent.children.push(r);
        else roots.push(r);  // top level, or an orphan whose parent has not synced
      });
      var sortFn = this.sort === "new"
        ? (a, b) => b.date_added - a.date_added
        : (a, b) => (b.likes - a.likes) || (b.date_added - a.date_added);
      roots.sort(sortFn);
      // Replies always read oldest first, like a conversation.
      var sortKids = (node) => {
        node.children.sort((a, b) => a.date_added - b.date_added);
        node.children.forEach(sortKids);
      };
      roots.forEach(sortKids);
      return roots;
    }

    countAll(node) {
      return node.children.reduce((n, c) => n + this.countAll(c), node.children.length);
    }

    // --- actions ---------------------------------------------------------

    handleSort(e) {
      this.sort = e.currentTarget.getAttribute("data-sort");
      this.tree = this.buildTree(this.rows);
      Page.projector.scheduleRender();
      return false;
    }

    handleDraft(e) {
      if (this.reply_to) this.reply_draft = e.target.value;
      else this.draft = e.target.value;
      this.grow(e.target);
    }

    handleReplyTo(e) {
      var uri = e.currentTarget.getAttribute("data-uri");
      this.reply_to = this.reply_to === uri ? null : uri;
      this.reply_draft = "";
      Page.projector.scheduleRender();
      return false;
    }

    handleCancelReply() {
      this.reply_to = null;
      this.reply_draft = "";
      Page.projector.scheduleRender();
      return false;
    }

    handleSubmit() {
      var body = (this.reply_to ? this.reply_draft : this.draft).trim();
      if (!body || this.submitting) return false;
      if (!Page.user.canWrite()) return Page.requireXid();
      this.submitting = true;
      Page.projector.scheduleRender();
      Page.user.comment(this.video_id, body, this.reply_to, (ok) => {
        this.submitting = false;
        if (ok) {
          this.draft = "";
          this.reply_draft = "";
          this.reply_to = null;
          this.update();
        }
        Page.projector.scheduleRender();
      });
      return false;
    }

    handleLike(e) {
      var uri = e.currentTarget.getAttribute("data-uri");
      if (!Page.user.canWrite()) return Page.requireXid();
      var liked = Page.user.comment_likes[uri];
      // Optimistic: flip the local count so the button responds at once, then
      // re-read from the DB once the record is signed and merged.
      var row = this.rows.find((r) => r.comment_uri === uri);
      if (row) row.likes += liked ? -1 : 1;
      Page.projector.scheduleRender();
      var done = () => this.update();
      if (liked) Page.user.unlikeComment(uri, done);
      else Page.user.likeComment(uri, done);
      return false;
    }

    handleDelete(e) {
      var id = parseInt(e.currentTarget.getAttribute("data-id"), 10);
      if (!window.confirm(_("Delete this comment?"))) return false;
      Page.user.deleteComment(id, () => this.update());
      return false;
    }

    handleCollapse(e) {
      var uri = e.currentTarget.getAttribute("data-uri");
      if (this.collapsed[uri]) delete this.collapsed[uri];
      else this.collapsed[uri] = true;
      Page.projector.scheduleRender();
      return false;
    }

    handleSelectCert() {
      Page.user.selectCert();
      return false;
    }

    handleOpenXid() {
      Page.user.openXid();
      return false;
    }

    // A reply box opens focused; the root box must not steal focus on every
    // render, so only a box inside a comment (a reply) gets it.
    mountInput(el) {
      this.grow(el);
      if (el.closest(".comment")) el.focus();
    }

    // Grow the box with its content. Done by hand rather than with the shared
    // Autosize helper, which pulls in the anime.js dependency this xite does
    // not otherwise need.
    grow(el) {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 320) + "px";
    }

    // --- rendering -------------------------------------------------------

    renderComposer(placeholder, value, key) {
      if (!Page.user.canWrite()) {
        return h("div.comment-gate", { key: key + "-gate" }, [
          h("p.comment-gate-text", _("You need a xID to join the conversation.")),
          h("div.comment-gate-actions", [
            h("button.btn.btn-primary", { onclick: this.handleSelectCert }, _("Select xID")),
            h("a.link.comment-gate-link", {
              href: "#", onclick: this.handleOpenXid
            }, _("Get a xID"))
          ])
        ]);
      }
      return h("div.comment-composer", { key: key }, [
        h("textarea.comment-input", {
          placeholder: placeholder,
          value: value,
          rows: "2",
          oninput: this.handleDraft,
          afterCreate: this.mountInput,
          disabled: this.submitting
        }),
        h("div.comment-actions", [
          this.reply_to && key !== "root"
            ? h("button.btn.btn-ghost", { onclick: this.handleCancelReply }, _("Cancel"))
            : null,
          h("button.btn.btn-primary", {
            onclick: this.handleSubmit,
            disabled: this.submitting || !value.trim()
          }, this.submitting ? _("Posting...") : _("Comment"))
        ].filter(Boolean))
      ]);
    }

    renderComment(row, depth) {
      var mine = Page.user.canWrite() && row.directory === Page.user.dbDirectory();
      var liked = !!Page.user.comment_likes[row.comment_uri];
      var kids = this.countAll(row);
      var folded = this.collapsed[row.comment_uri];
      // Past a few levels the indent would squeeze the text on a phone, so
      // deeper replies keep the thread line but stop stepping right.
      var indent = Math.min(depth, 4);
      return h("div.comment", {
        key: row.comment_uri,
        classes: { "comment-reply": depth > 0, "comment-mine": mine },
        styles: { "margin-left": indent > 0 ? (indent * 20) + "px" : "0" }
      }, [
        h("div.comment-head", [
          User.renderAvatar(row.directory, "comment-author"),
          h("span.comment-name", User.displayName(row.directory)),
          h("span.comment-time", { title: Time.date(row.date_added, "long") },
            Time.since(row.date_added)),
          kids > 0
            ? h("button.comment-fold", {
                "data-uri": row.comment_uri,
                onclick: this.handleCollapse,
                title: folded ? _("Show replies") : _("Hide replies")
              }, folded ? "+" + kids : "-")
            : null
        ].filter(Boolean)),
        h("div.comment-body", { innerHTML: Text.renderMarked(row.body || "") }),
        h("div.comment-foot", [
          h("button.comment-like", {
            "data-uri": row.comment_uri,
            classes: { active: liked },
            onclick: this.handleLike,
            title: liked ? _("Remove like") : _("Like")
          }, [h("span.icon-heart"), " " + (row.likes || 0)]),
          h("button.comment-reply-btn", {
            "data-uri": row.comment_uri,
            onclick: this.handleReplyTo
          }, _("Reply")),
          mine
            ? h("button.comment-delete", {
                "data-id": String(row.comment_id),
                onclick: this.handleDelete
              }, _("Delete"))
            : null
        ].filter(Boolean)),
        this.reply_to === row.comment_uri
          ? this.renderComposer(_("Write a reply"), this.reply_draft, row.comment_uri)
          : null,
        folded ? null : h("div.comment-children",
          row.children.map((child) => this.renderComment(child, depth + 1)))
      ]);
    }

    render() {
      return h("section.comments", { key: "comments" }, [
        h("div.comments-head", [
          h("h2.comments-title", this.total === 1
            ? _("1 comment")
            : _("{0} comments").replace("{0}", this.total)),
          this.total > 1 ? h("div.comments-sorts", [
            h("button.comments-sort", {
              "data-sort": "top",
              classes: { active: this.sort === "top" },
              onclick: this.handleSort
            }, _("Top")),
            h("button.comments-sort", {
              "data-sort": "new",
              classes: { active: this.sort === "new" },
              onclick: this.handleSort
            }, _("Newest"))
          ]) : null
        ].filter(Boolean)),
        this.reply_to ? null : this.renderComposer(_("Add a comment"), this.draft, "root"),
        h("div.comment-list", this.tree.map((row) => this.renderComment(row, 0))),
        this.loaded && this.total === 0
          ? h("p.comments-empty", _("No comments yet. Be the first."))
          : null
      ]);
    }
  }

  Object.assign(Comments.prototype, LogMixin);

  window.Comments = Comments;
}).call(this);
