var message = require('./message')
var sodium = require('sodium-universal')
var strictJSONObjectSchema = require('strict-json-object-schema')

module.exports = strictJSONObjectSchema({
  publicKey: require('./public-key'),
  signature: {
    type: 'string',
    pattern: (
      '^[a-f0-9]{' +
      (sodium.crypto_sign_BYTES * 2) +
      '}$'
    )
  },
  message
})
