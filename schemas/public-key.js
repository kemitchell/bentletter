var sodium = require('sodium-universal')

module.exports = {
  type: 'string',
  pattern: (
    '^[a-f0-9]{' +
    (sodium.crypto_sign_PUBLICKEYBYTES * 2) +
    '}$'
  )
}
