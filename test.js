var AJV = require('ajv')
var crypto = require('crypto')
var deepEqual = require('deep-equal')
var glob = require('glob')
var hash = require('./crypto/hash')
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
  var start = 100
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

var FileSystem = require('./storage/filesystem')
var fs = require('fs')
var os = require('os')
var rimraf = require('rimraf')

tape('file system storage', function (test) {
  fs.mkdtemp(path.join(os.tmpdir(), 'bentletter'), function (error, directory) {
    test.ifError(error)
    var keyPair = makeKeyPair()
    var secretKey = keyPair.secretKey.toString('hex')
    var publicKey = keyPair.publicKey.toString('hex')
    var otherKeyPair = makeKeyPair()
    var otherPublicKey = otherKeyPair.publicKey.toString('hex')
    var messages = [
      {
        index: 0,
        date: new Date(Date.now() - 3000).toISOString(),
        body: {
          type: 'follow',
          name: 'Anne',
          publicKey: otherPublicKey,
          index: 0
        }
      },
      {
        index: 1,
        date: new Date().toISOString(),
        body: {
          type: 'unfollow',
          publicKey: otherPublicKey,
          index: 1
        }
      }
    ]
    var envelopes = messages.map(function (message) {
      var envelope = { publicKey, message }
      sign({ envelope, secretKey })
      return envelope
    })
    var fileSystem = new FileSystem({ directory })
    runSeries([
      function appendFirst (done) {
        fileSystem.append(envelopes[0], function (error) {
          test.ifError(error, 'no append error')
          done()
        })
      },
      function appendSecond (done) {
        fileSystem.append(envelopes[1], function (error) {
          test.ifError(error, 'no append error')
          done()
        })
      },
      function list (done) {
        fileSystem.list(function (error, publicKeys) {
          if (error) return done(error)
          test.deepEqual(publicKeys, [publicKey], 'lists public key')
          done()
        })
      },
      function stream (done) {
        var read = []
        fileSystem.createStream(publicKey)
          .on('data', function (envelope) {
            read.push(envelope)
          })
          .once('end', function () {
            test.deepEqual(read[0].envelope, envelopes[0], 'stream first')
            test.deepEqual(read[1].envelope, envelopes[1], 'stream second')
            done()
          })
      },
      function reverseStream (done) {
        var read = []
        fileSystem.createReverseStream(publicKey)
          .on('data', function (envelope) {
            read.push(envelope)
          })
          .once('end', function () {
            test.deepEqual(read[0].envelope, envelopes[1], 'reverse stream first')
            test.deepEqual(read[1].envelope, envelopes[0], 'reverse stream second')
            done()
          })
      },
      checkReduction,
      function checkRereduction (done) {
        fileSystem.rereduce(publicKey, function (error) {
          if (error) return done(error)
          checkReduction(done)
        })
      }
    ], function () {
      rimraf(directory, function () { })
      test.end()
    })
    function checkReduction (done) {
      fileSystem.reduction(publicKey, function (error, reduction) {
        if (error) return done(error)
        test.equal(reduction.latestIndex, envelopes[1].message.index, 'reduction latest index')
        test.equal(reduction.latestDate, envelopes[1].message.date, 'reduction latest date')
        test.deepEqual(
          reduction.following[otherPublicKey],
          { name: 'Anne', stop: 1 },
          'following Anne'
        )
        done()
      })
    }
  })
})

