'use strict';

var path = require('path');
var buffer = require('buffer');

var fs = require('graceful-fs');
var File = require('vinyl');
var expect = require('expect');
var miss = require('mississippi');
var mkdirp = require('fs-mkdirp-stream/mkdirp');

var fo = require('../lib/file-operations');
var constants = require('../lib/constants');

var DEFAULT_FILE_MODE = constants.DEFAULT_FILE_MODE;

var cleanup = require('./utils/cleanup');
var statMode = require('./utils/stat-mode');
var mockError = require('./utils/mock-error');
var isWindows = require('./utils/is-windows');
var applyUmask = require('./utils/apply-umask');
var testStreams = require('./utils/test-streams');
var testConstants = require('./utils/test-constants');

var closeFd = fo.closeFd;
var isOwner = fo.isOwner;
var writeFile = fo.writeFile;
var getModeDiff = fo.getModeDiff;
var getTimesDiff = fo.getTimesDiff;
var getOwnerDiff = fo.getOwnerDiff;
var isValidUnixId = fo.isValidUnixId;
var getFlags = fo.getFlags;
var isFatalOverwriteError = fo.isFatalOverwriteError;
var isFatalUnlinkError = fo.isFatalUnlinkError;
var reflectStat = fo.reflectStat;
var reflectLinkStat = fo.reflectLinkStat;
var updateMetadata = fo.updateMetadata;
var createWriteStream = fo.createWriteStream;

var pipe = miss.pipe;
var from = miss.from;

var string = testStreams.string;

var outputBase = testConstants.outputBase;
var inputPath = testConstants.inputPath;
var neInputDirpath = testConstants.neInputDirpath;
var outputPath = testConstants.outputPath;
var symlinkPath = testConstants.symlinkDirpath;
var contents = testConstants.contents;

var clean = cleanup(outputBase);

function noop() {}

describe('isOwner', function() {

  var ownerStat = {
    uid: 9001,
  };

  var nonOwnerStat = {
    uid: 9002,
  };

  var getuidSpy;
  var geteuidSpy;

  beforeEach(function(done) {
    if (typeof process.geteuid !== 'function') {
      process.geteuid = noop;
    }

    // Windows :(
    if (typeof process.getuid !== 'function') {
      process.getuid = noop;
    }

    getuidSpy = expect.spyOn(process, 'getuid').andReturn(ownerStat.uid);
    geteuidSpy = expect.spyOn(process, 'geteuid').andReturn(ownerStat.uid);

    done();
  });

  afterEach(function(done) {
    expect.restoreSpies();

    if (process.geteuid === noop) {
      delete process.geteuid;
    }

    // Windows :(
    if (process.getuid === noop) {
      delete process.getuid;
    }

    done();
  });

  // TODO: test for having neither

  it('uses process.geteuid() when available', function(done) {

    isOwner(ownerStat);

    expect(getuidSpy.calls.length).toEqual(0);
    expect(geteuidSpy.calls.length).toEqual(1);

    done();
  });

  it('uses process.getuid() when geteuid() is not available', function(done) {
    delete process.geteuid;

    isOwner(ownerStat);

    expect(getuidSpy.calls.length).toEqual(1);

    done();
  });

  it('returns false when non-root and non-owner', function(done) {
    var result = isOwner(nonOwnerStat);

    expect(result).toEqual(false);

    done();
  });

  it('returns true when owner and non-root', function(done) {
    var result = isOwner(ownerStat);

    expect(result).toEqual(true);

    done();
  });

  it('returns true when non-owner but root', function(done) {
    expect.spyOn(process, 'geteuid').andReturn(0); // 0 is root uid

    var result = isOwner(nonOwnerStat);

    expect(result).toEqual(true);

    done();
  });
});

describe('isValidUnixId', function() {

  it('returns true if the given id is a valid unix id', function(done) {
    var result = isValidUnixId(1000);

    expect(result).toEqual(true);

    done();
  });

  it('returns false if the given id is not a number', function(done) {
    var result = isValidUnixId('root');

    expect(result).toEqual(false);

    done();
  });

  it('returns false when the given id is less than 0', function(done) {
    var result = isValidUnixId(-1);

    expect(result).toEqual(false);

    done();
  });
});

