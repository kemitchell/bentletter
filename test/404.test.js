var simpleConcat = require('simple-concat')
var http = require('http')
var meta = require('../package.json')
var server = require('./server')
var tape = require('tape')

tape('GET /nonexistent', function (test) {
  server(function (port, closeServer) {
    http.get({ port, path: '/nonexistent' }, function (response) {
      test.equal(response.statusCode, 404, '404')
      test.assert(
        response.headers['content-type'].includes('text/html'),
        'text/html'
      )
      simpleConcat(response, function (error, buffer) {
        var body = buffer.toString()
        test.ifError(error, 'Not Found')
        test.assert(
          body.includes(meta.name),
          'body includes "Not Found"'
        )
        closeServer()
        test.end()
      })
    })
  })
})
