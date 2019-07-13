var assert = require('nanoassert')
var sodium = require('sodium-universal')
var stringify = require('./stringify')

module.exports = function (options) {
  assert(typeof options === 'object')
  assert(typeof options.envelope === 'object')
  assert(typeof options.secretKey === 'string')
  var envelope = options.envelope
  var secretKey = Buffer.from(options.secretKey, 'hex')
  var stringified = Buffer.from(stringify(envelope.message), 'utf8')
  var signature = Buffer.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(signature, stringified, secretKey)
  envelope.signature = signature.toString('hex')
}
