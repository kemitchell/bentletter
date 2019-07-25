var cookie = require('cookie')

module.exports = function (request, callback) {
  var header = request.headers.cookie
  if (!header) return callback(null, false)
  var parsed = cookie.parse(header)
  var sessionID = parsed.bentletter
  if (!sessionID) return callback(null, false)
  request.storage.session(sessionID, function (error, session) {
    if (error) return callback(error)
    if (!session) {
      request.log.info('expired session')
      return callback(null, false)
    }
    var email = session.email
    request.log.info({ sessionID, email }, 'authenticated')
    callback(null, { sessionID, email })
  })
}
