var assert = require('nanoassert')
var has = require('has')

module.exports = function (state, envelope, callback) {
  assert(typeof state === 'object')
  assert(typeof envelope === 'object')
  assert(typeof callback === 'function')

  var message = envelope.message
  var publicKey = envelope.publicKey
  var index = message.index
  var dateString = message.date
  var body = message.body
  var type = body.type

  if (!has(state, 'latestIndex') || state.latestIndex < index) {
    var latestDate = state.latestDate
    var date = new Date(dateString)
    if (date < latestDate) {
      var error = new Error(
        'Message ' + index + ' is dated earlier than ' +
        'message ' + state.latestIndex + '.'
      )
      error.first = state.latestIndex
      error.second = index
      return callback(error)
    }
    state.latestIndex = index
    state.latestDate = date
  }

  if (type === 'follow') {
    var followingPublicKey = body.publicKey
    if (followingPublicKey === publicKey) return callback()
    var startIndex = body.index
    var name = body.name
    if (!has(state, 'following')) state.following = {}
    if (!has(state.following, followingPublicKey)) {
      state.following[followingPublicKey] = {
        names: [name],
        starts: [startIndex],
        stops: []
      }
    } else {
      var record = state.following[followingPublicKey]
      pushToArraySet(record.names, name)
      pushToArraySet(record.starts, startIndex)
    }
    return callback()
  }

  if (type === 'unfollow') {
    var stopIndex = body.index
    var unfollowingPublicKey = body.publicKey
    if (unfollowingPublicKey === publicKey) return callback()
    if (!has(state, 'following')) return callback()
    if (!has(state.following, unfollowingPublicKey)) return callback()
    pushToArraySet(state.following[unfollowingPublicKey].stops, stopIndex)
    return callback()
  }

  if (type === 'announce') {
    var uri = body.uri
    if (!has(state, 'uris')) state.uris = [uri]
    else pushToArraySet(state.uris, uri)
    return callback()
  }
}

function pushToArraySet (array, element) {
  assert(Array.isArray(array))
  if (array.indexOf(element) === -1) array.push(element)
}
