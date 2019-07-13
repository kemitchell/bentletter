var strictJSONObjectSchema = require('strict-json-object-schema')

module.exports = strictJSONObjectSchema({
  type: { const: 'unfollow' },
  publicKey: require('./public-key'),
  index: require('./index')
})
