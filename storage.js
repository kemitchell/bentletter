var DIGEST_RE = require('./crypto/public-key-re')
var PUBLIC_KEY_RE = require('./crypto/public-key-re')
var assert = require('assert')
var flushWriteStream = require('flush-write-stream')
var hash = require('./crypto/hash')
var levelup = require('levelup')
var lexint = require('lexicographic-integer')
var lock = require('lock').Lock()
var parseJSON = require('json-parse-errback')
var pump = require('pump')
var reduce = require('./reduce')
var runSeries = require('run-series')
var runWaterfall = require('run-waterfall')
var through2 = require('through2')

module.exports = Storage

function Storage (options) {
  assert(typeof options === 'object')
  assert(typeof options.leveldown === 'object')

  /* istanbul ignore if */
  if (!(this instanceof Storage)) {
    return new Storage(options)
  }

  this._db = levelup(options.leveldown)
}

/*

Storage Layout:

- CONFLICTS/{Hex publicKey}/{Hex digest}:{Hex digest} -> Date seen

- DIGESTS/{Hex digest} -> JSON [ publicKeyHex, index ]

- LOGS/{Hex public key}/{LexInt index} -> JSON envelope

- PUBLIC_KEYS/{Hex public key} -> Date seen

- REDUCTIONS/{Hex public key} -> JSON reduction

*/

// Storage Key Prefixes

var CONFLICTS = 'conflicts'
var DIGESTS = 'digests'
var LOGS = 'logs'
var PUBLIC_KEYS = 'publicKeys'
var REDUCTIONS = 'reductions'

// Methods

var prototype = Storage.prototype

prototype.close = function (optionalCallback) {
  this._db.close(optionalCallback)
}

// Log Entry Methods

// Append an envelope entry to a log.
prototype.append = function (envelope, callback) {
  assert(typeof envelope === 'object')
  assert(typeof callback === 'function')

  var self = this
  var db = this._db
  var publicKeyHex = envelope.publicKey
  var index = envelope.message.index
  var digestBuffer = hash(envelope)
  var digestHex = digestBuffer.toString('hex')

  runSeries([
    writeDigest,
    appendToLog
  ], callback)

  function writeDigest (done) {
    db.put(
      digestKey(digestHex),
      JSON.stringify([publicKeyHex, index]),
      done
    )
  }

  function appendToLog (done) {
    lock(publicKeyHex, function (unlock) {
      done = unlock(done)
      self.head(publicKeyHex, function (error, head) {
        /* istanbul ignore if */
        if (error) return done(error)
        if (index === head + 1) {
          runSeries([
            function checkAgainstPrior (done) {
              if (index === 0) return done()
              var priorIndex = index - 1
              self.read(
                publicKeyHex, priorIndex,
                function (error, prior) {
                  /* istanbul ignore if */
                  if (error) return done(error)
                  var nextDate = new Date(envelope.message.date)
                  var priorDate = new Date(prior.message.date)
                  if (priorDate >= nextDate) {
                    var dateError = new Error('date')
                    var priorDigestBuffer = hash(prior)
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
            function writeEntry (done) {
              var batch = [
                {
                  type: 'put',
                  key: entryKey(publicKeyHex, index),
                  value: JSON.stringify(envelope)
                }
              ]
              if (index === 0) {
                batch.push({
                  type: 'put',
                  key: `${PUBLIC_KEYS}/${publicKeyHex}`,
                  value: new Date().toISOString()
                })
              }
              db.batch(batch, done)
            },
            function overwriteReduction (done) {
              runWaterfall([
                function readCurrent (done) {
                  if (index === 0) return done(null, {})
                  self.reduction(publicKeyHex, done)
                },
                function overwrite (reduction, done) {
                  reduce(
                    reduction, envelope,
                    function (error) {
                      /* istanbul ignore if */
                      if (error) return done(error)
                      self._overwriteReduction(
                        publicKeyHex, reduction, done
                      )
                    }
                  )
                }
              ], done)
            }
          ], done)
        } else if (index <= head) {
          self.read(
            publicKeyHex, index,
            function (error, existing) {
              /* istanbul ignore if */
              if (error) return done(error)
              var existingDigestHex = hash(existing).toString('hex')
              if (existingDigestHex !== digestHex) {
                return self._conflict(
                  publicKeyHex,
                  existingDigestHex,
                  digestHex,
                  function (error) {
                    /* istanbul ignore if */
                    if (error) return done(error)
                    var conflictError = new Error('conflict')
                    conflictError.firstDigestHex = existingDigestHex
                    conflictError.secondDigestHex = digestHex
                    done(conflictError)
                  }
                )
              }
              var existsError = new Error('exists')
              existsError.exists = true
              return done(existsError)
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
}

prototype._conflict = function (
  publicKeyHex, firstDigestHex, secondDigestHex, callback
) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof firstDigestHex === 'string')
  assert(DIGEST_RE.test(firstDigestHex))
  assert(typeof secondDigestHex === 'string')
  assert(DIGEST_RE.test(secondDigestHex))
  assert(typeof callback === 'function')

  var sorted = [firstDigestHex, secondDigestHex].sort()
  this._db.put(
    `${CONFLICTS}/${publicKeyHex}/${sorted[0]}:${sorted[1]}`,
    new Date().toISOString(),
    callback
  )
}

prototype._overwriteReduction = function (publicKeyHex, reduction, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof reduction === 'object')
  assert(typeof callback === 'function')

  this._db.put(
    reductionKey(publicKeyHex),
    JSON.stringify(reduction),
    callback
  )
}

// Read the highest index of a log.
prototype.head = function (publicKeyHex, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof callback === 'function')

  this._db.createKeyStream({
    reverse: true,
    gt: `${LOGS}/${publicKeyHex}/`,
    lt: `${LOGS}/${publicKeyHex}/~`,
    limit: 1
  })
    .once('data', function (key) {
      var index = lexint.unpack(key.split('/')[2], 'hex')
      this.destroy()
      callback(null, index)
    })
    .once('end', function () {
      callback(null, -1)
    })
}

// Read a specific log entry.
prototype.read = function (publicKeyHex, index, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof index === 'number')
  assert(Number.isSafeInteger(index))
  assert(index >= 0)
  assert(typeof callback === 'function')

  this._db.get(
    entryKey(publicKeyHex, index),
    nullForNotFound(callback, function (json) {
      parseJSON(json, callback)
    })
  )
}

// Streaming Interface

// Stream the entries of a log in ascending-index order.
prototype.createLogStream = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))

  var self = this
  return pump(
    self._db.createReadStream({
      gt: `${LOGS}/${publicKeyHex}/`,
      lt: `${LOGS}/${publicKeyHex}/~`,
      keys: false,
      values: true
    }),
    through2.obj(function (json, _, done) {
      parseJSON(json, done)
    })
  )
}

// Stream the entries of a log in reverse-index order.
prototype.createReverseLogStream = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))

  var self = this
  return pump(
    self._db.createReadStream({
      gt: `${LOGS}/${publicKeyHex}/`,
      lt: `${LOGS}/${publicKeyHex}/~`,
      keys: false,
      values: true,
      reverse: true
    }),
    through2.obj(function (json, _, done) {
      parseJSON(json, done)
    })
  )
}

// Stream conflicting entries to a log.
prototype.createConflictsStream = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))

  return pump(
    this._db.createReadStream({
      gt: `${CONFLICTS}/${publicKeyHex}/`,
      lt: `${CONFLICTS}/${publicKeyHex}/~`,
      keys: true,
      values: false
    }),
    through2.obj(function (key, _, done) {
      done(null, key.split('/')[2].split(':'))
    })
  )
}

