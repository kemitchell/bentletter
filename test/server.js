var Storage = require('../storage')
var encodingDown = require('encoding-down')
var fs = require('fs')
var handler = require('../')
var http = require('http')
var memdown = require('memdown')
var pino = require('pino')
var pinoHTTP = require('pino-http')

module.exports = function (test) {
  var storage = new Storage({ leveldown: encodingDown(memdown()) })
  var log = pino(fs.createWriteStream('test-server.log'))
  http.createServer()
    .on('request', function (request, response) {
      request.storage = storage
      try {
        pinoHTTP({ logger: log })(request, response)
        handler(request, response)
      } catch (error) {
        console.error(error)
      }
    })
    .listen(0, function onceListening () {
      var server = this
      var port = server.address().port
      test(port, function closeServer () {
        storage.close()
        server.close()
      }, log)
    })
}

process.on('uncaughtException', function (error) {
  console.error(error)
})
