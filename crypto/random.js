var sodium = require('sodium-universal')

module.exports = function (bytes) {
  var returned = Buffer.alloc(bytes)
  sodium.randombytes_buf(returned)
  return returned
}
