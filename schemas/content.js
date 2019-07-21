module.exports = {
  type: 'array',
  items: {
    oneOf: [
      {
        type: 'string',
        minLength: 1
      },
      require('strict-json-object-schema')({
        publicKey: require('./public-key')
      })
    ]
  },
  minLength: 1
}
