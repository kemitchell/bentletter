var authenticate = require('./authenticate')
var footer = require('./partials/footer')
var header = require('./partials/header')
var internalError = require('./internal-error')
var renderEnvelope = require('./partials/envelope')
var runParallel = require('run-parallel')
var seeOther = require('./see-other')

module.exports = function (request, response) {
  authenticate(request, function (error, session) {
    if (error) return internalError(error)
    if (!session) return seeOther(request, response, '/')
    var email = session.email
    if (session.email === 'manager') return seeOther(request, response, '/manage')
    request.storage.account(email, function (error, account) {
      if (error) return internalError(error)
      var publicKey = account.publicKey
      runParallel({
        reduction: function (done) {
          request.storage.reduction(publicKey, done)
        },
        timeline: function (done) {
          var envelopes = []
          request.storage.createTimelineStream(publicKey)
            .on('data', function (envelope) {
              envelopes.push(envelope)
              if (envelopes.length === 100) {
                this.destroy()
                finish()
              }
            })
            .once('finish', finish)
          function finish () {
            done(null, envelopes)
          }
        }
      }, function (error, data) {
        if (error) return internalError(error)
        render(data)
      })
    })
  })

  function render (data) {
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
      ${renderTimeline(data)}
    </main>
    ${footer()}
  </body>
</html>
    `.trim())
  }
}

function renderTimeline (data) {
  var heading = `<h2>Timeline</h2>`
  var envelopes = `<ol>${data.timeline.map(function (envelope) {
    return renderEnvelope(envelope, data.reduction)
  }).join('')}</ol>`
  return heading + envelopes
}
