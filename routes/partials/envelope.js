var escapeHTML = require('escape-html')

module.exports = function (envelope, reduction) {
  var publicKey = envelope.publicKey
  var message = envelope.message
  var index = message.index
  var name = reduction.following[publicKey].name
  return `<li>${escapeHTML(name)} #${index}</li>`
}
