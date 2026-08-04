// The chrome around every view: brand, back link, and the viewer's identity.

(function () {
  class Shell {
    constructor() {
      this.title = null;   // set by the active view; null on the library
      this.handleCert = this.handleCert.bind(this);
      this.render = this.render.bind(this);
    }

    handleCert() {
      if (Page.user.canWrite()) Page.user.selectCert();
      else Page.requireXid();
      return false;
    }

    renderIdentity() {
      var user = Page.user;
      if (user.canWrite()) {
        var name = (user.cert || "").split("@")[0];
        return h("button.shell-id.shell-id-in", {
          onclick: this.handleCert,
          title: user.cert
        }, [
          User.renderAvatar(user.userDir(), "shell-avatar"),
          h("span.shell-name", name)
        ]);
      }
      return h("button.shell-id", { onclick: this.handleCert }, _("Sign in"));
    }

    render(content) {
      var on_watch = !!this.title;
      return h("div.shell", [
        h("header.shell-head", [
          h("a.shell-brand", { href: "?", onclick: Page.handleLinkClick }, [
            h("img.shell-logo", { src: "img/logo.svg", alt: "" }),
            h("span.shell-brand-name", "DeFlix")
          ]),
          on_watch
            ? h("a.shell-back", { href: "?", onclick: Page.handleLinkClick }, _("Library"))
            : null,
          h("div.shell-spacer"),
          this.renderIdentity()
        ].filter(Boolean)),
        h("main.shell-main", { id: "Content" }, content),
        h("footer.shell-foot", [
          h("span.shell-foot-text", _("Served peer to peer on EpixNet.")),
          h("a.shell-foot-link", {
            href: "?", onclick: Page.handleLinkClick
          }, _("Library"))
        ])
      ]);
    }
  }

  Object.assign(Shell.prototype, LogMixin);

  window.Shell = Shell;
}).call(this);
