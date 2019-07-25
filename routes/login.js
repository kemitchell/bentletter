var Busboy = require('busboy')
var clearCookie = require('./clear-cookie')
var footer = require('./partials/footer')
var header = require('./partials/header')
var passwordHashing = require('./password-policy')
var random = require('../crypto/random')
var runSeries = require('run-series')
var securePassword = require('secure-password')
var seeOther = require('./see-other')
var setCookie = require('./set-cookie')

module.exports = function (request, response) {
  var method = request.method
  if (method === 'GET') return get(request, response)
  if (method === 'POST') return post(request, response)
  response.statusCode = 405
  response.end()
}

function get (request, response) {
  clearCookie(response)
  response.setHeader('Content-Type', 'text/html')
  response.end(`
<!doctype html>
<html lang=en-US>
  <head>
    <meta charset=UTF-8>
    <title>Log In - Bentletter</title>
  </head>
  <body>
    ${header()}
    <main role=main>
      <form action=/login method=post>
        <p>
          <label for=email>E-Mail</label>
          <input name=email type=text required autofocus>
        </p>
        <p>
          <label for=password>Password</label>
          <input name=password type=password required>
        </p>
        <button type=submit>Log In</button>
      </form>
    </main>
    ${footer()}
  </body>
</html>
  `.trim())
}

function post (request, response) {
  var email, password, account, sessionID
  runSeries([
    readPostBody,
    authenticate,
    createSession,
    issueCookie,
    redirect
  ], function (error) {
    if (error) {
      request.log.error(error)
      response.statusCode = error.statusCode || 500
      response.end()
    }
  })

  function readPostBody (done) {
    request.pipe(
      new Busboy({
        headers: request.headers,
        limits: {
          fieldNameSize: 8,
          fieldSize: 128,
          fields: 2,
          parts: 1
        }
      })
        .on('field', function (name, value, truncated, encoding, mime) {
          if (name === 'email') email = value.toLowerCase()
          else if (name === 'password') password = value
        })
        .once('finish', done)
    )
  }

  function authenticate (done) {
    request.storage.account(email, function (error, record) {
      if (error) return done(error)
      account = record
      if (account === null) {
        var noSuchAccount = new Error('no such account')
        noSuchAccount.statusCode = 401
        return done(noSuchAccount)
      }
      var passwordHash = Buffer.from(account.passwordHash, 'hex')
      var passwordBuffer = Buffer.from(password, 'utf8')
      passwordHashing.verify(
        passwordBuffer, passwordHash,
        function (error, result) {
          if (error) return done(error)
          switch (result) {
            case securePassword.INVALID_UNRECOGNIZED_HASH:
              var unrecognized = new Error(
                'securePassword.INVALID_UNRECOGNIZED_HASH'
              )
              return done(unrecognized)
            case securePassword.INVALID:
              var invalid = new Error('invalid password')
              invalid.statusCode = 403
              return done(invalid)
            case securePassword.VALID_NEEDS_REHASH:
              return passwordHashing.hash(passwordBuffer, function (error, newHash) {
                if (error) return done(error)
                account.passwordHash = newHash.toString('hex')
                request.storage.writeAccount(
                  email, account, function (error) {
                    if (error) return done(error)
                    done()
                  }
                )
              })
            case securePassword.VALID: return done()
          }
        }
      )
    })
  }

  function createSession (done) {
    sessionID = random(32).toString('hex')
    request.storage.writeSession(sessionID, {
      email,
      created: new Date().toISOString()
    }, done)
  }

  function issueCookie (done) {
    var expires = new Date(
      Date.now() +
      (30 * 24 * 60 * 60 * 1000) // thirty days
    )
    setCookie(response, sessionID, expires)
    done()
  }

  function redirect (done) {
    var location
    if (request.query.destination === '/manage') location = '/manage'
    else if (email === 'manager') location = '/manage'
    else location = '/timeline'
    seeOther(request, response, location)
    done()
  }
}
