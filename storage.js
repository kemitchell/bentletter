var DIGEST_RE = require('./crypto/public-key-re')
var PUBLIC_KEY_RE = require('./crypto/public-key-re')
var assert = require('assert')
var flushWriteStream = require('flush-write-stream')
var has = require('has')
var hash = require('./crypto/hash')
var levelup = require('levelup')
var lexint = require('lexicographic-integer')
var lock = require('lock').Lock()
var mentionsInEnvelope = require('./mentions-in-envelope')
var parseJSON = require('json-parse-errback')
var pump = require('pump')
var reduce = require('./reduce')
var runParallel = require('run-parallel')
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

- CONFLICTS/{Hex publicKey}/{Hex digest}@{Hex digest} -> Date seen

- DIGESTS/{Hex digest} -> JSON [ publicKeyHex, index ]

- LOGS/{Hex public key}/{LexInt index} -> JSON envelope

- PUBLIC_KEYS/{Hex public key} -> Date seen

- REDUCTIONS/{Hex public key} -> JSON reduction

- FOLLOWERS/{Hex public key}/{Hex public key} -> optional Number stop

- TIMELINES/{Hex public key}/{ISO8601 date}@{Hex public key} -> JSON envelope

- MENTIONS/{Hex public key}/{ISO8601 date}@{Hex public key} -> JSON envelope

- REPLIES/{Hex public key}@{LexInt index}/{Hex public key}@{LexInt index}

- ACCOUNTS/{e-mail} -> JSON object

- SESSIONS/{id} -> JSON object

- SESSIONS/{id} -> JSON object

*/

// Storage Key Prefixes

var ACCOUNTS = 'accounts'
var CONFLICTS = 'conflicts'
var DIGESTS = 'digests'
var FOLLOWERS = 'followers'
var LOGS = 'logs'
var MENTIONS = 'mentions'
var PUBLIC_KEYS = 'publicKeys'
var REDUCTIONS = 'reductions'
var REPLIES = 'replies'
var SESSIONS = 'sessions'
var TIMELINES = 'timelines'
var TOKENS = 'tokens'

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
  var body = envelope.message.body
  var message = envelope.message
  var date = message.date
  var digestBuffer = hash(envelope)
  var digestHex = digestBuffer.toString('hex')
  var reduction

  runSeries([
    saveAndIndex,
    copyNewlyFollowedEnvelopes,
    deleteNewlyUnfollowedEnvelopes
  ], callback)

  function saveAndIndex (done) {
    lock(publicKeyHex, function (unlock) {
      done = unlock(done)
      self.head(publicKeyHex, function (error, head) {
        /* istanbul ignore if */
        if (error) return done(error)
        if (index === head + 1) handleExpectedEntry()
        else if (index <= head) handleOldEntry()
        else handleFutureEntry()

        function handleExpectedEntry () {
          runSeries([
            checkAgainstPriorEntry,
            writeEntryAndUpdateReduction
          ], done)

          function checkAgainstPriorEntry (done) {
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
          }

          function writeEntryAndUpdateReduction (done) {
            var batch = synchronousIndexOperations(envelope, digestHex)
            runWaterfall([
              function readCurrentReduction (done) {
                if (index === 0) return done(null, {})
                self.reduction(publicKeyHex, done)
              },
              function updatedReduction (currentReduction, done) {
                reduce(currentReduction, envelope, function (error) {
                  if (error) return done(error)
                  done(null, currentReduction)
                })
              },
              function writeUpdatedReduction (updatedReduction, done) {
                reduction = updatedReduction
                self._batchForReduction(
                  reduction, envelope,
                  function (error, forReduction) {
                    if (error) return done(error)
                    forReduction.forEach(function (operation) {
                      batch.push(operation)
                    })
                    batch.push({
                      type: 'put',
                      key: reductionKey(publicKeyHex),
                      value: JSON.stringify(reduction)
                    })
                    done(null, batch)
                  }
                )
              }
            ], function (error, batch) {
              if (error) return done(error)
              db.batch(batch, done)
            })
          }
        }

        function handleOldEntry () {
          self.read(
            publicKeyHex, index,
            function (error, existing) {
              /* istanbul ignore if */
              if (error) return done(error)
              var existingDigestHex = hash(existing).toString('hex')
              if (existingDigestHex !== digestHex) {
                var key = (
                  `${CONFLICTS}/${publicKeyHex}/` +
                  `${existingDigestHex}@${digestHex}`
                )
                var value = JSON.stringify({
                  existing: existing,
                  conflicting: envelope
                })
                return db.put(key, value, function (error) {
                  if (error) return done(error)
                  var conflictError = new Error('conflict')
                  conflictError.firstDigestHex = existingDigestHex
                  conflictError.secondDigestHex = digestHex
                  done(conflictError)
                })
              }
              var existsError = new Error('exists')
              existsError.exists = true
              return done(existsError)
            }
          )
        }

        function handleFutureEntry () {
          var gapError = new Error('gap')
          gapError.head = head
          gapError.index = index
          done(gapError)
        }
      })
    })
  }

  function copyNewlyFollowedEnvelopes (done) {
    if (body.type !== 'follow') return done()
    var followed = body.publicKey
    var stopped = (
      has(reduction, 'following') &&
      has(reduction.following[followed], 'stop')
    )
    if (stopped) return done()
    pump(
      self.createLogStream(followed),
      flushWriteStream.obj(function (envelope, _, done) {
        var batch = []
        var keyArguments = [
          publicKeyHex, date, followed, envelope.message.index
        ]
        var value = JSON.stringify(envelope)
        // Copy to timeline.
        batch.push({
          type: 'put',
          key: timelineKey.apply(null, keyArguments),
          value
        })
        // If mentioned, copy to mentions.
        if (mentionedIn(publicKeyHex, envelope)) {
          batch.push({
            type: 'put',
            key: mentionKey.apply(null, keyArguments),
            value
          })
        }
        db.batch(batch, done)
      }),
      done
    )
  }

  function deleteNewlyUnfollowedEnvelopes (done) {
    if (envelope.message.body.type !== 'unfollow') return done()
    var unfollowed = envelope.message.body.publicKey
    var stopped = (
      has(reduction, 'following') &&
      has(reduction.following[unfollowed], 'stop')
    )
    if (!stopped) return done()
    var stop = reduction.following[unfollowed].stop
    var batch = []
    var stream = db.createReadStream({
      gt: `${TIMELINES}/${publicKeyHex}/`,
      lt: `${TIMELINES}/${publicKeyHex}/~`,
      keys: true,
      values: true,
      reverse: true
    })
      .once('error', function (error) {
        stream.destroy()
        done(error)
      })
      .on('data', function (entry) {
        parseJSON(entry.value, function (error, envelope) {
          if (error) {
            stream.destroy()
            return done(error)
          }
          if (envelope.publicKey !== unfollowed) return
          if (envelope.message.index > stop) {
            batch.push({ type: 'del', key: entry.key })
            if (mentionedIn(publicKeyHex, envelope)) {
              batch.push({
                type: 'del',
                key: entry.key.replace(`${TIMELINES}/`, `${MENTIONS}/`)
              })
            }
          } else {
            stream.destroy()
            finish()
          }
        })
      })
      .once('end', finish)
    function finish () {
      db.batch(batch, done)
    }
  }
}

