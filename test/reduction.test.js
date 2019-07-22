var crypto = require('crypto')
var makeKeyPair = require('../crypto/make-key-pair')
var reduce = require('../reduce')
var runSeries = require('run-series')
var sign = require('../crypto/sign')
var tape = require('tape')

tape('reduce announcements', function (test) {
  var uri = 'http://example.com'
  testReduction(test, [
    { type: 'announce', uri },
    { type: 'announce', uri }
  ], function (test, result) {
    test.equal(result.latestIndex, 1, 'latestIndex')
    test.deepEqual(result.uris, [uri], 'latestIndex')
    test.end()
  })
})

tape('reduce follow', function (test) {
  var publicKey = crypto.randomBytes(32).toString('hex')
  var firstName = 'first'
  var secondName = 'second'
  var stop = 200
  testReduction(test, [
    { type: 'follow', publicKey, name: firstName },
    { type: 'follow', publicKey, name: secondName },
    { type: 'unfollow', publicKey, index: stop }
  ], function (test, result) {
    var expected = {}
    expected[publicKey] = { name: secondName, stop }
    test.deepEqual(result.following, expected, 'following record')
    test.end()
  })
})

tape('reduce unfollow without follow', function (test) {
  var publicKey = crypto.randomBytes(32).toString('hex')
  var stop = 200
  testReduction(test, [
    { type: 'unfollow', publicKey, index: stop }
  ], function (test, result) {
    test.deepEqual(result.following, undefined, 'no following')
    test.end()
  })
})

tape('reduce with date continuity error', function (test) {
  var keyPair = makeKeyPair()
  var secretKey = keyPair.secretKey.toString('hex')
  var publicKey = keyPair.publicKey.toString('hex')
  var today = new Date()
  var yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  var messages = [
    {
      index: 0,
      date: today,
      body: { type: 'announce', uri: 'http://example.com' }
    },
    {
      index: 1,
      date: yesterday,
      body: { type: 'announce', uri: 'http://example.com' }
    }
  ]
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
      var message = 'Message 1 is dated earlier than message 0.'
      test.equal(error.message, message, 'error message')
      test.end()
    }
  )
})

tape('reduce self-follow and self-unfollow', function (test) {
  var keyPair = makeKeyPair()
  var secretKey = keyPair.secretKey.toString('hex')
  var publicKey = keyPair.publicKey.toString('hex')
  var messages = [
    {
      index: 0,
      date: new Date().toISOString(),
      body: { type: 'follow', name: 'self', publicKey }
    },
    {
      index: 1,
      date: new Date().toISOString(),
      body: { type: 'unfollow', publicKey, index: 1 }
    }
  ]
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
      test.equal(result.following, undefined, 'no following')
      test.end()
    }
  )
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
  var reduction = {}
  runSeries(
    envelopes.map(function (envelope) {
      return function (done) {
        reduce(reduction, envelope, done)
      }
    }),
    function (error) {
      test.ifError(error, 'no error')
      verify(test, reduction)
    }
  )
}
