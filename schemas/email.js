var strictJSONObjectSchema = require('strict-json-object-schema')

module.exports = strictJSONObjectSchema({
  type: { const: 'email' },
  addresses: {
    type: 'array',
    items: strictJSONObjectSchema({
      address: {
        type: 'string',
        pattern: 'email'
      },
      label: {
        type: 'string',
        maxLength: 256
      }
    })
  }
})
