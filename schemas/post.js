module.exports = {
  type: 'object',
  properties: {
    type: { const: 'post' },
    content: require('./content'),
    parent: require('strict-json-object-schema')({
      publicKey: require('./public-key'),
      index: require('./index')
    })
  },
  required: ['type', 'content'],
  additionalProperties: false
}
