var sodium = require('sodium-universal')
var stringify = require('./stringify')

module.exports = function (object) {
  var stringified = Buffer.from(stringify(object), 'utf8')
  var digest = Buffer.alloc(sodium.crypto_generichash_BYTES)
  sodium.crypto_generichash(digest, stringified)
  return digest
}
