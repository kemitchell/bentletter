var DIGEST_LENGTH = require('../crypto/digest-length')
var assert = require('nanoassert')
var fs = require('fs')
var hash = require('../crypto/hash')
var mkdirp = require('mkdirp')
var path = require('path')
var rimraf = require('rimraf')
var runSeries = require('run-series')

var lock = require('lock').Lock()

module.exports = FileSystem

function FileSystem (options) {
  assert(typeof options === 'object')
  assert(typeof options.directory === 'string')

  if (!(this instanceof FileSystem)) {
    return new FileSystem(options)
  }

  this._directory = options.directory
}

var prototype = FileSystem.prototype

prototype.append = function (envelope, callback) {
  assert(typeof envelope === 'object')
  assert(typeof callback === 'function')
  var self = this
  var publicKeyHex = envelope.publicKey
  var index = envelope.message.index
  var digestBuffer = hash(envelope)
  var digestHex = digestBuffer.toString('hex')

  runSeries([
    function writeEnvelope (done) {
      var file = self._envelopePath(digestHex)
      runSeries([
        function (done) {
          mkdirp(path.dirname(file), done)
        },
        function (done) {
          fs.writeFile(
            file,
            JSON.stringify(envelope),
            { flag: 'wx' }, // error if exists
            function (error) {
              if (error) {
                if (error.code === 'EEXIST') {
                  return done(new Error('Hash Collission: ' + digestHex))
                }
                return done(error)
              }
              done()
            }
          )
        }
      ], done)
    },

    function appendToLog (done) {
      var logFile = self._logPath(publicKeyHex)
      lock(logFile, function (unlock) {
        done = unlock(done)
        self._head(publicKeyHex, function (headError, head) {
          if (headError) return done(headError)
          if (index <= head) {
            self._readDigest(
              publicKeyHex, index,
              function (readError, existingDigestBuffer) {
                if (readError) return done(readError)
                if (!existingDigestBuffer.equals(digestBuffer)) {
                  return self._conflict(
                    publicKeyHex,
                    digestBuffer,
                    existingDigestBuffer,
                    function (writeError) {
                      if (writeError) return done(writeError)
                      var conflictError = new Error('conflict')
                      conflictError.firstDigest = existingDigestBuffer
                      conflictError.secondDigest = digestBuffer
                      done(conflictError)
                    }
                  )
                }
                return done(new Error('exists'))
              }
            )
          } else if (head > index + 1) {
            var gapError = new Error('gap')
            gapError.head = head
            gapError.index = index
            done(gapError)
          } else {
            mkdirp(path.dirname(logFile), function (error) {
              if (error) return done(error)
              fs.writeFile(logFile, digestBuffer, { flag: 'a' }, done)
            })
          }
        })
      })
    },

    function appendToTimeline (done) {
      // TODO
      done()
    }
  ], function (error) {
    if (error) return callback(error)
    callback()
  })
}

prototype.read = function (publicKeyHex, index, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(Number.isSafeInteger(index) && index >= 0)
  assert(typeof callback === 'function')
  var self = this
  self._readDigest(publicKeyHex, index, function (error, digest) {
    if (error) return callback(error)
    self._readEnvelope(digest.toString('hex'), function (error, envelope) {
      if (error) return callback(error)
      callback(null, envelope, digest)
    })
  })
}

prototype._readDigest = function (publicKey, index, callback) {
  var logFile = this._logPath(publicKey)
  fs.open(logFile, 'r', function (error, fd) {
    if (error) {
      if (error.code === 'EEXIST') return callback(null, null)
      return callback(error)
    }
    var digest = Buffer.alloc(DIGEST_LENGTH)
    var position = DIGEST_LENGTH * index
    fs.read(fd, digest, 0, DIGEST_LENGTH, position, function (readError, read) {
      if (readError) {
        return fs.close(fd, function (closeError) {
          callback(readError)
        })
      }
      fs.close(fd, function (closeError) {
        if (closeError) return callback(closeError)
        callback(null, digest)
      })
    })
  })
}

prototype._readEnvelope = function (digest, callback) {
  var file = this._envelopePath(digest)
  fs.readFile(file, function (error, buffer) {
    if (error) return callback(error)
    try {
      var parsed = JSON.parse(buffer)
    } catch (error) {
      return callback(error)
    }
    callback(null, parsed)
  })
}

prototype._head = function (publicKeyHex, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(typeof callback === 'function')
  var file = this._logPath(publicKeyHex)
  fs.stat(file, function (error, stats) {
    if (error) {
      if (error.code === 'ENOENT') return callback(null, -1)
      return callback(error)
    }
    callback(null, (stats.size / DIGEST_LENGTH) - 1)
  })
}

prototype.conflicted = function (publicKeyHex, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(typeof callback === 'function')
  var file = this._conflictsPath(publicKeyHex)
  fs.readFile(file, function (error, contents) {
    if (error) {
      if (error.code === 'ENOENT') return callback(null, false)
      return callback(error)
    }
    var conflicts = []
    for (var offset = 0; offset < contents.length; offset += DIGEST_LENGTH * 2) {
      conflicts.push([
        contents.slice(offset, DIGEST_LENGTH),
        contents.slice(offset + DIGEST_LENGTH, DIGEST_LENGTH)
      ])
    }
    callback(null, conflicts)
  })
}

prototype._conflict = function (publicKeyHex, firstDigest, secondDigest, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(Buffer.isBuffer(firstDigest))
  assert(Buffer.isBuffer(secondDigest))
  assert(typeof callback === 'function')
  var file = this._conflictsPath(publicKeyHex)
  var entry = Buffer.concat([firstDigest, secondDigest])
  fs.writeFile(file, entry, { flag: 'a' }, callback)
}

prototype.drop = function (publicKey, callback) {
  assert(typeof publicKey === 'string')
  assert(typeof callback === 'function')
  var directory = this._feedPath(publicKey)
  rimraf(directory, callback)
}

// Path Helper Methods

prototype._envelopePath = function (digest) {
  return path.join(this._envelopesPath(), digest)
}

prototype._envelopesPath = function () {
  return path.join(this._directory, 'envelopes')
}

prototype._publisherPath = function (publicKey) {
  return path.join(this._directory, 'publishers', publicKey)
}

prototype._logPath = function (publicKey) {
  return path.join(this._publisherPath(publicKey), 'log')
}

prototype._timelinePath = function (publicKey) {
  return path.join(this._publisherPath(publicKey), 'timeline')
}

prototype._conflictsPath = function (publicKey) {
  return path.join(this._publisherPath(publicKey), 'conflicts')
}