describe('getFlags', function() {

  it('returns wx if overwrite is false and append is false', function(done) {
    var result = getFlags({
      overwrite: false,
      append: false,
    });

    expect(result).toEqual('wx');

    done();
  });

  it('returns w if overwrite is true and append is false', function(done) {
    var result = getFlags({
      overwrite: true,
      append: false,
    });

    expect(result).toEqual('w');

    done();
  });

  it('returns ax if overwrite is false and append is true', function(done) {
    var result = getFlags({
      overwrite: false,
      append: true,
    });

    expect(result).toEqual('ax');

    done();
  });

  it('returns a if overwrite is true and append is true', function(done) {
    var result = getFlags({
      overwrite: true,
      append: true,
    });

    expect(result).toEqual('a');

    done();
  });
});

describe('isFatalOverwriteError', function() {

  it('returns false if not given any error', function(done) {
    var result = isFatalOverwriteError(null);

    expect(result).toEqual(false);

    done();
  });

  it('returns true if code != EEXIST', function(done) {
    var result = isFatalOverwriteError({ code: 'EOTHER' });

    expect(result).toEqual(true);

    done();
  });

  it('returns false if code == EEXIST and flags == wx', function(done) {
    var result = isFatalOverwriteError({ code: 'EEXIST' }, 'wx');

    expect(result).toEqual(false);

    done();
  });

  it('returns false if code == EEXIST and flags == ax', function(done) {
    var result = isFatalOverwriteError({ code: 'EEXIST' }, 'ax');

    expect(result).toEqual(false);

    done();
  });

  it('returns true if error.code == EEXIST and flags == w', function(done) {
    var result = isFatalOverwriteError({ code: 'EEXIST' }, 'w');

    expect(result).toEqual(true);

    done();
  });

  it('returns true if error.code == EEXIST and flags == a', function(done) {
    var result = isFatalOverwriteError({ code: 'EEXIST' }, 'a');

    expect(result).toEqual(true);

    done();
  });
});

describe('isFatalUnlinkError', function() {

  it('returns false if not given any error', function(done) {
    var result = isFatalUnlinkError(null);

    expect(result).toEqual(false);

    done();
  });

  it('returns false if code == ENOENT', function(done) {
    var result = isFatalUnlinkError({ code: 'ENOENT' }, 'wx');

    expect(result).toEqual(false);

    done();
  });

  it('returns true if code != ENOENT', function(done) {
    var result = isFatalUnlinkError({ code: 'EOTHER' });

    expect(result).toEqual(true);

    done();
  });

});

describe('getModeDiff', function() {

  it('returns 0 if both modes are the same', function(done) {
    var fsMode = applyUmask('777');
    var vfsMode = applyUmask('777');

    var result = getModeDiff(fsMode, vfsMode);

    expect(result).toEqual(0);

    done();
  });

  it('returns 0 if vinyl mode is not a number', function(done) {
    var fsMode = applyUmask('777');
    var vfsMode = undefined;

    var result = getModeDiff(fsMode, vfsMode);

    expect(result).toEqual(0);

    done();
  });

  it('returns a value greater than 0 if modes are different', function(done) {
    var fsMode = applyUmask('777');
    var vfsMode = applyUmask('744');

    var result = getModeDiff(fsMode, vfsMode);

    expect(result).toBeGreaterThan(0);

    done();
  });

  it('returns the proper diff', function(done) {
    var fsMode = applyUmask('777');
    var vfsMode = applyUmask('744');
    var expectedDiff = applyUmask('33');

    var result = getModeDiff(fsMode, vfsMode);

    expect(result).toEqual(expectedDiff);

    done();
  });

  it('does not matter the order of diffing', function(done) {
    var fsMode = applyUmask('655');
    var vfsMode = applyUmask('777');
    var expectedDiff = applyUmask('122');

    var result = getModeDiff(fsMode, vfsMode);

    expect(result).toEqual(expectedDiff);

    done();
  });

  it('includes the sticky/setuid/setgid bits', function(done) {
    var fsMode = applyUmask('1777');
    var vfsMode = applyUmask('4777');
    var expectedDiff = applyUmask('5000');

    var result = getModeDiff(fsMode, vfsMode);

    expect(result).toEqual(expectedDiff);

    done();
  });
});

