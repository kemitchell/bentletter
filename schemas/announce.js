var strictJSONObjectSchema = require('strict-json-object-schema')

module.exports = strictJSONObjectSchema({
  type: { const: 'announce' },
  uri: require('./uri')
})
