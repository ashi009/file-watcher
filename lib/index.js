require('apollo');

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
  this.pDirs = {};
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
    this.pFiles[fullName] = {
      name: this.pOptions.fullName ? fullName : file,
      stat: this.pGetFileStat(fullName)
    };
    var dir = Path.dirname(fullName) + '/';
    if (!this.pDirs[dir]) {
      this.pDirs[dir] = {
        handler: null,
        count: 0
      };
      this.pWatchDir(dir);
    }
    this.pDirs[dir].count++;
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
    var dir = Path.dirname(fullName) + '/';
    if (--this.pDirs[dir].count === 0) {
      this.pUnwatchDir(dir);
      delete this.pDirs[dir];
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
    if (!this.pFiles[fullName])
      return;
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
    if (this.pDirs[dir].handler || !Fs.existsSync(dir))
      return;
    this.pDirs[dir].handler = Fs.watch(dir, this.pHandleChange.bind(this, dir));
  },
  /**
   * Unwatch a directory, if it's currently watched.
   * @param  {string} dir directory path
   * Note: the dir passed in must has its stub first
   */
  pUnwatchDir: function(dir) {
    var handler = this.pDirs[dir].handler;
    if (handler) {
      handler.close();
      this.pDirs[dir].handler = null;
    }
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
    if (this.pOptions.validate)
      stat.crc32 = crc32(Fs.readFileSync(file));
    return stat;
  },
  /**
   * Check folder existence, and update file status.
   */
  pCheckFolders: function() {
    for (var dir in this.pDirs) {
      var exist = Fs.existsSync(dir);
      if ((this.pDirs[dir].handler !== null) ^ exist) {
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
    for (var dir in this.pDirs)
      this.pUnwatchDir(dir);
    this.pFiles = {};
    this.pDirs = {};
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
