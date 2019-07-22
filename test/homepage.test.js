var simpleConcat = require('simple-concat')
var http = require('http')
var meta = require('../package.json')
var server = require('./server')
var tape = require('tape')

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
