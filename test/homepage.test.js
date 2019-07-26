var http = require('http')
var meta = require('../package.json')
var server = require('./server')
var simpleConcat = require('simple-concat')
var tape = require('tape')
var webdriver = require('./webdriver')

tape.test('GET /', function (test) {
  server(function (port, closeServer) {
    http.get({ port }, function (response) {
      test.equal(response.statusCode, 200, '200')
      test.assert(
        response.headers['content-type'].includes('text/html'),
        'text/html'
      )
      simpleConcat(response, function (error, buffer) {
        var body = buffer.toString()
        test.ifError(error, 'no read error')
        test.assert(
          body.includes(meta.name),
          'body includes name'
        )
        closeServer()
        test.end()
      })
    })
  })
})

tape.test('browse /', function (test) {
  server(function (port, closeServer) {
    var browser
    webdriver()
      .then(function (loaded) {
        browser = loaded
        return browser.url('http://localhost:' + port)
      })
      .then(function () {
        return browser.$('h1')
      })
      .then(function (h1) {
        return h1.getText()
      })
      .then(function (text) {
        test.equal(text, 'bentletter', 'bentletter')
        browser.deleteSession()
        closeServer()
        test.end()
      })
  })
})
