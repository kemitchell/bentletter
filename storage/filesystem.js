var BlockStream = require('block-stream')
var DIGEST_LENGTH = require('../crypto/digest-length')
var DIGEST_RE = require('../crypto/public-key-re')
var PUBLIC_KEY_RE = require('../crypto/public-key-re')
var assert = require('nanoassert')
var flushWriteStream = require('flush-write-stream')
var from2 = require('from2')
var fs = require('fs')
var hash = require('../crypto/hash')
var mkdirp = require('mkdirp')
var path = require('path')
var pump = require('pump')
var reduce = require('../reduce')
var rimraf = require('rimraf')
var runSeries = require('run-series')
var runWaterfall = require('run-waterfall')
var through2 = require('through2')

var lock = require('lock').Lock()

module.exports = FileSystem

function FileSystem (options) {
  assert(typeof options === 'object')
  assert(typeof options.directory === 'string')

  if (!(this instanceof FileSystem)) {
    return new FileSystem(options)
  }

  this._directory = options.directory
  this.maxClockSkew = options.maxClockSkew || (1000 * 60)
}

var prototype = FileSystem.prototype

/*

Layout:

/envelopes/{digest} -> JSON

  contents of an envelope

/publishers/{publicKey}/log -> [digest...]

  list of digests in ascending index order

/publishers/{publicKey}/conflicts -> [[digest,digest]...]

  list of pairs of conflicting envelope digests

/publishers/{publicKey}/reduction -> JSON

  contents of the current reduction

*/

// Append an envelope to its log and update the log's reduction.
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
        self.head(publicKeyHex, function (headError, head) {
          if (headError) return done(headError)
          if (index === head + 1) {
            runSeries([
              function checkAgainstPrior (done) {
                if (index === 0) return done()
                var priorIndex = index - 1
                self.read(
                  publicKeyHex, priorIndex,
                  function (readError, prior, priorDigestBuffer) {
                    if (readError) return done(readError)
                    var nextDate = new Date(envelope.message.date)
                    var priorDate = new Date(prior.message.date)
                    if (priorDate >= nextDate) {
                      var dateError = new Error('date')
                      dateError.priorIndex = head
                      dateError.priorDigestBuffer = priorDigestBuffer
                      dateError.priorDate = priorDate
                      dateError.nextIndex = index
                      dateError.nextDigestBuffer = digestBuffer
                      dateError.nextDate = nextDate
                      return done(dateError)
                    } else {
                      var now = new Date()
                      var difference = now.getTime() - nextDate.getTime()
                      if (difference > self._maxClockSkew) {
                        var clockError = new Error('future')
                        clockError.date = nextDate
                        clockError.now = now
                        clockError.maxClockSkew = self._maxClockSkew
                        return done(clockError)
                      }
                      done()
                    }
                  }
                )
              },
              function writeFile (done) {
                mkdirp(path.dirname(logFile), function (error) {
                  if (error) return done(error)
                  fs.writeFile(
                    logFile, digestBuffer, { flag: 'a' }, done
                  )
                })
              },
              function updateReduction (done) {
                runWaterfall([
                  function readCurrent (done) {
                    if (index === 0) return done(null, {})
                    self.reduction(publicKeyHex, done)
                  },
                  function overwrite (reduction, done) {
                    reduce(
                      reduction, envelope,
                      function (error) {
                        if (error) return done(error)
                        fs.writeFile(
                          self._reductionPath(publicKeyHex),
                          JSON.stringify(reduction),
                          done
                        )
                      }
                    )
                  }
                ], done)
              }
            ], done)
          } else if (index <= head) {
            self._readDigest(
              publicKeyHex, index,
              function (readError, existingDigestBuffer) {
                if (readError) return done(readError)
                if (!existingDigestBuffer.equals(digestBuffer)) {
                  return self._conflict(
                    publicKeyHex,
                    existingDigestBuffer,
                    digestBuffer,
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
          } else {
            var gapError = new Error('gap')
            gapError.head = head
            gapError.index = index
            done(gapError)
          }
        })
      })
    }
  ], function (error) {
    if (error) return callback(error)
    callback()
  })
}