describe('getTimesDiff', function() {

  it('returns undefined if vinyl mtime is not a valid date', function(done) {
    var fsStat = {
      mtime: new Date(),
    };
    var vfsStat = {
      mtime: new Date(undefined),
    };

    var result = getTimesDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    done();
  });

  it('returns undefined if vinyl mtime & atime are both equal to counterparts', function(done) {
    var now = Date.now();
    var fsStat = {
      mtime: new Date(now),
      atime: new Date(now),
    };
    var vfsStat = {
      mtime: new Date(now),
      atime: new Date(now),
    };

    var result = getTimesDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    done();
  });

  // TODO: is this proper/expected?
  it('returns undefined if vinyl mtimes equals the counterpart and atimes are null', function(done) {
    var now = Date.now();
    var fsStat = {
      mtime: new Date(now),
      atime: null,
    };
    var vfsStat = {
      mtime: new Date(now),
      atime: null,
    };

    var result = getTimesDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    done();
  });

  it('returns a diff object if mtimes do not match', function(done) {
    var now = Date.now();
    var then = now - 1000;
    var fsStat = {
      mtime: new Date(now),
    };
    var vfsStat = {
      mtime: new Date(then),
    };
    var expected = {
      mtime: new Date(then),
      atime: undefined,
    };

    var result = getTimesDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    done();
  });

  it('returns a diff object if atimes do not match', function(done) {
    var now = Date.now();
    var then = now - 1000;
    var fsStat = {
      mtime: new Date(now),
      atime: new Date(now),
    };
    var vfsStat = {
      mtime: new Date(now),
      atime: new Date(then),
    };
    var expected = {
      mtime: new Date(now),
      atime: new Date(then),
    };

    var result = getTimesDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    done();
  });

  it('returns the fs atime if the vinyl atime is invalid', function(done) {
    var now = Date.now();
    var fsStat = {
      mtime: new Date(now),
      atime: new Date(now),
    };
    var vfsStat = {
      mtime: new Date(now),
      atime: new Date(undefined),
    };
    var expected = {
      mtime: new Date(now),
      atime: new Date(now),
    };

    var result = getTimesDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    done();
  });

  // TODO: is this proper/expected?
  it('makes atime diff undefined if fs and vinyl atime are invalid', function(done) {
    var now = Date.now();
    var fsStat = {
      mtime: new Date(now),
      atime: new Date(undefined),
    };
    var vfsStat = {
      mtime: new Date(now),
      atime: new Date(undefined),
    };
    var expected = {
      mtime: new Date(now),
      atime: undefined,
    };

    var result = getTimesDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    done();
  });
});

