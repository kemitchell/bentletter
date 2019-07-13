var strictJSONObjectSchema = require('strict-json-object-schema')

module.exports = strictJSONObjectSchema({
  index: require('./index'),
  date: {
    type: 'string',
    format: 'date-time'
  },
  body: require('./body')
})
