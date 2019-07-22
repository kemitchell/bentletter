var AJV = require('ajv')
var makeKeyPair = require('../crypto/make-key-pair')
var sign = require('../crypto/sign')
var tape = require('tape')
var verify = require('../crypto/verify')

tape('announcement', function (test) {
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
  var schema = require('../schemas/envelope')
  ajv.validate(schema, envelope, 'validate')
  test.equal(ajv.errors, null)
  test.equal(verify(envelope), true, 'verify')
  test.end()
})
