// The signed-in viewer: their xID cert, their likes, and every write path.
//
// Comments and likes are individually signed CRDT records (epix-orset-1), one
// merge file per collection under the user's own directory:
//   comments.json       - comments and replies -> comment table
//   video_likes.json    - video like toggles   -> video_like table
//   comment_likes.json  - comment like toggles -> comment_like table
//
// The node signs each record (recordSign fills author/post_id/sign) and
// UNION-merges it into the on-disk set, so one write can never clobber another
// author's records and a stale publish merges to a no-op. Likes are key-based
// records: the node derives a stable per-(author,key) id, so re-toggling
// supersedes the previous record rather than piling up rows.

(function () {
  class User {
    constructor() {
      this.cert = null;          // "name@xid.epix"
      this.cert_is_xid = false;
      this.likes = {};           // video_id -> true
      this.comment_likes = {};   // comment_uri -> true
      this.ratings = {};         // video_id -> stars 1..5
      this.loaded = new Deferred();
    }

    // Called on every siteInfo: cert changes must invalidate what we cached.
    update(site_info) {
      var cert = site_info.cert_user_id || null;
      var changed = cert !== this.cert;
      this.cert = cert;
      // Live certs read "name@xid.epix"; older ones "name@xid".
      this.cert_is_xid = cert ? /@xid(\.epix)?$/.test(cert) : false;
      this.auth_address = site_info.auth_address;
      this.xid_directory = site_info.xid_directory;
      if (changed) {
        this.likes = {};
        this.comment_likes = {};
        this.ratings = {};
        if (this.cert_is_xid) this.loadMine();
      }
      if (!this.loaded.resolved) this.loaded.resolve();
      return changed;
    }

    // Can this viewer write? Anyone may watch; only a xID may like or comment.
    canWrite() {
      return this.cert_is_xid;
    }

    userDir() {
      return this.xid_directory || this.auth_address;
    }

    collectionPath(collection) {
      return "data/users/" + this.userDir() + "/" + collection + ".json";
    }

    contentPath() {
      return "data/users/" + this.userDir() + "/content.json";
    }

    // How the database names this user's directory. The db indexes paths
    // relative to the db file's folder (data/), so data/users/me.epix/... is
    // recorded as "users/me.epix", not "me.epix".
    dbDirectory() {
      return "users/" + this.userDir();
    }

    // The readable name behind either form of directory.
    static displayName(directory) {
      return User.displayDir(directory).replace(/\.epix$/, "");
    }

    // The xID directory ("name.epix") behind either form.
    static displayDir(directory) {
      return (directory || "").replace(/^users\//, "");
    }

    // One avatar element for a user directory. ALWAYS the same selector with
    // the letter class toggled and a stable key: a node whose selector flips
    // from span.avatar.letter to span.avatar when a profile lands mid-render
    // makes maquette throw on distinguishability and freezes the projector.
    static renderAvatar(directory, extra_class) {
      var dir = User.displayDir(directory);
      var url = Page.xidAvatar(dir);
      var name = User.displayName(directory);
      var attrs = {
        key: "av-" + dir,
        classes: { letter: !url },
        styles: url
          ? { "background-image": "url('" + url.replace(/'/g, "%27") + "')" }
          : { "background-color": Text.toColor(dir) }
      };
      return h("span.avatar" + (extra_class ? "." + extra_class : ""), attrs,
        url ? [] : [(name || "?").charAt(0).toUpperCase()]);
    }

    mergeCollections() {
      return ["comments", "video_likes", "comment_likes", "ratings"];
    }

    // 128-bit hex nonce: the entropy behind a record's derived id.
    randNonce() {
      var a = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(a);
      return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    getRecords(collection, cb) {
      Page.cmd("fileGet", { "inner_path": this.collectionPath(collection), "required": false }, (data) => {
        var container = null;
        try { container = data ? JSON.parse(data) : null; } catch (e) { container = null; }
        if (!container || !container.post) container = { "record_format": "epix-orset-1", "post": [] };
        cb(container);
      });
    }

    // Every declared merge file must exist before the first publish declares
    // them, or a file first seen later gets signed as a hashed whole-file
    // (last-writer-wins) entry instead of a merge file.
    ensureCollections(cb) {
      var pending = this.mergeCollections().slice();
      var next = () => {
        if (!pending.length) { if (cb) cb(); return; }
        var path = this.collectionPath(pending.shift());
        Page.cmd("fileGet", { "inner_path": path, "required": false }, (data) => {
          if (data != null) return next();
          var empty = { "record_format": "epix-orset-1", "post": [] };
          Page.cmd("fileWrite", [path, Text.fileEncode(empty)], () => next());
        });
      };
      next();
    }

    saveRecord(collection, record, cb) {
      var container = { "record_format": "epix-orset-1", "post": [record] };
      Page.cmd("fileWrite", [this.collectionPath(collection), Text.fileEncode(container)], (res_write) => {
        if (res_write !== "ok") {
          var msg = res_write && res_write.error ? res_write.error : res_write;
          Page.cmd("wrapperNotification", ["error", "Could not save: " + msg]);
          if (cb) cb(false);
          return;
        }
        this.ensureCollections(() => {
          Page.cmd("sitePublish", { "inner_path": this.contentPath() }, (res_pub) => {
            if (cb) cb(this.published(res_pub));
          });
        });
      });
    }

    // Was the record safely stored? By the time sitePublish replies, the node
    // has already signed the content.json, so the record is on disk and will
    // spread on the next sync. A "no peers right now" reply therefore still
    // counts as saved - treating it as a failure is what makes a comment look
    // lost when it is not. Only a real error (a bad signature, a rules
    // rejection) means the write did not take.
    published(res_pub) {
      if (res_pub === "ok" || res_pub === true) return true;
      var err = res_pub && res_pub.error ? String(res_pub.error) : "";
      return /peer|reachable|network|offline/i.test(err);
    }

    // A brand new item (a comment). The node derives its id from the nonce.
    createRecord(collection, fields, cb) {
      var record = {
        "nonce": this.randNonce(),
        "clock": Date.now(),
        "supersedes": 0,
        "deleted": false,
        "date_added": Time.timestamp()
      };
      for (var k in fields) if (fields[k] !== undefined) record[k] = fields[k];
      Page.cmd("recordSign", [record], (signed) => {
        if (!signed || signed.error) { if (cb) cb(false); return; }
        this.saveRecord(collection, signed, cb);
      });
    }

    // A key-based toggle (a like). Re-toggling supersedes the prior record for
    // the same key rather than appending a new one.
    editRecord(collection, key, fields, deleted, cb) {
      this.getRecords(collection, (container) => {
        var maxClock = 0, orig = null;
        container.post.forEach((r) => {
          if (r.key === key) {
            if (r.clock > maxClock) maxClock = r.clock;
            if (!orig || (r.clock || 0) >= (orig.clock || 0)) orig = r;
          }
        });
        var record = {
          "key": key,
          "nonce": orig && orig.nonce ? orig.nonce : this.randNonce(),
          "clock": Math.max(maxClock + 1, Date.now()),
          "supersedes": maxClock,
          "deleted": deleted === true,
          "date_added": orig ? orig.date_added : Time.timestamp()
        };
        if (deleted !== true) {
          for (var k in fields) if (fields[k] !== undefined) record[k] = fields[k];
        }
        Page.cmd("recordSign", [record], (signed) => {
          if (!signed || signed.error) { if (cb) cb(false); return; }
          this.saveRecord(collection, signed, cb);
        });
      });
    }

    // Edit or tombstone one of my own comments, carrying the immutable origin
    // (nonce/date_added) so the node re-derives the same id and supersedes.
    editRecordById(collection, id_field, id_value, changes, deleted, cb) {
      this.getRecords(collection, (container) => {
        var maxClock = 0, orig = null;
        container.post.forEach((r) => {
          if (r[id_field] === id_value) {
            if (r.clock > maxClock) maxClock = r.clock;
            if (!orig || (r.clock || 0) >= (orig.clock || 0)) orig = r;
          }
        });
        if (!orig) { if (cb) cb(false); return; }
        var record = {};
        var skip = { author: 1, sign: 1, clock: 1, supersedes: 1, deleted: 1, post_id: 1 };
        for (var k in orig) if (!skip[k]) record[k] = orig[k];
        record["clock"] = Math.max(maxClock + 1, Date.now());
        record["supersedes"] = maxClock;
        record["deleted"] = deleted === true;
        if (deleted === true) {
          record["body"] = "";
        } else {
          for (var c in changes) if (changes[c] !== undefined) record[c] = changes[c];
        }
        Page.cmd("recordSign", [record], (signed) => {
          if (!signed || signed.error) { if (cb) cb(false); return; }
          this.saveRecord(collection, signed, cb);
        });
      });
    }

    // --- app-level operations -------------------------------------------

    comment(video_id, body, reply_to, cb) {
      this.createRecord("comments", {
        "comment_id": Date.now(),
        "video_id": video_id,
        "reply_to": reply_to || null,
        "body": body
      }, cb);
    }

    deleteComment(comment_id, cb) {
      this.editRecordById("comments", "comment_id", comment_id, {}, true, cb);
    }

    likeVideo(video_id, cb) {
      this.likes[video_id] = true;
      this.editRecord("video_likes", video_id, {}, false, cb);
    }

    unlikeVideo(video_id, cb) {
      delete this.likes[video_id];
      this.editRecord("video_likes", video_id, {}, true, cb);
    }

    // A star rating is a key-based record like a like, but carrying a value,
    // so re-rating supersedes rather than stacking a second opinion.
    rate(video_id, stars, cb) {
      stars = Math.max(1, Math.min(5, parseInt(stars, 10) || 0));
      this.ratings[video_id] = stars;
      this.editRecord("ratings", video_id, { "stars": stars }, false, cb);
    }

    unrate(video_id, cb) {
      delete this.ratings[video_id];
      this.editRecord("ratings", video_id, {}, true, cb);
    }

    likeComment(comment_uri, cb) {
      this.comment_likes[comment_uri] = true;
      this.editRecord("comment_likes", comment_uri, {}, false, cb);
    }

    unlikeComment(comment_uri, cb) {
      delete this.comment_likes[comment_uri];
      this.editRecord("comment_likes", comment_uri, {}, true, cb);
    }

    // Load my own likes so the buttons render in the right state on first
    // paint. Read from the DB (folded, tombstones already dropped) rather than
    // the raw merge files.
    loadMine() {
      var dir = this.dbDirectory();
      Page.cmd("dbQuery", [
        "SELECT video_like.key AS k FROM video_like LEFT JOIN json USING (json_id) WHERE json.directory = :dir",
        { dir: dir }
      ], (rows) => {
        this.likes = {};
        (rows || []).forEach((r) => { this.likes[r.k] = true; });
        Page.projector.scheduleRender();
      });
      Page.cmd("dbQuery", [
        "SELECT comment_like.key AS k FROM comment_like LEFT JOIN json USING (json_id) WHERE json.directory = :dir",
        { dir: dir }
      ], (rows) => {
        this.comment_likes = {};
        (rows || []).forEach((r) => { this.comment_likes[r.k] = true; });
        Page.projector.scheduleRender();
      });
      Page.cmd("dbQuery", [
        "SELECT rating.key AS k, rating.stars AS s FROM rating LEFT JOIN json USING (json_id) WHERE json.directory = :dir",
        { dir: dir }
      ], (rows) => {
        this.ratings = {};
        (rows || []).forEach((r) => { this.ratings[r.k] = r.s; });
        Page.projector.scheduleRender();
      });
    }

    // Prompt for a xID cert. The wrapper shows the picker; the reply arrives as
    // a certChanged event, so the caller just re-renders on site_info.
    selectCert() {
      Page.cmd("certSelect", { "accepted_domains": ["xid.epix"], "accept_any": false });
    }

    openXid() {
      Page.cmd("wrapperOpenWindow", ["/" + Page.xid_site + "/"]);
    }
  }

  Object.assign(User.prototype, LogMixin);

  window.User = User;
}).call(this);