var sychronousIndexers = [
  function digest (envelope, digestHex) {
    return [
      {
        type: 'put',
        key: digestKey(digestHex),
        value: JSON.stringify([
          envelope.publicKey, envelope.message.index
        ])
      }
    ]
  },

  function entry (envelope) {
    return [
      {
        type: 'put',
        key: entryKey(envelope.publicKey, envelope.message.index),
        value: JSON.stringify(envelope)
      }
    ]
  },

  function publicKey (envelope) {
    return [
      {
        type: 'put',
        key: `${PUBLIC_KEYS}/${envelope.publicKey}`,
        value: new Date().toISOString()
      }
    ]
  },

  function reply (envelope) {
    var body = envelope.message.body
    if (body.type === 'post' && has(body, 'parent')) {
      var parent = body.parent
      return [
        {
          type: 'put',
          key: replyKey(
            parent.publicKey, parent.index,
            envelope.publicKey, envelope.message.index
          ),
          value: ''
        }
      ]
    }
  }
]

function synchronousIndexOperations (envelope, digestHex) {
  return sychronousIndexers.reduce(function (batch, indexer) {
    return batch.concat(indexer(envelope, digestHex) || [])
  }, [])
}

function mentionedIn (publicKeyHex, envelope) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof envelope === 'object')
  return mentionsInEnvelope(envelope).some(function (mention) {
    return mention.publicKey === publicKeyHex
  })
}