describe('getOwnerDiff', function() {

  it('returns undefined if vinyl uid & gid are invalid', function(done) {
    var fsStat = {
      uid: 1000,
      gid: 1000,
    };
    var vfsStat = {
      uid: undefined,
      gid: undefined,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    done();
  });

  it('returns undefined if vinyl uid & gid are both equal to counterparts', function(done) {
    var fsStat = {
      uid: 1000,
      gid: 1000,
    };
    var vfsStat = {
      uid: 1000,
      gid: 1000,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    done();
  });

  it('returns a diff object if uid or gid do not match', function(done) {
    var fsStat = {
      uid: 1000,
      gid: 1000,
    };
    var vfsStat = {
      uid: 1001,
      gid: 1000,
    };
    var expected = {
      uid: 1001,
      gid: 1000,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    vfsStat = {
      uid: 1000,
      gid: 1001,
    };
    expected = {
      uid: 1000,
      gid: 1001,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    done();
  });

  it('returns the fs uid if the vinyl uid is invalid', function(done) {
    var fsStat = {
      uid: 1000,
      gid: 1000,
    };
    var vfsStat = {
      uid: undefined,
      gid: 1001,
    };
    var expected = {
      uid: 1000,
      gid: 1001,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    var vfsStat = {
      uid: -1,
      gid: 1001,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    done();
  });

  it('returns the fs gid if the vinyl gid is invalid', function(done) {
    var fsStat = {
      uid: 1000,
      gid: 1000,
    };
    var vfsStat = {
      uid: 1001,
      gid: undefined,
    };
    var expected = {
      uid: 1001,
      gid: 1000,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    var vfsStat = {
      uid: 1001,
      gid: -1,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(expected);

    done();
  });

  it('returns undefined if fs and vinyl uid are invalid', function(done) {
    var fsStat = {
      uid: undefined,
      gid: 1000,
    };
    var vfsStat = {
      uid: undefined,
      gid: 1001,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    var fsStat = {
      uid: -1,
      gid: 1000,
    };
    var vfsStat = {
      uid: -1,
      gid: 1001,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    done();
  });

  it('returns undefined if fs and vinyl gid are invalid', function(done) {
    var fsStat = {
      uid: 1000,
      gid: undefined,
    };
    var vfsStat = {
      uid: 1001,
      gid: undefined,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    fsStat = {
      uid: 1000,
      gid: -1,
    };
    vfsStat = {
      uid: 1001,
      gid: -1,
    };

    var result = getOwnerDiff(fsStat, vfsStat);

    expect(result).toEqual(undefined);

    done();
  });
});

describe('closeFd', function() {

  it('calls the callback with propagated error if fd is not a number', function(done) {
    var propagatedError = new Error();

    closeFd(propagatedError, null, function(err) {
      expect(err).toEqual(propagatedError);

      done();
    });
  });

  it('calls the callback with close error if no error to propagate', function(done) {
    closeFd(null, -1, function(err) {
      expect(err).toExist();

      done();
    });
  });

  it('calls the callback with propagated error if close errors', function(done) {
    var propagatedError = new Error();

    closeFd(propagatedError, -1, function(err) {
      expect(err).toEqual(propagatedError);

      done();
    });
  });

  it('calls the callback with propagated error if close succeeds', function(done) {
    var propagatedError = new Error();

    var fd = fs.openSync(inputPath, 'r');

    var closeSpy = expect.spyOn(fs, 'close').andCallThrough();

    closeFd(propagatedError, fd, function(err) {
      closeSpy.restore();

      expect(closeSpy.calls.length).toEqual(1);
      expect(err).toEqual(propagatedError);

      done();
    });
  });

  it('calls the callback with no error if close succeeds & no propagated error', function(done) {
    var fd = fs.openSync(inputPath, 'r');

    var spy = expect.spyOn(fs, 'close').andCallThrough();

    closeFd(null, fd, function(err) {
      spy.restore();

      expect(spy.calls.length).toEqual(1);
      expect(err).toEqual(undefined);

      done();
    });
  });
});

describe('writeFile', function() {

  beforeEach(clean);
  afterEach(clean);

  beforeEach(function(done) {
    mkdirp(outputBase, done);
  });

  it('writes a file to the filesystem, does not close and returns the fd', function(done) {
    writeFile(outputPath, new Buffer(contents), function(err, fd) {
      expect(err).toNotExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.close(fd, function() {
        var written = fs.readFileSync(outputPath, 'utf8');

        expect(written).toEqual(contents);

        done();
      });
    });
  });

  it('defaults to writing files with 0666 mode', function(done) {
    var expected = applyUmask('666');

    writeFile(outputPath, new Buffer(contents), function(err, fd) {
      expect(err).toNotExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.close(fd, function() {
        expect(statMode(outputPath)).toEqual(expected);

        done();
      });
    });
  });

  it('accepts a different mode in options', function(done) {
    // Changing the mode of a file is not supported by node.js in Windows.
    if (isWindows) {
      this.skip();
      return;
    }

    var expected = applyUmask('777');
    var options = {
      mode: expected,
    };

    writeFile(outputPath, new Buffer(contents), options, function(err, fd) {
      expect(err).toNotExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.close(fd, function() {
        expect(statMode(outputPath)).toEqual(expected);

        done();
      });
    });
  });

  it('defaults to opening files with write flag', function(done) {
    var length = contents.length;

    writeFile(outputPath, new Buffer(contents), function(err, fd) {
      expect(err).toNotExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.read(fd, new Buffer(length), 0, length, 0, function(readErr) {
        expect(readErr).toExist();

        fs.close(fd, done);
      });
    });
  });

  it('accepts a different flags in options', function(done) {
    var length = contents.length;
    var options = {
      flags: 'w+',
    };

    writeFile(outputPath, new Buffer(contents), options, function(err, fd) {
      expect(err).toNotExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.read(fd, new Buffer(length), 0, length, 0, function(readErr, _, written) {
        expect(readErr).toNotExist();

        expect(written.toString()).toEqual(contents);

        fs.close(fd, done);
      });
    });
  });

  it('appends to a file if append flag is given', function(done) {
    var initial = 'test';
    var toWrite = '-a-thing';

    fs.writeFileSync(outputPath, initial, 'utf8');

    var expected = initial + toWrite;

    var options = {
      flags: 'a',
    };

    writeFile(outputPath, new Buffer(toWrite), options, function(err, fd) {
      expect(err).toNotExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.close(fd, function() {
        var written = fs.readFileSync(outputPath, 'utf8');

        expect(written).toEqual(expected);

        done();
      });
    });
  });

  it('does not pass a file descriptor if open call errors', function(done) {
    var notExistDir = path.join(__dirname, './not-exist-dir/writeFile.txt');

    writeFile(notExistDir, new Buffer(contents), function(err, fd) {
      expect(err).toExist();
      expect(typeof fd === 'number').toEqual(false);

      done();
    });
  });

  it('passes a file descriptor if write call errors', function(done) {
    var options = {
      flags: 'r',
    };

    writeFile(inputPath, new Buffer(contents), options, function(err, fd) {
      expect(err).toExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.close(fd, done);
    });
  });

  it('passes an error if called with string as data', function(done) {
    writeFile(outputPath, contents, function(err) {
      expect(err).toExist();

      done();
    });
  });

  it('does not error on SlowBuffer', function(done) {
    if (!buffer.SlowBuffer) {
      this.skip();
      return;
    }

    var length = contents.length;
    var buf = new Buffer(contents);
    var content = new buffer.SlowBuffer(length);
    buf.copy(content, 0, 0, length);

    writeFile(outputPath, content, function(err, fd) {
      expect(err).toNotExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.close(fd, function() {
        var written = fs.readFileSync(outputPath, 'utf8');

        expect(written).toEqual(contents);

        done();
      });
    });
  });

  it('does not error if options is falsey', function(done) {
    writeFile(outputPath, new Buffer(contents), null, function(err, fd) {
      expect(err).toNotExist();
      expect(typeof fd === 'number').toEqual(true);

      fs.close(fd, done);
    });
  });
});

describe('reflectStat', function() {

  beforeEach(clean);
  afterEach(clean);

  beforeEach(function(done) {
    mkdirp(outputBase, done);
  });

  it('passes the error if stat fails', function(done) {

    var file = new File();

    reflectStat(neInputDirpath, file, function(err) {
      expect(err).toExist();

      done();
    });
  });

  it('updates the vinyl with filesystem stats', function(done) {
    var file = new File();

    fs.symlinkSync(inputPath, symlinkPath);

    reflectStat(symlinkPath, file, function() {
      // There appears to be a bug in the Windows implementation which causes
      // the sync versions of stat and lstat to return unsigned 32-bit ints
      // whilst the async versions returns signed 32-bit ints... This affects
      // dev but possibly others as well?
      fs.stat(symlinkPath, function(err, stat) {
        expect(file.stat).toEqual(stat);

        done();
      });
    });
  });
});

describe('reflectLinkStat', function() {

  beforeEach(clean);
  afterEach(clean);

  beforeEach(function(done) {
    mkdirp(outputBase, done);
  });

  it('passes the error if lstat fails', function(done) {

    var file = new File();

    reflectLinkStat(neInputDirpath, file, function(err) {
      expect(err).toExist();

      done();
    });
  });

  it('updates the vinyl with filesystem symbolic stats', function(done) {
    var file = new File();

    fs.symlinkSync(inputPath, symlinkPath);

    reflectLinkStat(symlinkPath, file, function() {
      // There appears to be a bug in the Windows implementation which causes
      // the sync versions of stat and lstat to return unsigned 32-bit ints
      // whilst the async versions returns signed 32-bit ints... This affects
      // dev but possibly others as well?
      fs.lstat(symlinkPath, function(err, stat) {
        expect(file.stat).toEqual(stat);

        done();
      });
    });
  });
});

describe('updateMetadata', function() {

  beforeEach(clean);
  afterEach(clean);

  beforeEach(function(done) {
    mkdirp(outputBase, done);
  });

  afterEach(function(done) {
    if (process.geteuid === noop) {
      delete process.geteuid;
    }

    done();
  });

  it('passes the error if fstat fails', function(done) {
    // Changing the time of a directory errors in Windows.
    // Changing the mode of a file is not supported by node.js in Windows.
    // Windows is treated as though it does not have permission to make these operations.
    if (isWindows) {
      this.skip();
      return;
    }

    var fd = 9001;

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {},
    });

    updateMetadata(fd, file, function(err) {
      expect(err).toExist();

      done();
    });
  });

  it('updates the vinyl object with fs stats', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {},
    });

    var fd = fs.openSync(outputPath, 'w+');
    var stats = fs.fstatSync(fd);

    updateMetadata(fd, file, function() {
      // Not sure why .toEqual doesn't match these
      Object.keys(file.stat).forEach(function(key) {
        expect(file.stat[key]).toEqual(stats[key]);
      });

      fs.close(fd, done);
    });
  });

  it('does not touch the fs if nothing to update', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {},
    });

    var fchmodSpy = expect.spyOn(fs, 'fchmod').andCallThrough();
    var futimesSpy = expect.spyOn(fs, 'futimes').andCallThrough();

    var fd = fs.openSync(outputPath, 'w+');

    updateMetadata(fd, file, function() {
      expect(fchmodSpy.calls.length).toEqual(0);
      expect(futimesSpy.calls.length).toEqual(0);

      fs.close(fd, done);
    });
  });

  it('does not touch the fs if process is not owner of the file', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    if (typeof process.geteuid !== 'function') {
      process.geteuid = noop;
    }

    var earlier = Date.now() - 1000;

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {
        mtime: new Date(earlier),
      },
    });

    expect.spyOn(process, 'geteuid').andReturn(9002);
    var fchmodSpy = expect.spyOn(fs, 'fchmod').andCallThrough();
    var futimesSpy = expect.spyOn(fs, 'futimes').andCallThrough();

    var fd = fs.openSync(outputPath, 'w+');

    updateMetadata(fd, file, function() {
      expect(fchmodSpy.calls.length).toEqual(0);
      expect(futimesSpy.calls.length).toEqual(0);

      fs.close(fd, done);
    });
  });

  it('updates times on fs and vinyl object if there is a diff', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var futimesSpy = expect.spyOn(fs, 'futimes').andCallThrough();

    // Use new atime/mtime
    var atime = new Date(Date.now() - 2048);
    var mtime = new Date(Date.now() - 1024);
    var mtimeEarlier = mtime.getTime() - 1000;
    var atimeEarlier = atime.getTime() - 1000;

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {
        mtime: new Date(mtimeEarlier),
        atime: new Date(atimeEarlier),
      },
    });

    var fd = fs.openSync(outputPath, 'w+');

    updateMetadata(fd, file, function() {
      expect(futimesSpy.calls.length).toEqual(1);
      // Var stats = fs.fstatSync(fd);

      var atimeSpy = futimesSpy.calls[0].arguments[1];
      var mtimeSpy = futimesSpy.calls[0].arguments[2];

      expect(file.stat.mtime).toEqual(new Date(mtimeEarlier));
      expect(mtimeSpy.getTime()).toEqual(mtimeEarlier);
      expect(file.stat.atime).toEqual(new Date(atimeEarlier));
      expect(atimeSpy.getTime()).toEqual(atimeEarlier);

      fs.close(fd, done);
    });
  });

  it('forwards futimes error and descriptor upon error', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var futimesSpy = expect.spyOn(fs, 'futimes').andCall(mockError);

    var now = Date.now();
    var then = now - 1000;

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {
        mtime: new Date(then),
        atime: new Date(then),
      },
    });

    var fd = fs.openSync(outputPath, 'w+');
    expect(typeof fd === 'number').toEqual(true);

    updateMetadata(fd, file, function(err) {
      expect(err).toExist();
      expect(futimesSpy.calls.length).toEqual(1);

      fs.close(fd, done);
    });
  });

  it('updates the mode on fs and vinyl object if there is a diff', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var fchmodSpy = expect.spyOn(fs, 'fchmod').andCallThrough();

    var mode = applyUmask('777');

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {
        mode: mode,
      },
    });

    var fd = fs.openSync(outputPath, 'w+');

    updateMetadata(fd, file, function() {
      expect(fchmodSpy.calls.length).toEqual(1);
      var stats = fs.fstatSync(fd);
      expect(file.stat.mode).toEqual(stats.mode);

      fs.close(fd, done);
    });
  });


  it('updates the sticky bit on mode on fs and vinyl object if there is a diff', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var fchmodSpy = expect.spyOn(fs, 'fchmod').andCallThrough();

    var mode = applyUmask('1777');

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {
        mode: mode,
      },
    });

    var fd = fs.openSync(outputPath, 'w+');

    updateMetadata(fd, file, function() {
      expect(fchmodSpy.calls.length).toEqual(1);
      var stats = fs.fstatSync(fd);
      expect(file.stat.mode).toEqual(stats.mode);

      fs.close(fd, done);
    });
  });

  it('forwards fchmod error and descriptor upon error', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var mode = applyUmask('777');

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {
        mode: mode,
      },
    });

    var fd = fs.openSync(outputPath, 'w+');

    var fchmodSpy = expect.spyOn(fs, 'fchmod').andCall(mockError);

    updateMetadata(fd, file, function(err) {
      expect(err).toExist();
      expect(fchmodSpy.calls.length).toEqual(1);

      fs.close(fd, done);
    });
  });

  it('updates the mode & times on fs and vinyl object if there is a diff', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var fchmodSpy = expect.spyOn(fs, 'fchmod').andCallThrough();
    var futimesSpy = expect.spyOn(fs, 'futimes').andCallThrough();

    // Use new atime/mtime
    var atime = new Date(Date.now() - 2048);
    var mtime = new Date(Date.now() - 1024);
    var mtimeEarlier = mtime.getTime() - 1000;
    var atimeEarlier = atime.getTime() - 1000;

    var mode = applyUmask('777');

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {
        mtime: new Date(mtimeEarlier),
        atime: new Date(atimeEarlier),
        mode: mode,
      },
    });

    var fd = fs.openSync(outputPath, 'w+');

    updateMetadata(fd, file, function() {
      expect(fchmodSpy.calls.length).toEqual(1);
      expect(futimesSpy.calls.length).toEqual(1);

      var atimeSpy = futimesSpy.calls[0].arguments[1];
      var mtimeSpy = futimesSpy.calls[0].arguments[2];

      expect(file.stat.mtime).toEqual(new Date(mtimeEarlier));
      expect(mtimeSpy.getTime()).toEqual(mtimeEarlier);
      expect(file.stat.atime).toEqual(new Date(atimeEarlier));
      expect(atimeSpy.getTime()).toEqual(atimeEarlier);

      fs.close(fd, done);
    });
  });

  it('forwards fchmod error and descriptor through futimes if there is a time diff', function(done) {
    if (isWindows) {
      this.skip();
      return;
    }

    var mockedErr = new Error('mocked error');

    var fchmodSpy = expect.spyOn(fs, 'fchmod').andCall(function(fd, mode, cb) {
      cb(mockedErr);
    });
    var futimesSpy = expect.spyOn(fs, 'futimes').andCallThrough();

    var now = Date.now();
    var then = now - 1000;
    var mode = applyUmask('777');

    var file = new File({
      base: outputBase,
      path: outputPath,
      contents: null,
      stat: {
        mtime: new Date(then),
        atime: new Date(then),
        mode: mode,
      },
    });

    var fd = fs.openSync(outputPath, 'w');

    updateMetadata(fd, file, function(err) {
      expect(err).toExist();
      expect(err).toEqual(mockedErr);
      expect(fchmodSpy.calls.length).toEqual(1);
      expect(futimesSpy.calls.length).toEqual(1);

      fs.close(fd, done);
    });
  });

  // TODO: forward fchown error tests
});