// Read an envelope from a log by index.
prototype.read = function (publicKeyHex, index, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
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

// Stream a log's envelopes in ascending-index order.
prototype.createStream = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  var self = this
  var logFile = this._logPath(publicKeyHex)
  return pump(
    fs.createReadStream(logFile),
    new BlockStream(DIGEST_LENGTH),
    through2.obj(function (digestBuffer, _, done) {
      self._readEnvelope(
        digestBuffer.toString('hex'),
        function (error, envelope) {
          if (error) return done(error)
          done(null, { digest: digestBuffer, envelope })
        }
      )
    })
  )
}

// Stream a log's envelopes in decending-index order.
prototype.createReverseStream = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  var self = this
  var nextIndex = null
  return from2.obj(function (_, done) {
    runSeries([
      function readHead (done) {
        if (nextIndex !== null) return done()
        self.head(publicKeyHex, function (error, head) {
          if (error) {
            if (error.code === 'ENOENT') return done(null, null)
            return done(error)
          }
          nextIndex = head
          done()
        })
      },
      function readNext (done) {
        if (nextIndex < 0) return done(null, null)
        self.read(
          publicKeyHex, nextIndex,
          function (error, envelope, digestBuffer) {
            if (error) return done(error)
            nextIndex--
            done(null, { digest: digestBuffer, envelope })
          }
        )
      }
    ], function (error, result) {
      if (error) return done(error)
      done(null, result[1])
    })
  })
}

// Read a log's head index.
prototype.head = function (publicKeyHex, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
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

// Read a log's conflicts.
prototype.conflicts = function (publicKeyHex, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof callback === 'function')
  var file = this._conflictsPath(publicKeyHex)
  fs.readFile(file, function (error, contents) {
    if (error) {
      if (error.code === 'ENOENT') return callback(null, false)
      return callback(error)
    }
    var conflicts = []
    for (var offset = 0; offset < contents.length; offset += (DIGEST_LENGTH * 2)) {
      conflicts.push([
        contents.slice(offset, offset + DIGEST_LENGTH),
        contents.slice(offset + DIGEST_LENGTH, offset + (DIGEST_LENGTH * 2))
      ])
    }
    callback(null, conflicts)
  })
}

// Read a log's reduction.
prototype.reduction = function (publicKeyHex, callback) {
  var reductionFile = this._reductionPath(publicKeyHex)
  fs.readFile(reductionFile, function (error, buffer) {
    if (error) {
      if (error.code === 'ENOENT') return callback(null, {})
      return callback(error)
    }
    try {
      var reduction = JSON.parse(buffer)
    } catch (error) {
      return callback(error)
    }
    callback(null, reduction)
  })
}

// Recompute a log's reduction.
prototype.rereduce = function (publicKeyHex, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  var self = this
  var reduction = {}
  pump(
    self.createStream(publicKeyHex),
    flushWriteStream.obj(function (chunk, _, done) {
      reduce(reduction, chunk.envelope, done)
    }),
    function (error) {
      if (error) return callback(error)
      fs.writeFile(
        self._reductionPath(publicKeyHex),
        JSON.stringify(reduction),
        callback
      )
    }
  )
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

// Delete all data about a log.
prototype.drop = function (publicKey, callback) {
  assert(typeof publicKey === 'string')
  assert(typeof callback === 'function')
  var directory = this._feedPath(publicKey)
  rimraf(directory, callback)
}

// List public keys of stored logs.
prototype.list = function (callback) {
  assert(typeof callback === 'function')
  var publishersPath = this._publishersPath()
  fs.readdir(
    publishersPath, { withFileTypes: true },
    function (error, entries) {
      if (error) return callback(error)
      callback(null, entries.reduce(function (result, entry) {
        var name = entry.name
        return entry.isDirectory() && PUBLIC_KEY_RE.test(name)
          ? result.concat(name)
          : result
      }, []))
    }
  )
}

// Path Helper Methods

prototype._envelopesPath = function () {
  return path.join(this._directory, 'envelopes')
}

prototype._envelopePath = function (digestHex) {
  assert(typeof digestHex === 'string')
  assert(DIGEST_RE.test(digestHex))
  return path.join(this._envelopesPath(), digestHex)
}

prototype._publishersPath = function () {
  return path.join(this._directory, 'publishers')
}

prototype._publisherPath = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  return path.join(this._publishersPath(), publicKeyHex)
}

prototype._logPath = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  return path.join(this._publisherPath(publicKeyHex), 'log')
}

prototype._conflictsPath = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  return path.join(this._publisherPath(publicKeyHex), 'conflicts')
}

prototype._reductionPath = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  return path.join(this._publisherPath(publicKeyHex), 'reduction')
}
