var Storage = require('../storage')
var deepEqual = require('deep-equal')
var encodingDown = require('encoding-down')
var hash = require('../crypto/hash')
var makeKeyPair = require('../crypto/make-key-pair')
var memdown = require('memdown')
var runSeries = require('run-series')
var sign = require('../crypto/sign')
var tape = require('tape')

tape('storage', function (test) {
  var storage = new Storage({ leveldown: encodingDown(memdown()) })
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
  runSeries([
    function appendFirst (done) {
      storage.append(envelopes[0], function (error) {
        test.ifError(error, 'no append error')
        done()
      })
    },
    function appendSecond (done) {
      storage.append(envelopes[1], function (error) {
        test.ifError(error, 'no append error')
        done()
      })
    },
    function list (done) {
      var publicKeys = []
      storage.createPublicKeysStream()
        .on('data', function (publicKey) {
          publicKeys.push(publicKey)
        })
        .once('end', function () {
          test.deepEqual(publicKeys, [publicKey], 'lists public key')
          done()
        })
    },
    function stream (done) {
      var read = []
      storage.createLogStream(publicKey)
        .on('data', function (envelope) {
          read.push(envelope)
        })
        .once('end', function () {
          test.deepEqual(read[0], envelopes[0], 'stream first')
          test.deepEqual(read[1], envelopes[1], 'stream second')
          done()
        })
    },
    function reverseStream (done) {
      var read = []
      storage.createReverseLogStream(publicKey)
        .on('data', function (envelope) {
          read.push(envelope)
        })
        .once('end', function () {
          test.deepEqual(read[0], envelopes[1], 'reverse stream first')
          test.deepEqual(read[1], envelopes[0], 'reverse stream second')
          done()
        })
    },
    function streamFollowers (done) {
      var read = []
      storage.createFollowersStream(otherPublicKey)
        .on('data', function (follower) {
          read.push(follower)
        })
        .once('end', function () {
          test.equal(read[0].publicKey, publicKey)
          done()
        })
    },
    checkReduction,
    function checkRereduction (done) {
      storage.rereduce(publicKey, function (error) {
        if (error) return done(error)
        checkReduction(done)
      })
    }
  ], function () {
    storage.close()
    test.end()
  })

  function checkReduction (done) {
    storage.reduction(publicKey, function (error, reduction) {
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

tape('storage conflict', function (test) {
  var storage = new Storage({ leveldown: encodingDown(memdown()) })
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
  var digests = envelopes
    .map(hash)
    .map(function (digest) {
      return digest.toString('hex')
    })
  runSeries([
    function appendFirst (done) {
      storage.append(envelopes[0], function (error) {
        test.ifError(error, 'no append error')
        done()
      })
    },
    function appendSecond (done) {
      storage.append(envelopes[1], function (error) {
        test.equal(error.message, 'conflict')
        done()
      })
    },
    function checkConflicts (done) {
      var conflicts = []
      storage.createConflictsStream(publicKey)
        .on('data', function (conflict) {
          conflicts.push(conflict)
        })
        .on('end', function () {
          test.equal(conflicts.length, 1, 'one conflict')
          test.equal(conflicts[0].existingDigest, digests[0], 'first digest')
          test.equal(conflicts[0].conflictingDigest, digests[1], 'second digest')
          done()
        })
    }
  ], function () {
    storage.close()
    test.end()
  })
})

tape('timeline and mentions', function (test) {
  var charlieKeyPair = makeKeyPair()
  var anna = {
    keyPair: makeKeyPair(),
    messages: [
      {
        index: 0,
        date: new Date('2019-01-01').toISOString(),
        body: { type: 'post', content: ['first post'] }
      },
      {
        index: 1,
        date: new Date('2019-01-03').toISOString(),
        body: {
          type: 'post',
          content: [
            'Anna\'s second post',
            { publicKey: charlieKeyPair.publicKey.toString('hex') }
          ]
        }
      },
      {
        index: 2,
        date: new Date('2019-01-05').toISOString(),
        body: { type: 'post', content: ['third post'] }
      }
    ]
  }
  var bob = {
    keyPair: makeKeyPair(),
    messages: [
      {
        index: 0,
        date: new Date('2019-01-02').toISOString(),
        body: { type: 'post', content: ['first post'] }
      },
      {
        index: 1,
        date: new Date('2019-01-04').toISOString(),
        body: {
          type: 'post',
          content: [
            'Bob\'s second post',
            { publicKey: charlieKeyPair.publicKey.toString('hex') }
          ]
        }
      },
      {
        index: 2,
        date: new Date('2019-01-06').toISOString(),
        body: { type: 'post', content: ['third post'] }
      }
    ]
  }
  var charlie = {
    keyPair: charlieKeyPair,
    messages: [
      {
        index: 0,
        date: new Date('2019-02-01').toISOString(),
        body: {
          type: 'follow',
          name: 'anna',
          publicKey: anna.keyPair.publicKey.toString('hex')
        }
      },
      {
        index: 1,
        date: new Date('2019-02-02').toISOString(),
        body: {
          type: 'unfollow',
          publicKey: anna.keyPair.publicKey.toString('hex'),
          index: 0
        }
      },
      {
        index: 2,
        date: new Date('2019-02-03').toISOString(),
        body: {
          type: 'follow',
          name: 'bob',
          publicKey: bob.keyPair.publicKey.toString('hex')
        }
      },
      {
        index: 3,
        date: new Date('2019-02-04').toISOString(),
        body: {
          type: 'unfollow',
          publicKey: bob.keyPair.publicKey.toString('hex'),
          index: 1
        }
      }
    ]
  }
  var players = [anna, bob, charlie]
  players.forEach(function (player, playerIndex) {
    var publicKey = player.keyPair.publicKey.toString('hex')
    var secretKey = player.keyPair.secretKey.toString('hex')
    player.publicKey = publicKey
    player.envelopes = player.messages.map(function (message) {
      var envelope = { publicKey, message }
      sign({ envelope, secretKey })
      return envelope
    })
  })
  test.comment('anna: ' + anna.publicKey.slice(0, 4))
  test.comment('bob: ' + bob.publicKey.slice(0, 4))
  test.comment('charlie: ' + charlie.publicKey.slice(0, 4))
  var storage = new Storage({ leveldown: encodingDown(memdown()) })
  var allEnvelopes = players.reduce(function (envelopes, player) {
    return envelopes.concat(player.envelopes)
  }, [])
  runSeries(
    allEnvelopes.map(function (envelope) {
      return function (done) {
        storage.append(envelope, done)
      }
    }),
    function () {
      runSeries([
        function testTimeline (done) {
          var timeline = []
          storage.createTimelineStream(charlie.publicKey)
            .on('data', function (envelope) {
              timeline.push(envelope)
            })
            .once('end', function () {
              var expecting = []
                .concat(anna.envelopes.slice(0, 1))
                .concat(bob.envelopes.slice(0, 2))
              expecting.forEach(function (expected) {
                test.assert(
                  timeline.some(function (timelineEnvelope) {
                    return deepEqual(expected, timelineEnvelope)
                  })
                )
              })
              test.equal(timeline.length, expecting.length, 'length')
              var sortedByDate = timeline.sort(function (a, b) {
                var aDate = new Date(a.message.date)
                var bDate = new Date(b.message.date)
                return aDate - bDate
              })
              test.deepEqual(timeline, sortedByDate)
              done()
            })
        },
        function testMentions (done) {
          var mentions = []
          storage.createMentionsStream(charlie.publicKey)
            .on('data', function (envelope) {
              mentions.push(envelope)
            })
            .once('end', function () {
              test.deepEqual(mentions, [bob.envelopes[1]], 'mentions')
              var sortedByDate = mentions.sort(function (a, b) {
                var aDate = new Date(a.message.date)
                var bDate = new Date(b.message.date)
                return aDate - bDate
              })
              test.deepEqual(mentions, sortedByDate)
              done()
            })
        }
      ], function () {
        storage.close()
        test.end()
      })
    }
  )
})

tape('replies', function (test) {
  var keyPair = makeKeyPair()
  var publicKey = keyPair.publicKey.toString('hex')
  var secretKey = keyPair.secretKey.toString('hex')
  var messages = [
    {
      index: 0,
      date: new Date('2019-01-01').toISOString(),
      body: {
        type: 'post',
        content: ['parent']
      }
    },
    {
      index: 1,
      date: new Date('2019-01-03').toISOString(),
      body: {
        type: 'post',
        content: ['reply'],
        parent: { publicKey, index: 0 }
      }
    }
  ]
  var envelopes = messages.map(function (message) {
    var envelope = { publicKey, message }
    sign({ envelope, secretKey })
    return envelope
  })
  var storage = new Storage({ leveldown: encodingDown(memdown()) })
  runSeries(
    envelopes.map(function (envelope) {
      return function (done) {
        storage.append(envelope, done)
      }
    }),
    function (error) {
      test.ifError(error, 'no append error')
      var replies = []
      storage.createRepliesStream(publicKey, 0)
        .on('data', function (envelope) {
          replies.push(envelope)
        })
        .once('end', function () {
          test.equal(replies.length, 1, 'one reply')
          var reply = replies[0]
          test.deepEqual(reply, { publicKey, index: 1 }, 'reply matches')
          storage.read(
            reply.publicKey, reply.index,
            function (error, read) {
              test.ifError(error, 'no read error')
              test.deepEqual(read, envelopes[1], 'read')
              storage.close()
              test.end()
            }
          )
        })
    }
  )
})
