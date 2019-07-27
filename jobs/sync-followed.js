var concat = require('../concat')
var flushWriteStream = require('flush-write-stream')
var from2Array = require('from2-array')
var pump = require('pump')
var through2 = require('through2')

exports.name = 'sync'

exports.cron = '*/10 * * * *' // every ten minutes

exports.handler = function (storage, log, callback) {
  // Fetch all account emails and store them in memory.
  concat(storage.createAccountsStream(), function (error, emails) {
    if (error) return callback()
    // Track logs that we have already synchronized.
    var alreadySynced = new Set()
    // Build a list of all account public keys in memory.
    var accountPublicKeys = new Set()
    pump(
      from2Array.obj(emails),
      through2.obj(function (email, _, done) {
        storage.account(email, function (error, account) {
          if (error) {
            log.error(error, { email })
            return done()
          }
          accountPublicKeys.add(account.publicKey)
          done()
        })
      }),
      function (error) {
        if (error) {
          log.error(error)
          return callback()
        }
        // Sync logs that accounts follow.
        pump(
          from2Array.obj(Array.from(accountPublicKeys)),

          through2.obj(function accountReduction (publicKey, _, done) {
            storage.reduction(publicKey, eatErrors(done))
          }),

          through2.obj(function followed (reduction, _, done) {
            if (typeof reduction.following !== 'object') return done()
            var stream = this
            Object.keys(reduction).forEach(function (followed) {
              stream.push(followed)
            })
            done()
          }),

          through2.obj(function followedReduction (followed, _, done) {
            storage.reduction(followed, function (error, reduction) {
              if (error) {
                log.error(error, followed)
                return done()
              }
              done(null, { publicKey: followed, reduction })
            })
          }),

          flushWriteStream.obj(function sync (object, _, done) {
            var uris = object.reduction.uris
            var publicKey = object.publicKey
            if (!Array.isArray(uris)) return done()
            if (alreadySynced.has(publicKey)) return done()
            alreadySynced.add(publicKey)
            var syncLog = log.child({ subsystem: 'sync', publicKey })
            syncLog({ storage, log: syncLog, uris }, function (error) {
              if (error) {
                log.error(error, { publicKey })
                return done()
              }
              done()
            })
          })
        )
      },
      callback
    )
  })

  function eatErrors (done) {
    return function (error, result) {
      if (error) {
        log.error(error)
        return done()
      }
      done(null, result)
    }
  }
}
