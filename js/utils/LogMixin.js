// LogMixin - shared logging for classes that don't extend EpixFrame
// Usage: Object.assign(MyClass.prototype, LogMixin);

var LogMixin = {
  log: function() {
    var args = ['[' + this.constructor.name + ']'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  },
  logStart: function(name) {
    if (!this._logTimers) this._logTimers = {};
    this._logTimers[name] = Date.now();
  },
  logEnd: function(name) {
    var ms = Date.now() - ((this._logTimers && this._logTimers[name]) || 0);
    this.log(name, '(Done in ' + ms + 'ms)');
  }
};
