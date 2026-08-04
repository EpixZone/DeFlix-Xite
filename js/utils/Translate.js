(function() {

  var translations = {};

  window.loadLanguage = function(lang, cb) {
    if (!lang || lang === "en") {
      if (cb) cb();
      return;
    }
    return Page.cmd("fileGet", {
      "inner_path": "languages/" + lang + ".json",
      "required": false
    }, function(data) {
      if (data) {
        try {
          translations = JSON.parse(data);
        } catch (e) {
          translations = {};
        }
      } else {
        translations = {};
      }
      if (cb) cb();
    });
  };

  window._ = function(s) {
    if (translations && translations[s]) {
      return translations[s];
    }
    return s;
  };

  window.translateDOM = function() {};

})();
