var PUBLIC_KEY_RE = require('../crypto/public-key-re')
var concat = require('../concat')
var footer = require('./partials/footer')
var header = require('./partials/header')
var internalError = require('./internal-error')
var ndjson = require('ndjson')
var pump = require('pump')
var renderEnvelope = require('./partials/envelope')

module.exports = function (request, response) {
  if (request.method !== 'GET') {
    response.statusCode = 405
    return response.end()
  }
  var accept = request.headers.accept
  var head = parseInt(request.query.head)
  if (!Number.isSafeInteger(head) || head < -1) {
    response.statusCode = 400
    return response.end()
  }
  var publicKey = request.params.publicKey
  if (!PUBLIC_KEY_RE.test(publicKey)) {
    response.statusCode = 400
    return response.end()
  }
  request.stream = request.storage.createReverseLogStream(publicKey)
  if (accept === 'application/x-ndjson') {
    return sync(request, response)
  }
  browse(request, response)
}

function sync (request, response) {
  pump(
    request.stream,
    ndjson.stringify(),
    response
  )
}

function browse (request, response) {
  // TODO: limit envelopes per page
  concat(request.stream, function (error, envelopes) {
    if (error) return internalError(request, response, error)
    render(envelopes)
  })

  function render (envelopes) {
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
      <ol>${envelopes.map(renderEnvelope).join('')}</ol>
    </main>
    ${footer()}
  </body>
</html>
    `.trim())
  }
}
