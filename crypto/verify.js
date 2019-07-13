var assert = require('nanoassert')
var sodium = require('sodium-universal')
var stringify = require('./stringify')

module.exports = function (envelope) {
  assert(typeof envelope === 'object')
  assert(typeof envelope.message === 'object')
  var publicKey = Buffer.from(envelope.publicKey, 'hex')
  var stringified = Buffer.from(stringify(envelope.message), 'utf8')
  var signature = Buffer.from(envelope.signature, 'hex')
  return sodium.crypto_sign_verify_detached(
    signature, stringified, publicKey
  )
}
