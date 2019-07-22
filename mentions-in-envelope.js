var has = require('has')

// Given an envelope, return an array of all
// the public keys mentioned by it.
module.exports = function (envelope) {
  var returned = []
  var message = envelope.message
  var body = message.body
  if (has(body, 'content')) {
    body.content.forEach(function (element) {
      if (!has(element, 'content')) return
      element.content.forEach(function (element) {
        returned.push({
          type: 'content',
          publicKey: element.publicKey
        })
      })
    })
  }
  var type = body.type
  if (type === 'introduction') {
    returned.push({
      type: 'introduction',
      publicKey: message.firstPublicKey
    })
    returned.push({
      type: 'introduction',
      publicKey: message.secondPublicKey
    })
  } else if (type === 'follow' || type === 'unfollow') {
    returned.push({ type, publicKey: body.publicKey })
  }
  return returned
}
