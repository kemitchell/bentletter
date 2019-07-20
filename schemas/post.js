var strictJSONObjectSchema = require('strict-json-object-schema')

module.exports = strictJSONObjectSchema({
  type: { const: 'post' },
  post: {
    type: 'array',
    content: {
      oneOf: [
        {
          type: 'string',
          minLength: 1
        },
        strictJSONObjectSchema({ publicKey: require('./public-key') })
      ]
    },
    minLength: 1
  }
})
