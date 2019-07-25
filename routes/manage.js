var Busboy = require('busboy')
var authenticate = require('./authenticate')
var footer = require('./partials/footer')
var header = require('./partials/header')
var internalError = require('./internal-error')
var passwordPolicy = require('./password-policy')
var random = require('../crypto/random')
var runSeries = require('run-series')
var seeOther = require('./see-other')

module.exports = function (request, response) {
  var method = request.method
  if (method === 'GET') return get(request, response)
  if (method === 'POST') return post(request, response)
  response.statusCode = 405
  response.end()
}

function get (request, response) {
  authenticate(request, function (error, session) {
    if (error) return internalError(error)
    // Client is logged in.
    if (session) {
      // Client is logged in, but not as manager.
      if (session.email !== 'manager') {
        return seeOther(request, response, '/')
      }
      // Client is logged in as manager.
      return sendManagerPanel(request, response)
    }
    // Client is not logged in.
    if (!session) {
      request.storage.account('manager', function (error, record) {
        if (error) return internalError(error)
        // No manager user yet.
        if (!record) return sendInitializeForm(request, response)
        seeOther(request, response, '/login?destination=/manage')
      })
    }
  })
}

function post (request, response) {
  authenticate(request, function (error, session) {
    if (error) {
      response.log.error(error)
      response.statusCode = 500
      return response.end()
    }
    if (session) {
      if (session.email !== 'manager') {
        response.statusCode = 403
        return response.end()
      }
      return sendInvitationCode(request, response)
    }
    // Client is not logged in.
    if (!session) {
      request.storage.account('manager', function (error, record) {
        if (error) return internalError(error)
        // No manager user yet.
        if (!record) return postManagerPassword(request, response)
        found(request, response, '/login?destination=/manage')
      })
    }
  })
}

function postManagerPassword (request, response) {
  var action, password, repeat
  runSeries([
    readPostBody,
    process
  ], function (error) {
    if (error) return internalError(error)
  })

  function readPostBody (done) {
    request.pipe(
      new Busboy({
        headers: request.headers,
        limits: {
          fieldNameSize: 8,
          fieldSize: 128,
          fields: 3,
          parts: 1
        }
      })
        .on('field', function (name, value, truncated, encoding, mime) {
          if (name === 'action') action = value
          else if (name === 'password') password = value
          else if (name === 'repeat') repeat = value
        })
        .once('finish', done)
    )
  }

  function process (done) {
    if (action !== 'initialize') {
      response.statusCode = 400
      return response.end()
    }
    if (password !== repeat) {
      response.statusCode = 400
      return sendInitializeForm(
        request, response,
        'Passwords did not match.'
      )
    }

    var passwordHash
    runSeries([
      hashPassword,
      writeAccount
    ], function (error) {
      if (error) return internalError(error)
      seeOther(request, response, '/login')
    })

    function hashPassword (done) {
      var passwordBuffer = Buffer.from(password)
      passwordPolicy.hash(passwordBuffer, function (error, hashBuffer) {
        if (error) return done(error)
        passwordHash = hashBuffer.toString('hex')
        done()
      })
    }

    function writeAccount (done) {
      request.storage.writeAccount('manager', {
        passwordHash,
        created: new Date().toISOString()
      }, done)
    }
  }
}

function sendInvitationCode (request, response) {
  var token = random(32).toString('hex')
  request.storage.writeToken(token, {
    type: 'invitation',
    created: new Date().toISOString()
  }, function (error) {
    if (error) return internalError(error)
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
      <h2>Invitation Code</h2>
      <p><code>${token}</code></p>
    </main>
    ${footer()}
  </body>
</html>
    `.trim())
  })
}

function sendInitializeForm (request, response, error) {
  var errorMessage = error ? `<p class=error>${error}</p>` : ''
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
      <form action=/manage method=post>
        <input name=action value=initialize type=hidden>
        ${errorMessage}
        <p>
          <label for=password>Password</label>
          <input name=password type=password autofocus>
        </p>
        <p>
          <label for=repeat>Repeat Password</label>
          <input name=repeat type=password>
        </p>
        <button type=submit>Set Manager Password</button>
      </form>
    </main>
    ${footer()}
  </body>
</html>
  `.trim())
}

function sendManagerPanel (request, response) {
  var accounts = []
  request.storage.createAccountsStream()
    .on('data', function (email) {
      accounts.push(email)
    })
    .once('finish', sendHTML)
  function sendHTML () {
    response.setHeader('Content-Type', 'text/html')
    var tableRows = accounts
      .map(function (email) {
        return `<tr><td>${email}</td></tr>`
      })
      .join('')
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
        <table>
          <thead>
            <tr>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <form action=/manage method=post>
          <input name=action value=invitation type=hidden>
          <button type=submit>Generate Invitation Code</button>
        </form>
      </main>
      ${footer()}
    </body>
  </html>
    `.trim())
  }
}
