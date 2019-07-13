var strictJSONObjectSchema = require('strict-json-object-schema')

module.exports = strictJSONObjectSchema({
  type: { const: 'follow' },
  publicKey: require('./public-key'),
  name: {
    type: 'string',
    minLength: 1
  },
  index: require('./index')
})
