var sodium = require('sodium-universal')

module.exports = function () {
  var publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  var secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}
