var assert = require('nanoassert')
var fs = require('fs')
var path = require('path')
var rimraf = require('rimraf')

module.exports = FileSystem

function FileSystem (options) {
  assert(typeof options === 'object')
  assert(typeof options.directory === 'string')

  if (!(this instanceof FileSystem)) {
    return new FileSystem(options)
  }

  this._directory = options.directory
}

var prototype = FileSystem.prototype

prototype.put = function (envelope, callback) {
  assert(typeof envelope === 'object')
  assert(typeof callback === 'function')
  var publicKey = envelope.publicKey
  var index = envelope.message.index
  var file = this._messagePath(publicKey, index)
  fs.writeFile(file, JSON.stringify(envelope), callback)
}

prototype.get = function (options, callback) {
  assert(typeof options === 'object')
  assert(typeof options.publicKey === 'string')
  assert(Number.isSafeInteger(options.index))
  assert(typeof callback === 'function')
  var publicKey = options.publicKey
  var index = options.index
  var file = this._messagePath(publicKey, index)
  fs.readFile(file, function (error, buffer) {
    if (error) return callback(error)
    try {
      var parsed = JSON.parse(buffer)
    } catch (error) {
      return callback(error)
    }
    callback(null, parsed)
  })
}

prototype.latest = function (publicKey, callback) {
  assert(typeof publicKey === 'string')
  assert(typeof callback === 'function')
  var directory = this._feedPath(publicKey)
  fs.readdir(directory, function (error, files) {
    if (error) {
      if (error.code === 'ENOENT') return callback(null, null)
      else return callback(error)
    }
    var latest = -1
    files.forEach(function (file) {
      if (file === 'forked') return
      var parsed = parseInt(file)
      if (parsed > latest) latest = parsed
    })
    if (latest === -1) return callback(null, null)
    callback(null, latest)
  })
}

prototype.forked = function (publicKey, callback) {
  assert(typeof publicKey === 'string')
  assert(typeof callback === 'function')
  var file = this._forkPath(publicKey)
  fs.readFile(file, 'utf8', function (error, content) {
    if (error) {
      if (error.code === 'ENOENT') return callback(null, null)
      else return callback(error)
    }
    callback(null, parseInt(content))
  })
}

prototype.fork = function (options, callback) {
  assert(typeof options === 'object')
  assert(typeof options.publicKey === 'string')
  assert(typeof options.index === 'number')
  assert(Number.isSafeInteger(options.index))
  assert(options.index >= 0)
  assert(typeof callback === 'function')
  var publicKey = options.publicKey
  var index = options.index
  var file = this._forkPath(publicKey)
  fs.writeFile(file, index.toString(), callback)
}

prototype.drop = function (publicKey, callback) {
  assert(typeof publicKey === 'string')
  assert(typeof callback === 'function')
  var directory = this._feedPath(publicKey)
  rimraf(directory, callback)
}

// Path Helper Methods

prototype._feedPath = function (publicKey) {
  return path.join(this._directory, 'envelopes', publicKey)
}

prototype._messagePath = function (publicKey, index) {
  return path.join(this._feedPath(publicKey), index)
}

prototype._forkPath = function (publicKey) {
  return path.join(this._feedPath(publicKey), 'forked')
}
