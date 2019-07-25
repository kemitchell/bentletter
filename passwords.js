var assert = require('assert')

exports.validate = function (string) {
  assert(typeof string === 'string')

  var length = string.length
  return length >= 8 && length <= 128
}

exports.criteria = 'Passwords must be ' +
  'at least 8 characters, ' +
  'and no more than 128.'
