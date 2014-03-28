require('apollojs');

var Fs = require('fs');
var Path = require('path');
var crc32 = require('sse4_crc32').calculate;

var kFileChangeEventName = 'change';
var kFileRenameEventName = 'rename';
var kFileRemoveEventName = 'remove';
var kFileCreateEventName = 'create';

module.exports = FileWatcher;

function FileWatcher(options, callback) {
  this.pFiles = {};
  this.pWatchers = {};
  if (Function.isFunction(options)) {
    callback = options;
    options = {};
  }
  this.pOptions = $extend(options, {
    interval: 10000,
    validate: false,
    fullName: true
  });
  this.pCallback = callback;
  if (this.pOptions.interval > 0)
    this.pTimer = setInterval(this.pCheckFolders.bind(this),
        this.pOptions.interval);
}
$declare(FileWatcher, {
  /**
   * Watch a file
   * @param  {string} file file path
   */
  watch: function(file) {
    var fullName = Path.resolve(file);
    if (this.pFiles[fullName])
      return;
    var stub = this.pFiles[fullName] = {
      name: this.pOptions.fullName ? fullName : file,
      stat: this.pGetFileStat(fullName)
    };
    var dir, watchDir;
    if (stub.stat.isDirectory()) {
      dir = fullName;
      watchDir = true;
    } else if (stub.stat.isFile()) {
      dir = Path.dirname(fullName) + '/';
      watchDir = false;
    }
    if (!this.pWatchers[dir]) {
      this.pWatchers[dir] = {
        handler: null,
        count: 0
      };
      this.pWatchDir(dir);
    }
    if (watchDir) {
      this.pWatchers[dir].watchDir = true;
    } else {
      this.pWatchers[dir].count++;
    }
  },
  /**
   * Unwatch a file
   * @param  {string} file file path
   */
  unwatch: function(file) {
    var fullName = Path.resolve(file);
    if (!this.pFiles[fullName])
      return;
    delete this.pFiles[fullName];
    var stub;
    if (fullName in this.pWatchers) {
      stub = this.pWatchers[fullName];
      stub.watchDir = false;
    } else {
      stub = this.pWatchers[Path.dirname(fullName) + '/'];
      stub.count--;
    }
    if (stub.count === 0 && !stub.watchDir) {
      this.pUnwatchDir(dir);
      delete this.pWatchers[dir];
    }
  },
  /**
   * Handle file change event
   * @param  {string} dir  directory the event emitted.
   * @param  {string} evt  event name
   * @param  {string} file file name
   */
  pHandleChange: function(dir, evt, file) {
    var fullName = dir + file;
    if (this.pFiles[fullName]) {
      file = this.pFiles[fullName];
      var nstat = this.pGetFileStat(fullName);
      if (evt == kFileRenameEventName) {
        evt = this.pCheckFileExistenceChange(fullName, nstat) || evt;
      } else if (evt == kFileChangeEventName) {
        if (this.pOptions.validate) {
          if (nstat.size == file.stat.size &&
              nstat.crc32 == file.stat.crc32) {
            evt = null;
          }
        }
      }
      file.stat = nstat;
      if (evt)
        this.pCallback(evt, file.name, file.stat);
    } else if (this.pWatchers[dir].watchDir) {
      // Handling a dir chaning event;
      this.pCallback(evt, fullName);
    }
  },
  /**
   * Check file existence change
   * @param  {string}   fullName file path
   * @param  {Fs.Stats} nstat    new file stat
   * @return {string}            create/remove if existence changed, null otherwise
   */
  pCheckFileExistenceChange: function(fullName, nstat) {
    var file = this.pFiles[fullName];
    if ((file.stat !== null) ^ (nstat !== null)) {
      if (nstat)
        return kFileCreateEventName;
      return kFileRemoveEventName;
    }
    return null;
  },
  /**
   * Watch a directory, if it's not being watched
   * @param  {string} dir directory path
   * Note: the dir passed in must has its stub first
   */
  pWatchDir: function(dir) {
    if (this.pWatchers[dir].handler || !Fs.existsSync(dir))
      return;
    this.pWatchers[dir].handler = Fs.watch(dir, this.pHandleChange.bind(this, dir));
  },
  /**
   * Unwatch a directory, if it's currently watched.
   * @param  {string} dir directory path
   * Note: the dir passed in must has its stub first
   */
  pUnwatchDir: function(dir) {
    var handler = this.pWatchers[dir].handler;
    if (handler) {
      handler.close();
      this.pWatchers[dir].handler = null;
    }
  },
  /**
   * Get cached file stat
   * @param  {string}  file file path
   * @return {Fs.Stat}      file stat
   */
  getFileStat: function(file) {
    file = this.pFiles[Path.resolve(file)];
    if (!file)
      return undefined;
    return file.stat;
  },
  /**
   * Get file stat info, without throw
   * @param  {string}  file file path
   * @return {Fs.Stat}      file stat if exists, null otherwise
   */
  pGetFileStat: function(file) {
    if (!Fs.existsSync(file))
      return null;
    var stat = Fs.statSync(file);
    console.log(stat);
    if (stat.isFile())
      if (this.pOptions.validate)
        stat.crc32 = crc32(Fs.readFileSync(file));
    return stat;
  },
  /**
   * Check folder existence, and update file status.
   */
  pCheckFolders: function() {
    for (var dir in this.pWatchers) {
      var exist = Fs.existsSync(dir);
      if ((this.pWatchers[dir].handler !== null) ^ exist) {
        if (exist)
          this.pWatchDir(dir);
        else
          this.pUnwatchDir(dir);
        for (var fullName in this.pFiles)
          if (fullName.startsWith(dir))
            this.pHandleChange(dir, 'rename',
                fullName.substr(dir.length));
      }
    }
  },
  /**
   * Stop watching all files
   */
  reset: function() {
    for (var dir in this.pWatchers)
      this.pUnwatchDir(dir);
    this.pFiles = {};
    this.pWatchers = {};
  },
  /**
   * Save current file stats.
   * @return {Object} hash object containing status of all watching files
   */
  save: function() {
    return $valueCopy(this.pFiles);
  },
  /**
   * Restore a previous saved status
   * @param  {Object} files hash object containing status of all watching files
   */
  restore: function(files) {
    this.reset();
    for (var fullName in files) {
      this.watch(fullName);
      var stat = files[fullName].stat;
      var nstat = this.pFiles[fullName].stat;
      var evt = null;
      if ((stat !== null) ^ (nstat !== null)) {
        if (nstat)
          evt = kFileCreateEventName;
        else
          evt = kFileRemoveEventName;
      } else if (nstat && stat) {
        if (this.pOptions.validate) {
          if (nstat.size != stat.size ||
              nstat.crc32 != stat.crc32) {
            evt = kFileChangeEventName;
          }
        } else {
          if (nstat.mtime != stat.mtime) {
            evt = kFileChangeEventName;
          }
        }
      }
      if (evt)
        this.pCallback(evt, fullName, nstat.crc32);
    }
  }
});
