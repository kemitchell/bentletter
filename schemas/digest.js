var DIGEST_LENGTH = require('../crypto/digest-length')

module.exports = {
  type: 'string',
  pattern: '^[a-f0-9]{' + (DIGEST_LENGTH * 2) + '}$'
}