prototype._batchForReduction = function (
  reduction, envelope, callback
) {
  assert(typeof reduction === 'object')
  assert(typeof envelope === 'object')
  assert(typeof callback === 'function')

  var message = envelope.message
  var self = this
  var batch = []
  var mentions = mentionsInEnvelope(envelope)
  var sender = envelope.publicKey

  // Append operations for follow and unfollow.
  if (has(reduction, 'following')) {
    var following = reduction.following
    mentions.forEach(function (mention) {
      if (
        mention.type === 'follow' ||
        mention.type === 'unfollow'
      ) {
        Object.keys(following).forEach(function (followed) {
          batch.push({
            type: 'put',
            key: followKey(followed, envelope.publicKey),
            value: JSON.stringify(following[followed])
          })
        })
      }
    })
  }

  runParallel([
    function appendToTimelines (done) {
      pump(
        self.createFollowersStream(sender),
        flushWriteStream.obj(function (follower, _, done) {
          var withinRange = (
            !has(follower, 'stop') ||
            follower.stop <= message.index
          )
          if (withinRange) {
            batch.push({
              type: 'put',
              key: timelineKey(
                follower.publicKey,
                message.date,
                sender,
                message.index
              ),
              value: JSON.stringify(envelope)
            })
          }
          done()
        }),
        done
      )
    },
    function appendToMentions (done) {
      runParallel(
        mentions.map(function (mention) {
          return function (done) {
            var recipient = mention.publicKey
            self.reduction(recipient, function (error, reduction) {
              if (error) return done(error)
              if (!reduction) return done()
              var following = (
                has(reduction, 'following') &&
                has(reduction.following, sender) &&
                (
                  !has(reduction.following[sender], 'stop') ||
                  reduction.following[sender].stop <= message.index
                )
              )
              if (following) {
                batch.push({
                  type: 'put',
                  key: mentionKey(
                    recipient, message.date, sender, message.index
                  ),
                  value: JSON.stringify(envelope)
                })
              }
              done()
            })
          }
        }),
        done
      )
    }
  ], function (error) {
    if (error) return callback(error)
    callback(null, batch)
  })
}

prototype._updateReduction = function (publicKeyHex, reduction, callback) {
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
      values: true
    }),
    through2.obj(function (entry, _, done) {
      parseJSON(entry.value, function (error, parsed) {
        if (error) return done(error)
        var digests = entry.key.split('/')[2].split('@')
        parsed.existingDigest = digests[0]
        parsed.conflictingDigest = digests[1]
        done(null, parsed)
      })
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

// Stream followers.
prototype.createFollowersStream = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))

  return pump(
    this._db.createReadStream({
      gt: `${FOLLOWERS}/${publicKeyHex}/`,
      lt: `${FOLLOWERS}/${publicKeyHex}/~`,
      keys: true,
      values: true
    }),
    through2.obj(function (entry, _, done) {
      parseJSON(entry.value, function (error, parsed) {
        if (error) return done(error)
        done(null, {
          publicKey: entry.key.split('/')[2],
          name: parsed.name,
          stop: parsed.stop
        })
      })
    })
  )
}

// Stream timeline in reverse chronological order.
prototype.createTimelineStream = function (publicKeyHex, direction) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))

  return pump(
    this._db.createReadStream({
      gt: `${TIMELINES}/${publicKeyHex}/`,
      lt: `${TIMELINES}/${publicKeyHex}/~`,
      keys: false,
      values: true,
      reverse: direction === 'reverse'
    }),
    through2.obj(function (json, _, done) {
      parseJSON(json, done)
    })
  )
}

// Stream mentions in reverse chronological order.
prototype.createMentionsStream = function (publicKeyHex) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))

  return pump(
    this._db.createReadStream({
      gt: `${MENTIONS}/${publicKeyHex}/`,
      lt: `${MENTIONS}/${publicKeyHex}/~`,
      keys: false,
      values: true,
      reverse: true
    }),
    through2.obj(function (json, _, done) {
      parseJSON(json, done)
    })
  )
}

// Stream children of (replies to) a post.
prototype.createRepliesStream = function (publicKeyHex, index) {
  assert(typeof publicKeyHex === 'string')
  assert(PUBLIC_KEY_RE.test(publicKeyHex))
  assert(typeof index === 'number')
  assert(Number.isSafeInteger(index))
  assert(index >= 0)

  var encodedIndex = encodeIndex(index)
  return pump(
    this._db.createReadStream({
      gt: `${REPLIES}/${publicKeyHex}@${encodedIndex}/`,
      lt: `${REPLIES}/${publicKeyHex}@${encodedIndex}/~`,
      keys: true,
      values: false
    }),
    through2.obj(function (key, _, done) {
      var parsed = key.split('/').slice(1)[1].split('@')
      done(null, {
        publicKey: parsed[0],
        index: decodeIndex(parsed[1])
      })
    })
  )
}

// Stream accounts.
prototype.createAccountsStream = function () {
  return pump(
    this._db.createReadStream({
      gt: `${ACCOUNTS}/`,
      lt: `${ACCOUNTS}/~`,
      keys: true,
      values: false
    }),
    through2.obj(function (key, _, done) {
      done(null, key.split('/')[1])
    })
  )
}

// Authentication Interface

