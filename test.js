var AJV = require('ajv')
var glob = require('glob')
var makeKeyPair = require('./crypto/make-key-pair')
var path = require('path')
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
