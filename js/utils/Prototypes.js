(function() {

  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(s) {
      return this.slice(0, s.length) === s;
    };
  }

  if (!String.prototype.endsWith) {
    String.prototype.endsWith = function(s) {
      return s === '' || this.slice(-s.length) === s;
    };
  }

  if (!String.prototype.repeat) {
    String.prototype.repeat = function(count) {
      return new Array(count + 1).join(this);
    };
  }

  window.isEmpty = function(obj) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) return false;
    }
    return true;
  };

})();
