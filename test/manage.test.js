var server = require('./server')
var tape = require('tape')
var webdriver = require('./webdriver')

tape.only('manage, login, invite, register', function (test) {
  var MANAGER_PASSWORD = 'hsh~ie0Oo'
  var USER_PASSWORD = 'od6pu^Yixi'
  server(async function (port, closeServer) {
    var browser
    var code
    webdriver()
      .then(function (loaded) { browser = loaded })

      // Set manager password.
      .then(function () {
        return browser.url('http://localhost:' + port + '/manage')
      })
      .then(function () { return browser.$('input[name=password]') })
      .then(function (password) { return password.setValue(MANAGER_PASSWORD) })
      .then(function () { return browser.$('input[name=repeat]') })
      .then(function (repeat) { return repeat.setValue(MANAGER_PASSWORD) })
      .then(function () { return browser.$('button[type=submit]') })
      .then(function (submit) { return submit.click() })

      // Log in as manager.
      .then(function () { return browser.$('input[name=email]') })
      .then(function (email) { return email.setValue('manager') })
      .then(function () { return browser.$('input[name=password]') })
      .then(function (password) { return password.setValue(MANAGER_PASSWORD) })
      .then(function () { return browser.$('button[type=submit]') })
      .then(function (submit) { return submit.click() })

      // Generate invitation code.
      .then(function () { return browser.$('button=Generate Invitation Code') })
      .then(function (submit) { return submit.click() })

      // Copy invitation code.
      .then(function () { return browser.$('code') })
      .then(function (element) { return element.getText() })
      .then(function (text) {
        code = text
        test.assert(/^[a-f0-9]+$/.test(code), 'hex code')
      })

      // Log out as manager.
      .then(function () {
        return browser.url('http://localhost:' + port + '/logout')
      })

      // Use invitation.
      .then(function () {
        return browser.url('http://localhost:' + port + '/')
      })
      .then(function () { return browser.$('input[name=token]') })
      .then(function (token) { return token.setValue(code) })
      .then(function () { return browser.$('input[name=email]') })
      .then(function (element) { return element.setValue('test@example.com') })
      .then(function () { return browser.$('input[name=password]') })
      .then(function (element) { return element.setValue(USER_PASSWORD) })
      .then(function () { return browser.$('input[name=repeat]') })
      .then(function (element) { return element.setValue(USER_PASSWORD) })
      .then(function () { return browser.$('button=Join') })
      .then(function (submit) { return submit.click() })

      .then(finish)
      .catch(function (error) {
        test.ifError(error)
        finish()
      })
    function finish () {
      browser.deleteSession()
      closeServer()
      test.end()
    }
  })
})
