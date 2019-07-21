module.exports = require('strict-json-object-schema')({
  type: { const: 'introduction' },
  firstPublicKey: require('./public-key'),
  secondPublicKey: require('./public-key'),
  content: require('./content')
})
