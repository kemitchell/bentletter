var header = require('./partials/header')
var footer = require('./partials/footer')

module.exports = function (request, response, error) {
  request.log.info(error)
  response.statusCode = 400
  response.setHeader('Content-Type', 'text/html')
  response.end(`
<!doctype html>
<html lang=en-US>
  <head>
    <meta charset=UTF-8>
    <title>bentletter</title>
  </head>
  <body>
    ${header()}
    <main role=main>
      <h2>Bad Request</h2>
      <p>${error.message}</p>
    </main>
    ${footer()}
  </body>
</html>
  `.trim())
}