// Stream log public keys.
prototype.createPublicKeysStream = function () {
  return pump(
    this._db.createReadStream({
      gt: `${PUBLIC_KEYS}/`,
      lt: `${PUBLIC_KEYS}/~`,
      keys: true,
      values: false
    }),
    through2.obj(function (key, _, done) {
      done(null, key.split('/')[1])
    })
  )
}

// Reduction Interface

// Read the reduction of a log.
prototype.reduction = function (publicKeyHex, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof callback === 'function')

  this._db.get(
    reductionKey(publicKeyHex),
    nullForNotFound(callback, function (json) {
      parseJSON(json, callback)
    })
  )
}

// Recoputer the reduction of a log.
prototype.rereduce = function (publicKeyHex, callback) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof callback === 'function')

  var self = this
  var reduction = {}
  lock(publicKeyHex, function (unlock) {
    callback = unlock(callback)
    pump(
      self.createLogStream(publicKeyHex),
      flushWriteStream.obj(function (envelope, _, done) {
        reduce(reduction, envelope, done)
      }),
      function (error) {
        /* istanbul ignore if */
        if (error) return callback(error)
        self._overwriteReduction(
          publicKeyHex, reduction, callback
        )
      }
    )
  })
}

// Helper Functions

function nullForNotFound (done, optionalHandler) {
  return function (error, result) {
    if (error) {
      /* istanbul ignore else */
      if (error.notFound) return done(null, null)
      else return done(error)
    }
    /* istanbul ignore else */
    if (optionalHandler) optionalHandler(result)
    else done(null, result)
  }
}

function entryKey (publicKeyHex, index) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof index === 'number')
  assert(Number.isSafeInteger(index))
  assert(index >= 0)

  return `${LOGS}/${publicKeyHex}/${encodeIndex(index)}`
}

function digestKey (digestHex) {
  assert(typeof digestHex === 'string')
  assert(DIGEST_RE.test(digestHex))

  return `${DIGESTS}/${digestHex}`
}

function reductionKey (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))

  return `${REDUCTIONS}/${publicKeyHex}`
}

/*
function decodeIndex (hex) {
  assert(typeof hex === 'string')
  return lexint.unpack(hex, 'hex')
}
*/

function encodeIndex (index) {
  assert(typeof index === 'number')
  assert(Number.isSafeInteger(index))
  assert(index >= 0)

  return lexint.pack(index, 'hex')
}
