module.exports = require('strict-json-object-schema')({
  type: { const: 'avatar' },
  uri: {
    type: 'string',
    pattern: 'uri'
  }
})
