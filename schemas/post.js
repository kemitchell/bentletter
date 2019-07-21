var strictJSONObjectSchema = require('strict-json-object-schema')

module.exports = strictJSONObjectSchema({
  type: { const: 'post' },
  content: require('./content')
})