tape('file system storage conflict', function (test) {
  fs.mkdtemp(path.join(os.tmpdir(), 'bentletter'), function (error, directory) {
    test.ifError(error)
    var keyPair = makeKeyPair()
    var secretKey = keyPair.secretKey.toString('hex')
    var publicKey = keyPair.publicKey.toString('hex')
    var messages = [
      {
        index: 0,
        date: new Date(Date.now() - 3000).toISOString(),
        body: { type: 'follow', name: 'self', publicKey, index: 0 }
      },
      {
        index: 0,
        date: new Date().toISOString(),
        body: { type: 'unfollow', publicKey, index: 1 }
      }
    ]
    var envelopes = messages.map(function (message) {
      var envelope = { publicKey, message }
      sign({ envelope, secretKey })
      return envelope
    })
    var digests = envelopes.map(hash)
    var fileSystem = new FileSystem({ directory })
    runSeries([
      function appendFirst (done) {
        fileSystem.append(envelopes[0], function (error) {
          test.ifError(error, 'no append error')
          done()
        })
      },
      function appendSecond (done) {
        fileSystem.append(envelopes[1], function (error) {
          test.equal(error.message, 'conflict')
          done()
        })
      },
      function checkConflicts (done) {
        fileSystem.conflicts(publicKey, function (error, conflicts) {
          if (error) return done(error)
          test.equal(conflicts.length, 1, 'one conflict')
          test.assert(digests[0].equals(conflicts[0][0]))
          test.assert(digests[1].equals(conflicts[0][1]))
          done()
        })
      }
    ], function () {
      rimraf(directory, function () { })
      test.end()
    })
  })
})

tape.skip('timeline', function (test) {
  var anna = {
    keyPair: makeKeyPair(),
    bodies: [
      { type: 'post', content: ['first post'] },
      { type: 'post', content: ['second post'] },
      { type: 'post', content: ['third post'] }
    ]
  }
  var bob = {
    keyPair: makeKeyPair(),
    bodies: [
      { type: 'post', content: ['first post'] },
      { type: 'post', content: ['second post'] },
      { type: 'post', content: ['third post'] }
    ]
  }
  var charlie = {
    keyPair: makeKeyPair(),
    bodies: [
      {
        type: 'follow',
        name: 'anna',
        publicKey: anna.keyPair.publicKey.toString('hex')
      },
      {
        type: 'unfollow',
        publicKey: anna.keyPair.publicKey.toString('hex'),
        index: 1
      },
      {
        type: 'follow',
        name: 'bob',
        publicKey: bob.keyPair.publicKey.toString('hex')
      },
      {
        type: 'unfollow',
        publicKey: bob.keyPair.publicKey.toString('hex'),
        index: 2
      }
    ]
  }
  var players = [anna, bob, charlie]
  players.forEach(function (player, playerIndex) {
    var backdate = new Date('2019-01-01')
    var publicKey = player.keyPair.publicKey.toString('hex')
    var secretKey = player.keyPair.secretKey.toString('hex')
    player.publcKey = publicKey
    player.envelopes = player.bodies.map(function (body, bodyIndex) {
      var date = new Date(
        backdate.getTime() +
        (bodyIndex * 60000) +
        (playerIndex * 1000)
      )
        .toISOString()
      var message = { index: bodyIndex, date, body }
      var envelope = { publicKey, message }
      sign({ envelope, secretKey })
      return envelope
    })
  })

  fs.mkdtemp(path.join(os.tmpdir(), 'bentletter'), function (error, directory) {
    test.ifError(error)
    var fileSystem = new FileSystem({ directory })
    var allEnvelopes = players.reduce(function (envelopes, player) {
      return envelopes.concat(player.envelopes)
    }, [])
    runSeries(
      allEnvelopes.map(function (envelope) {
        return function (done) {
          fileSystem.append(envelope, done)
        }
      }),
      function () {
        fileSystem.timeline(
          {
            publicKey: anna.publicKey,
            start: new Date(),
            limit: 100
          },
          function (error, timeline) {
            test.ifError(error)
            var expecting = []
              .concat(anna.envelopes.slice(0, 1))
              .concat(bob.envelopes.slice(0, 2))
            expecting.every(function (logEnvelope) {
              test.assert(
                timeline.some(function (timelineEnvelope) {
                  return deepEqual(logEnvelope, timelineEnvelope)
                })
              )
            })
            var sortedByDate = timeline.sort(function (a, b) {
              var aDate = new Date(a.message.date)
              var bDate = new Date(b.message.date)
              return aDate - bDate
            })
            test.deepEqual(timeline, sortedByDate)
            rimraf(directory, function () { })
            test.end()
          }
        )
      }
    )
  })
})
