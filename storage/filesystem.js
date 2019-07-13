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

prototype.write = function (envelope, callback) {
  assert(typeof envelope === 'object')
  assert(typeof callback === 'function')
  var self = this
  var publicKey = envelope.publicKey
  var index = envelope.message.index
  var file = this._messagePath(publicKey, index)
  var json = JSON.stringify(envelope)
  fs.writeFile(file, 'wf', json, function (error) {
    if (error) {
      if (error.code === 'EEXIST') {
        return self.conflict(envelope, callback)
      }
      return callback(error)
    }
    callback()
  })
}

prototype.read = function (options, callback) {
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
      if (file === 'conflict') return
      var parsed = parseInt(file)
      if (parsed > latest) latest = parsed
    })
    if (latest === -1) return callback(null, null)
    callback(null, latest)
  })
}

prototype.conflicted = function (publicKey, callback) {
  assert(typeof publicKey === 'string')
  assert(typeof callback === 'function')
  var file = this._conflictPath(publicKey)
  fs.readFile(file, function (error, content) {
    if (error) {
      if (error.code === 'ENOENT') return callback(null, null)
      else return callback(error)
    }
    callback(null, JSON.parse(content))
  })
}

prototype.conflict = function (envelope, callback) {
  assert(typeof envelope === 'object')
  assert(typeof callback === 'function')
  var publicKey = envelope.publicKey
  var file = this._conflictPath(publicKey)
  var json = JSON.stringify(envelope)
  fs.writeFile(file, 'wx', json, callback)
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

prototype._conflictPath = function (publicKey) {
  return path.join(this._feedPath(publicKey), 'conflict')
}
