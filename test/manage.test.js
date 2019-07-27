var server = require('./server')
var tape = require('tape')
var webdriver = require('./webdriver')

tape.test('manage, login, invite, register', function (test) {
  var MANAGER_PASSWORD = 'hsh~ie0Oo'
  var USER_PASSWORD = 'od6pu^Yixi'
  server(async function (port, closeServer) {
    var browser
    var code
    webdriver()
      .then((loaded) => { browser = loaded })

      // Set manager password.
      .then(() => browser.url('http://localhost:' + port + '/manage'))
      .then(() => browser.$('input[name=password]'))
      .then((password) => password.setValue(MANAGER_PASSWORD))
      .then(() => browser.$('input[name=repeat]'))
      .then((repeat) => repeat.setValue(MANAGER_PASSWORD))
      .then(() => browser.$('button[type=submit]'))
      .then((submit) => submit.click())
      .then(() => test.pass('set manager password'))

      // Log in as manager.
      .then(() => browser.$('input[name=email]'))
      .then((email) => email.setValue('manager'))
      .then(() => browser.$('input[name=password]'))
      .then((password) => password.setValue(MANAGER_PASSWORD))
      .then(() => browser.$('button[type=submit]'))
      .then((submit) => submit.click())
      .then(() => browser.$('h2=Manage'))
      .then((heading) => test.ok(heading, 'logged in as manager'))

      // Generate invitation code.
      .then(() => browser.$('button=Generate Invitation Code'))
      .then((submit) => submit.click())
      .then(() => browser.$('code'))
      .then((element) => element.getText())
      .then((text) => {
        code = text
        test.assert(/^[a-f0-9]+$/.test(code), 'made invitation code')
      })

      // Log out as manager.
      .then(() => browser.url('http://localhost:' + port + '/logout'))

      // Use invitation.
      .then(() => browser.url('http://localhost:' + port + '/'))
      .then(() => browser.$('input[name=token]'))
      .then((token) => token.setValue(code))
      .then(() => browser.$('input[name=email]'))
      .then((element) => element.setValue('test@example.com'))
      .then(() => browser.$('input[name=password]'))
      .then((element) => element.setValue(USER_PASSWORD))
      .then(() => browser.$('input[name=repeat]'))
      .then((element) => element.setValue(USER_PASSWORD))
      .then(() => browser.$('button=Join'))
      .then((submit) => submit.click())
      .then(() => browser.$('h2=Timeline'))
      .then((timelineHeading) => test.ok(timelineHeading, 'registered'))

      .then(finish)
      .catch((error) => {
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
