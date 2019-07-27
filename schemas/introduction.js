module.exports = require('strict-json-object-schema')({
  type: { const: 'introduction' },
  firstPublicKey: require('./public-key'),
  firstURI: require('./uri'),
  secondPublicKey: require('./public-key'),
  secondURI: require('./uri'),
  content: require('./content')
})
