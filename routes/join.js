var AJV = require('ajv')
var Busboy = require('busboy')
var DIGEST_RE = require('../crypto/public-key-re')
var badRequest = require('./bad-request')
var homePage = require('./home-page')
var internalError = require('./internal-error')
var makeKeyPair = require('../crypto/make-key-pair')
var methodNotAllowed = require('./method-not-allowed')
var passwordHashing = require('./password-policy')
var passwords = require('../passwords')
var runSeries = require('run-series')
var seeOther = require('./see-other')

var ajv = new AJV()

module.exports = function (request, response) {
  if (request.method !== 'POST') {
    return methodNotAllowed(request, response)
  }

  var token, email, password, repeat
  runSeries([
    readPostBody,
    validateInputs,
    validateToken,
    deleteToken,
    createAccount,
    redirect
  ], function (error) {
    if (error) return (error.handler || internalError)(error)
  })

  function readPostBody (done) {
    request.pipe(
      new Busboy({
        headers: request.headers,
        limits: {
          fieldNameSize: 8,
          fieldSize: 128,
          fields: 4,
          parts: 1
        }
      })
        .on('field', function (name, value, truncated, encoding, mime) {
          if (name === 'token') token = value.toLowerCase()
          else if (name === 'email') email = value.toLowerCase()
          else if (name === 'password') password = value
          else if (name === 'repeat') repeat = value
        })
        .once('finish', done)
    )
  }

  function validateInputs (done) {
    var validEMail = ajv.validate({
      type: 'string',
      format: 'email'
    }, email)
    var error
    if (!validEMail) {
      error = new Error('Invalid e-mail address.')
      error.handler = homePage
      return done(error)
    }
    if (password !== repeat) {
      error = new Error('Passwords did not match.')
      error.handler = homePage
      return done(error)
    }
    if (!passwords.validate(password)) {
      error = new Error('Invalid password.')
      error.handler = homePage
      return done(error)
    }
    if (!DIGEST_RE.test(token)) {
      error = new Error('Invalid token.')
      error.handler = homePage
      return done(error)
    }
    done()
  }

  function validateToken (done) {
    request.storage.token(token, function (error, record) {
      if (error) return done(error)
      if (!record) {
        var invalid = new Error('Your token is invalid.')
        invalid.handler = badRequest
        return done(invalid)
      }
      done()
    })
  }

  function deleteToken (done) {
    request.storage.deleteToken(token, done)
  }

  function createAccount (done) {
    var passwordBuffer = Buffer.from(password)
    passwordHashing.hash(passwordBuffer, function (error, passwordHash) {
      if (error) return done(error)
      var keyPair = makeKeyPair()
      var record = {
        email,
        passwordHash,
        created: new Date().toISOString(),
        publicKey: keyPair.publicKey.toString('hex'),
        secretKey: keyPair.secretKey.toString('hex')
      }
      request.storage.writeAccount(email, record, done)
    })
  }

  function redirect (done) {
    seeOther(request, response, '/login')
    done()
  }
}
