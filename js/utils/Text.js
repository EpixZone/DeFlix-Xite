(function() {
  class MarkedRenderer extends marked.Renderer {
    image(href, title, text) {
      return "<code>![" + text + "](" + href + ")</code>";
    }
  }

  class Text {
    constructor() {
      this.renderMarked = this.renderMarked.bind(this);
      this.renderLinks = this.renderLinks.bind(this);
    }

    toColor(text, saturation, lightness) {
      if (saturation == null) saturation = 30;
      if (lightness == null) lightness = 50;
      var hash = 0;
      for (var i = 0; i < text.length; i++) {
        hash += text.charCodeAt(i) * i;
        hash = hash % 1777;
      }
      var ref1, ref2;
      if ((ref1 = Page.server_info) != null && (ref2 = ref1.user_settings) != null && ref2.theme === "dark") {
        return "hsl(" + (hash % 360) + "," + (saturation + 5) + "%," + (lightness + 15) + "%)";
      } else {
        return "hsl(" + (hash % 360) + "," + saturation + "%," + lightness + "%)";
      }
    }

    renderMarked(text, options) {
      if (options == null) options = {};
      if (!text) return "";
      options["gfm"] = true;
      options["breaks"] = true;
      options["sanitize"] = true;
      options["renderer"] = marked_renderer;
      text = this.fixReply(text);
      text = text.replace(/((?<=\s|^)http[s]?:\/\/.*?)(?=\s|$)/g, '<$1>');
      text = marked(text, options);
      text = text.replace(/<a href="mailto:[^\"]+\">(.*?)<\/a>/g, '$1');
      text = text.replace(/(\s|>|^)(@[^\s]{1,50}):/g, '$1<b class="reply-name">$2</b>:');
      text = text.replace(/(https?:\/\/)%5B(.*?)%5D/g, '$1[$2]');
      return this.fixHtmlLinks(text);
    }

    renderLinks(text) {
      text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      text = text.replace(/(https?:\/\/[^\s)]+)/g, function(match) {
        return "<a href=\"" + match.replace(/&amp;/g, '&') + "\">" + match + "</a>";
      });
      text = text.replace(/\n/g, '<br>');
      text = text.replace(/(\s|>|^)(@[^\s]{1,50}):/g, '$1<b class="reply-name">$2</b>:');
      text = this.fixHtmlLinks(text);
      return text;
    }

    emailLinks(text) {
      return text.replace(/([a-zA-Z0-9]+)@([a-zA-Z0-9.]+)/g, "<a href='?to=$1' onclick='return Page.message_create.show(\"$1\")'>$1@$2</a>");
    }

    fixHtmlLinks(text) {
      if (window.is_proxy) {
        text = text.replace(/href="\/([A-Za-z0-9]{26,35})/g, 'href="http://epix/$1');
        text = text.replace(/http:\/\/epix\/([^\/]+\.epix)/, "http://$1");
      }
      text = text.replace(/href="\?/g, 'onclick="return Page.handleLinkClick(window.event)" href="?');
      return text;
    }

    fixLink(link) {
      if (window.is_proxy) {
        var back = link.replace(/\/([A-Za-z0-9]{26,35})/, "http://epix/$1");
        back = back.replace(/http:\/\/epix\/([^\/]+\.epix)/, "http://$1");
        return back;
      } else {
        return link;
      }
    }

    toUrl(text) {
      return text.replace(/[^A-Za-z0-9]/g, "+").replace(/[+]+/g, "+").replace(/[+]+$/, "");
    }

    getSiteUrl(address) {
      if (window.is_proxy) {
        if (address.indexOf(".") >= 0) {
          return "http://" + address + "/";
        } else {
          return "http://epix/" + address + "/";
        }
      } else {
        return "/" + address + "/";
      }
    }

    fixReply(text) {
      return text.replace(/(>.*\n)([^\n>])/gm, "$1\n$2");
    }

    toEpixAddress(text) {
      return text.replace(/[^A-Za-z0-9.]/g, "");
    }

    formatUsername(username) {
      if (!username) return _("Anonymous");
      if (username.match(/^epix1[a-z0-9]{38,}$/)) {
        return username.substring(0, 16) + "...";
      }
      return username;
    }

    jsonEncode(obj) { return unescape(encodeURIComponent(JSON.stringify(obj))); }
    jsonDecode(obj) { return JSON.parse(decodeURIComponent(escape(obj))); }

    fileEncode(obj) {
      if (typeof obj === "string") {
        return btoa(unescape(encodeURIComponent(obj)));
      } else {
        return btoa(unescape(encodeURIComponent(JSON.stringify(obj, void 0, '\t'))));
      }
    }

    utf8Encode(s) { return unescape(encodeURIComponent(s)); }
    utf8Decode(s) { return decodeURIComponent(escape(s)); }

    distance(s1, s2) {
      s1 = s1.toLocaleLowerCase();
      s2 = s2.toLocaleLowerCase();
      var next_find_i = 0;
      var next_find = s2[0];
      var extra_parts = {};
      for (var j = 0; j < s1.length; j++) {
        var char = s1[j];
        if (char !== next_find) {
          if (extra_parts[next_find_i]) {
            extra_parts[next_find_i] += char;
          } else {
            extra_parts[next_find_i] = char;
          }
        } else {
          next_find_i++;
          next_find = s2[next_find_i];
        }
      }
      if (extra_parts[next_find_i]) extra_parts[next_find_i] = "";
      var parts = [];
      for (var key in extra_parts) { parts.push(extra_parts[key]); }
      if (next_find_i >= s2.length) {
        return parts.length + parts.join("").length;
      } else {
        return false;
      }
    }

    queryParse(query) {
      var params = {};
      var parts = query.split('&');
      for (var j = 0; j < parts.length; j++) {
        var part = parts[j];
        var ref = part.split("=");
        var key = ref[0], val = ref[1];
        if (val) {
          params[decodeURIComponent(key)] = decodeURIComponent(val);
        } else {
          params["url"] = decodeURIComponent(key);
          params["urls"] = params["url"].split("/");
        }
      }
      return params;
    }

    queryEncode(params) {
      var back = [];
      if (params.url) back.push(params.url);
      for (var key in params) {
        var val = params[key];
        if (!val || key === "url") continue;
        back.push(encodeURIComponent(key) + "=" + encodeURIComponent(val));
      }
      return back.join("&");
    }

    highlight(text, search) {
      var parts = text.split(RegExp(search, "i"));
      var back = [];
      for (var i = 0; i < parts.length; i++) {
        back.push(parts[i]);
        if (i < parts.length - 1) {
          back.push(h("span.highlight", { key: i }, search));
        }
      }
      return back;
    }

    sqlIn(values) {
      return "(" + values.map(function(v) { return "'" + v + "'"; }).join(',') + ")";
    }

    formatSize(size) {
      var size_mb = size / 1024 / 1024;
      if (size_mb >= 1000) return (size_mb / 1024).toFixed(1) + " GB";
      else if (size_mb >= 100) return size_mb.toFixed(0) + " MB";
      else if (size / 1024 >= 1000) return size_mb.toFixed(2) + " MB";
      else return (size / 1024).toFixed(2) + " KB";
    }
  }

  window.is_proxy = document.location.host === "epix" || window.location.pathname === "/";
  window.marked_renderer = new MarkedRenderer();
  window.Text = new Text();
})();
