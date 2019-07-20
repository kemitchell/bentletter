var assert = require('nanoassert')
var has = require('has')

module.exports = function (reduction, envelope, callback) {
  assert(typeof reduction === 'object')
  assert(typeof envelope === 'object')
  assert(typeof callback === 'function')

  var message = envelope.message
  var publicKey = envelope.publicKey
  var index = message.index
  var dateString = message.date
  var body = message.body
  var type = body.type
  var ranges

  if (!has(reduction, 'latestIndex') || reduction.latestIndex < index) {
    var latestDate = reduction.latestDate
    var date = new Date(dateString)
    if (date < latestDate) {
      var error = new Error(
        'Message ' + index + ' is dated earlier than ' +
        'message ' + reduction.latestIndex + '.'
      )
      error.first = reduction.latestIndex
      error.second = index
      return callback(error)
    }
    reduction.latestIndex = index
    reduction.latestDate = date
  }

  if (type === 'follow') {
    var followingPublicKey = body.publicKey
    if (followingPublicKey === publicKey) return callback()
    var startIndex = body.index
    var name = body.name
    if (!has(reduction, 'following')) reduction.following = {}
    if (!has(reduction.following, followingPublicKey)) {
      reduction.following[followingPublicKey] = {
        names: [],
        ranges: []
      }
    }
    var record = reduction.following[followingPublicKey]
    pushToArraySet(record.names, name)
    ranges = record.ranges
    var canStart = ranges.every(function (range) {
      return (
        has(range, 'start') &&
        has(range, 'stop') &&
        !withinRange(startIndex, range)
      )
    })
    if (canStart) ranges.push({ start: startIndex })
    return callback()
  }

  if (type === 'unfollow') {
    var stopIndex = body.index
    var unfollowingPublicKey = body.publicKey
    if (unfollowingPublicKey === publicKey) return callback()
    if (!has(reduction, 'following')) return callback()
    if (!has(reduction.following, unfollowingPublicKey)) return callback()
    ranges = reduction.following[unfollowingPublicKey].ranges
    var lastRange = ranges[ranges.length - 1]
    var canStop = lastRange.start < stopIndex && !has(lastRange, 'stop')
    if (canStop) lastRange.stop = stopIndex
    return callback()
  }

  if (type === 'announce') {
    var uri = body.uri
    if (!has(reduction, 'uris')) reduction.uris = [uri]
    else pushToArraySet(reduction.uris, uri)
    return callback()
  }
}

function pushToArraySet (array, element) {
  assert(Array.isArray(array))
  if (array.indexOf(element) === -1) array.push(element)
}

function withinRange (index, range) {
  return (
    range.start < index &&
    (!has(range, 'end') || range.end < index)
  )
}
