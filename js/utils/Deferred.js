(function() {

  function Deferred() {
    this.resolved = false;
    this.callbacks = [];
    this.result = null;
  }

  Deferred.prototype.resolve = function() {
    this.resolved = true;
    this.result = arguments;
    for (var i = 0; i < this.callbacks.length; i++) {
      this.callbacks[i].apply(this, this.result);
    }
    this.callbacks = [];
  };

  Deferred.prototype.then = function(cb) {
    if (this.resolved) {
      cb.apply(this, this.result);
    } else {
      this.callbacks.push(cb);
    }
    return this;
  };

  Deferred.join = function() {
    var deferreds = Array.prototype.slice.call(arguments);
    var joined = new Deferred();
    var num_resolved = 0;
    if (deferreds.length === 0) {
      joined.resolve();
      return joined;
    }
    for (var i = 0; i < deferreds.length; i++) {
      deferreds[i].then(function() {
        num_resolved++;
        if (num_resolved >= deferreds.length) {
          joined.resolve();
        }
      });
    }
    return joined;
  };

  window.Deferred = Deferred;

})();
