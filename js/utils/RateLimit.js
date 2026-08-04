(function() {

  var call_after_interval = {};

  window.RateLimitCb = function(interval, fn, args) {
    if (args == null) args = [];
    if (!call_after_interval[fn]) {
      call_after_interval[fn] = true;
      fn.apply(this, args);
      return setTimeout(function() {
        if (call_after_interval[fn] === "again") {
          fn.apply(this, args);
        }
        return delete call_after_interval[fn];
      }, interval);
    } else {
      return call_after_interval[fn] = "again";
    }
  };

  window.RateLimit = function(interval, fn) {
    if (!call_after_interval[fn]) {
      call_after_interval[fn] = true;
      return setTimeout(function() {
        delete call_after_interval[fn];
        return fn();
      }, interval);
    }
  };

})();
