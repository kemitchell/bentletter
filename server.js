var handler = require('./')
var http = require('http')
var pino = require('pino')
var pinoHTTP = require('pino-http')

process.on('SIGINT', trapSignal)
process.on('SIGQUIT', trapSignal)
process.on('SIGTERM', trapSignal)
process.on('uncaughtException', function (exception) {
  log.error(exception)
  close()
})

function close () {
  log.info('closing')
  server.close(function () {
    log.info('closed')
    process.exit(0)
  })
}

function trapSignal (signal) {
  log({ signal }, 'signal')
  close()
}

var log = pino()
var setUpHTTPLogs = pinoHTTP({ logger: log })

var server = http.createServer(function (request, response) {
  setUpHTTPLogs(request, response)
  handler(request, response)
})

server.listen(process.env.PORT || 8080, function () {
  log.info({ port: this.address().port }, 'listening')
})
