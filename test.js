var AJV = require('ajv')
var crypto = require('crypto')
var glob = require('glob')
var makeKeyPair = require('./crypto/make-key-pair')
var path = require('path')
var reduce = require('./reduce')
var runSeries = require('run-series')
var sign = require('./crypto/sign')
var tape = require('tape')
var verify = require('./crypto/verify')

tape('schemas', function (test) {
  var ajv = new AJV()
  glob('schemas/*.js', function (error, files) {
    test.ifError(error, 'no glob error')
    runSeries(files.map(function (file) {
      return function (done) {
        var schema = require(path.resolve(file))
        test.assert(
          ajv.validateSchema(schema),
          path.basename(file, '.js')
        )
        done()
      }
    }), test.end.bind(test))
  })
})

tape('test announcement', function (test) {
  var keyPair = makeKeyPair()
  var secretKey = keyPair.secretKey.toString('hex')
  var envelope = {
    publicKey: keyPair.publicKey.toString('hex'),
    message: {
      index: 0,
      date: new Date().toISOString(),
      body: {
        type: 'announce',
        uri: 'http://example.com'
      }
    }
  }
  sign({ envelope, secretKey })
  var ajv = new AJV()
  var schema = require('./schemas/envelope')
  ajv.validate(schema, envelope, 'validate')
  test.equal(ajv.errors, null)
  test.equal(verify(envelope), true, 'verify')
  test.end()
})

tape('reduce announcements', function (test) {
  var uri = 'http://example.com'
  testReduction(test, [
    { type: 'announce', uri }
  ], function (test, result) {
    test.equal(result.latestIndex, 0, 'latestIndex')
    test.deepEqual(result.uris, [uri], 'latestIndex')
    test.end()
  })
})

tape('reduce follow', function (test) {
  var publicKey = crypto.randomBytes(32).toString('hex')
  var firstName = 'first'
  var secondName = 'second'
  var start = 100
  var stop = 200
  testReduction(test, [
    { type: 'follow', publicKey, name: firstName, index: start },
    { type: 'follow', publicKey, name: secondName, index: start },
    { type: 'unfollow', publicKey, index: stop }
  ], function (test, result) {
    var expected = {}
    expected[publicKey] = {
      names: [firstName, secondName],
      starts: [start],
      stops: [stop]
    }
    test.deepEqual(result.following, expected, 'following record')
    test.end()
  })
})

function testReduction (test, bodies, verify) {
  var keyPair = makeKeyPair()
  var secretKey = keyPair.secretKey.toString('hex')
  var publicKey = keyPair.publicKey.toString('hex')
  var messages = bodies.map(function (body, index) {
    return { index, body, date: new Date().toISOString() }
  })
  var envelopes = messages.map(function (message) {
    var envelope = { publicKey, message }
    sign({ envelope, secretKey })
    return envelope
  })
  var result = {}
  runSeries(
    envelopes.map(function (envelope) {
      return function (done) {
        reduce(result, envelope, done)
      }
    }),
    function (error) {
      test.ifError(error, 'no error')
      verify(test, result)
    }
  )
}