prototype.account = function (email, callback) {
  assert(typeof email === 'string')
  assert(typeof callback === 'function')

  this._db.get(
    accountKey(email),
    nullForNotFound(callback, function (json) {
      parseJSON(json, callback)
    })
  )
}

prototype.writeAccount = function (email, data, callback) {
  assert(typeof email === 'string')
  assert(typeof data === 'object')
  assert(typeof callback === 'function')

  this._db.put(
    accountKey(email),
    JSON.stringify(data),
    callback
  )
}

prototype.deleteAccount = function (email, callback) {
  assert(typeof email === 'string')
  assert(typeof callback === 'function')

  this._db.del(`${ACCOUNTS}/${email}`, callback)
}

prototype.session = function (sessionID, callback) {
  assert(typeof sessionID === 'string')
  assert(typeof callback === 'function')

  this._db.get(
    sessionKey(sessionID),
    nullForNotFound(callback, function (json) {
      parseJSON(json, callback)
    })
  )
}

prototype.writeSession = function (sessionID, data, callback) {
  assert(typeof sessionID === 'string')
  assert(typeof data === 'object')
  assert(typeof callback === 'function')

  this._db.put(
    sessionKey(sessionID),
    JSON.stringify(data),
    callback
  )
}

prototype.deleteSession = function (sessionID, callback) {
  assert(typeof sessionID === 'string')
  assert(typeof callback === 'function')

  this._db.del(sessionKey(sessionID), callback)
}

prototype.token = function (tokenID, callback) {
  assert(typeof tokenID === 'string')
  assert(typeof callback === 'function')

  this._db.get(
    tokenKey(tokenID),
    nullForNotFound(callback, function (json) {
      parseJSON(json, callback)
    })
  )
}

prototype.writeToken = function (tokenID, data, callback) {
  assert(typeof tokenID === 'string')
  assert(typeof data === 'object')
  assert(typeof callback === 'function')

  this._db.put(
    tokenKey(tokenID),
    JSON.stringify(data),
    callback
  )
}

prototype.deleteToken = function (tokenID, callback) {
  assert(typeof tokenID === 'string')
  assert(typeof callback === 'function')

  this._db.del(tokenKey(tokenID), callback)
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
        self._updateReduction(
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

function encodeIndex (index) {
  assert(typeof index === 'number')
  assert(Number.isSafeInteger(index))
  assert(index >= 0)

  return lexint.pack(index, 'hex')
}

function decodeIndex (hex) {
  assert(typeof hex === 'string')
  return lexint.unpack(hex, 'hex')
}

function followKey (followed, following) {
  assert(typeof followed === 'string')
  assert(PUBLIC_KEY_RE.test(followed))
  assert(typeof following === 'string')
  assert(PUBLIC_KEY_RE.test(following))

  return `${FOLLOWERS}/${followed}/${following}`
}

function timelineKey (recipient, date, sender, index) {
  assert(typeof recipient === 'string')
  assert(PUBLIC_KEY_RE.test(recipient))
  assert(typeof sender === 'string')
  assert(PUBLIC_KEY_RE.test(sender))

  return `${TIMELINES}/${recipient}/${date}@${sender}@${encodeIndex(index)}`
}

function mentionKey (recipient, date, sender, index) {
  assert(typeof recipient === 'string')
  assert(PUBLIC_KEY_RE.test(recipient))
  assert(typeof sender === 'string')
  assert(PUBLIC_KEY_RE.test(sender))

  return `${MENTIONS}/${recipient}/${date}@${sender}@${encodeIndex(index)}`
}

function replyKey (parentPublicKey, parentIndex, childPublicKey, childIndex) {
  assert(typeof parentPublicKey === 'string')
  assert(PUBLIC_KEY_RE.test(parentPublicKey))
  assert(typeof parentIndex === 'number')
  assert(Number.isSafeInteger(parentIndex))
  assert(parentIndex >= 0)
  assert(typeof childPublicKey === 'string')
  assert(PUBLIC_KEY_RE.test(childPublicKey))
  assert(typeof childIndex === 'number')
  assert(Number.isSafeInteger(childIndex))
  assert(childIndex >= 0)

  return (
    REPLIES +
    `/${parentPublicKey}@${encodeIndex(parentIndex)}` +
    `/${childPublicKey}@${encodeIndex(childIndex)}`
  )
}

function accountKey (email) {
  assert(typeof email === 'string')

  return `${ACCOUNTS}/${email}`
}

function sessionKey (id) {
  assert(typeof id === 'string')
  assert(DIGEST_RE.test(id))

  return `${SESSIONS}/${id}`
}

function tokenKey (id) {
  assert(typeof id === 'string')
  assert(DIGEST_RE.test(id))

  return `${TOKENS}/${id}`
}
