var clearCookie = require('./clear-cookie')

module.exports = function (request, response) {
  clearCookie(response)
  response.statusCode = 303
  response.setHeader('Location', '/login')
  response.end()
}
