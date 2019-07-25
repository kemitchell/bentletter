module.exports = function (request, response, location) {
  response.statusCode = 303
  response.setHeader('Location', location)
  response.end()
}
