// Vendored by xites. EpixNet owns the shared thumbnails; the original profile
// URL stays usable in standalone pages and on nodes without this command.
(function (root) {
  "use strict";
  var bindings = new WeakMap();
  var requests = new WeakMap();

  function eligible(source, size) {
    if (typeof source !== "string" || source.length > 2048 || !Number.isInteger(size) || size < 1 || size > 128) return false;
    try {
      var url = new URL(source);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password;
    } catch (_) { return false; }
  }

  function displayUrl(source, size) {
    if (!eligible(source, size)) return source;
    var url = new URL(source);
    if (!/(^|\.)gravatar\.com$/i.test(url.hostname) ||
        !/^\/avatar\/(?:[a-f\d]{32}|[a-f\d]{64})(?:\.jpg)?\/?$/i.test(url.pathname)) return source;
    url.searchParams.delete("size");
    url.searchParams.set("s", String(size));
    return url.href;
  }

  function get(source, size, frame) {
    frame = frame || root.Page;
    if (root.parent === root || !eligible(source, size) || !frame || typeof frame.cmd !== "function") return Promise.resolve(null);
    var pending = requests.get(frame);
    if (!pending) { pending = new Map(); requests.set(frame, pending); }
    var key = JSON.stringify([source, size]);
    if (pending.has(key)) return pending.get(key);
    var request = new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(null); }, 16000);
      function reply(value) {
        clearTimeout(timer);
        var png = value && value.thumbnail;
        resolve(typeof png === "string" && png.length <= 100000 &&
          /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(png) ? png : null);
      }
      try {
        var result = frame.cmd("wrapperGetAvatarThumbnail", {url: source, size: size}, reply);
        if (result && typeof result.then === "function") result.then(reply, function () { reply(null); });
      } catch (_) { reply(null); }
    }).finally(function () { pending.delete(key); });
    pending.set(key, request);
    return request;
  }

  function paint(element, source, background) {
    if (background) {
      // Serialize a single CSS string even for legacy relative URLs.
      var escaped = source.replace(/["\\\x00-\x1f\x7f]/g, function (ch) {
        return "\\" + ch.charCodeAt(0).toString(16) + " ";
      });
      element.style.backgroundImage = source ? 'url("' + escaped + '")' : "";
    } else if (source) {
      element.setAttribute("referrerpolicy", "no-referrer");
      element.setAttribute("src", source);
    } else {
      element.removeAttribute("src");
    }
  }

  function bind(element, source, size, options) {
    source = typeof source === "string" ? source : "";
    var background = !!(options && options.background);
    var previous = bindings.get(element);
    if (previous && previous.source === source && previous.size === size && previous.background === background) return previous.done;
    var current = {source: source, size: size, background: background};
    bindings.set(element, current);
    if (previous || !source) paint(element, "", previous ? previous.background : background);
    if (!source) { current.done = Promise.resolve(); return current.done; }
    current.done = get(source, size, options && options.frame).then(function (thumbnail) {
      if (bindings.get(element) === current) paint(element, thumbnail || displayUrl(source, size), background);
    });
    return current.done;
  }

  root.EpixAvatar = {get: get, bind: bind};
})(window);