describe('createWriteStream', function() {

  beforeEach(clean);
  afterEach(clean);

  beforeEach(function(done) {
    // For some reason, the outputDir sometimes exists on Windows
    // So we use our mkdirp to create it
    mkdirp(outputBase, done);
  });

  it('accepts just a file path and writes to it', function(done) {

    function assert(err) {
      var outputContents = fs.readFileSync(outputPath, 'utf8');
      expect(outputContents).toEqual(contents);
      done(err);
    }

    pipe([
      from([contents]),
      createWriteStream(outputPath),
    ], assert);
  });

  it('accepts just a file path and writes a large file to it', function(done) {
    var size = 40000;

    function assert(err) {
      var stats = fs.lstatSync(outputPath);

      expect(stats.size).toEqual(size);
      done(err);
    }

    pipe([
      string(size),
      createWriteStream(outputPath),
    ], assert);
  });

  it('accepts flags option', function(done) {
    // Write 13 stars then 12345 because the length of expected is 13
    fs.writeFileSync(outputPath, '*************12345');

    function assert(err) {
      var outputContents = fs.readFileSync(outputPath, 'utf8');
      expect(outputContents).toEqual(contents + '12345');
      done(err);
    }

    pipe([
      from([contents]),
      // Replaces from the beginning of the file
      createWriteStream(outputPath, { flags: 'r+' }),
    ], assert);
  });

  it('accepts append flag as option & places cursor at the end', function(done) {
    fs.writeFileSync(outputPath, '12345');

    function assert(err) {
      var outputContents = fs.readFileSync(outputPath, 'utf8');
      expect(outputContents).toEqual('12345' + contents);
      done(err);
    }

    pipe([
      from([contents]),
      // Appends to the end of the file
      createWriteStream(outputPath, { flags: 'a' }),
    ], assert);
  });

  it('accepts mode option', function(done) {
    if (isWindows) {
      console.log('Changing the mode of a file is not supported by node.js in Windows.');
      this.skip();
      return;
    }

    var mode = applyUmask('777');

    function assert(err) {
      expect(statMode(outputPath)).toEqual(mode);
      done(err);
    }

    pipe([
      from([contents]),
      createWriteStream(outputPath, { mode: mode }),
    ], assert);
  });

  it('uses default file mode if no mode options', function(done) {
    var defaultMode = applyUmask(DEFAULT_FILE_MODE);

    function assert(err) {
      expect(statMode(outputPath)).toEqual(defaultMode);
      done(err);
    }

    pipe([
      from([contents]),
      createWriteStream(outputPath),
    ], assert);
  });

  it('accepts a flush function that is called before close emitted', function(done) {
    var flushCalled = false;

    var outStream = createWriteStream(outputPath, {}, function(fd, cb) {
      flushCalled = true;
      cb();
    });

    function assert(err) {
      expect(flushCalled).toEqual(true);
      done(err);
    }

    pipe([
      from([contents]),
      outStream,
    ], assert);
  });

  it('can specify flush without options argument', function(done) {
    var flushCalled = false;

    var outStream = createWriteStream(outputPath, function(fd, cb) {
      flushCalled = true;
      cb();
    });

    function assert(err) {
      expect(flushCalled).toEqual(true);
      done(err);
    }

    pipe([
      from([contents]),
      outStream,
    ], assert);
  });

  it('passes the file descriptor to flush', function(done) {
    var flushCalled = false;

    var outStream = createWriteStream(outputPath, function(fd, cb) {
      expect(fd).toBeA('number');
      flushCalled = true;
      cb();
    });

    function assert(err) {
      expect(flushCalled).toEqual(true);
      done(err);
    }

    pipe([
      from([contents]),
      outStream,
    ], assert);
  });

  it('passes a callback to flush to call when work is done', function(done) {
    var flushCalled = false;
    var timeoutCalled = false;

    var outStream = createWriteStream(outputPath, function(fd, cb) {
      flushCalled = true;
      setTimeout(function() {
        timeoutCalled = true;
        cb();
      }, 250);
    });

    function assert(err) {
      expect(flushCalled).toEqual(true);
      expect(timeoutCalled).toEqual(true);
      done(err);
    }

    pipe([
      from([contents]),
      outStream,
    ], assert);
  });

  it('emits an error if open fails', function(done) {
    var badOutputPath = path.join(outputBase, './non-exist/test.coffee');

    function assert(err) {
      expect(err).toBeAn(Error);
      done();
    }

    pipe([
      from([contents]),
      createWriteStream(badOutputPath),
    ], assert);
  });

  it('emits an error if write fails', function(done) {
    // Create the file so it can be opened with `r`
    fs.writeFileSync(outputPath, contents);

    function assert(err) {
      expect(err).toBeAn(Error);
      done();
    }

    pipe([
      from([contents]),
      createWriteStream(outputPath, { flags: 'r' }),
    ], assert);
  });
});
