module.exports = function (byteLength) {
  return new RegExp('^[a-f0-9]{' + (byteLength * 2) + '}$')
}
