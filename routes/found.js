module.exports = function (request, response, location) {
  response.statusCode = 302
  response.setHeader('Location', location)
  response.end()
}
