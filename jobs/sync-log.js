var AJV = require('ajv')
var verify = require('../crypto/verify')
var assert = require('assert')
var http = require('http')
var https = require('https')
var ndjson = require('ndjson')
var pump = require('pump')
var runSeries = require('run-series')
var through2 = require('through2')

var ajv = new AJV()
var validEnvelope = ajv.compile(require('../schemas/envelope'))

var protocols = {
  http: handleHTTP,
  https: handleHTTPS
}

module.exports = function (options, callback) {
  assert(typeof options === 'object')
  var log = options.log
  assert(typeof log === 'object')
  var storage = options.storage
  assert(typeof storage === 'object')
  var publicKey = options.publicKey
  assert(typeof publicKey === 'object')
  var uris = options.uris
  assert(typeof uris === 'object')
  assert(Array.isArray(uris))

  runSeries(
    uris.map(function (uri) {
      return function (done) {
        try {
          var parsed = new URL(uri)
        } catch (error) {
          log.error({ uri }, 'invalid URI')
          return done()
        }
        var protocol = parsed.protocol.replace(/:$/, '')
        var handler = protocols[protocol]
        if (!handler) return done()
        storage.head(publicKey, function (error, head) {
          if (error) {
            log.error(error)
            return done()
          }
          var handlerOptions = Object.assign(
            {}, options, { parsed, uri, head }
          )
          handler(handlerOptions, function (error) {
            if (error) {
              log.error(error)
              return done()
            }
            done()
          })
        })
      }
    }),
    callback
  )
}

function handleHTTP (options, callback) {
  handleHTTPX(http, options, callback)
}

function handleHTTPS (options, callback) {
  handleHTTPX(https, options, callback)
}

function handleHTTPX (protocol, options, callback) {
  var publicKey = options.publicKey
  var storage = options.storage
  pump(
    protocol.get(
      options.uri + '?head=' + options.head,
      { headers: { Accept: 'application/x-ndjson' } }
    ),
    ndjson.parse({ strict: true }),
    through2.obj(function (envelope, _, done) {
      if (!validEnvelope(envelope)) {
        return done(new Error('invalid envelope'))
      }
      if (envelope.publicKey !== publicKey) {
        return done(new Error('public key mismatch'))
      }
      if (!verify(envelope)) {
        return done(new Error('invalid signature'))
      }
      storage.append(envelope, done)
      done()
    }),
    callback
  )
}
