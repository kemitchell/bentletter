var Storage = require('./storage')
var encodingDown = require('encoding-down')
var handler = require('./')
var http = require('http')
var jobs = require('./jobs')
var pino = require('pino')
var pinoHTTP = require('pino-http')
var schedule = require('node-schedule')

process.on('SIGINT', trapSignal)
process.on('SIGQUIT', trapSignal)
process.on('SIGTERM', trapSignal)
process.on('uncaughtException', function (exception) {
  log.error(exception)
  close()
})

function close () {
  server.close(function () {
    log.info('server closed')
    storage.close(function (error) {
      if (error) log.error(error)
      log.info('storage closed')
      process.exit(0)
    })
  })
}

function trapSignal (signal) {
  log.info({ signal }, 'signal')
  close()
}

var log = pino()
var setUpHTTPLogs = pinoHTTP({ logger: log })

var storage = new Storage({
  leveldown: encodingDown(
    process.env.LEVELDOWN === 'memdown'
      ? require('memdown')()
      : require('leveldown')(
        process.env.LEVELDOWN || 'bentletter.leveldb'
      )
  )
})

var server = http.createServer(function (request, response) {
  request.storage = storage
  setUpHTTPLogs(request, response)
  handler(request, response)
})

server.listen(process.env.PORT || 8080, function () {
  log.info({ port: this.address().port }, 'listening')
})

jobs.forEach(function (job) {
  schedule.scheduleJob(job.cron, function () {
    var jobLog = log.child({ subsystem: 'jobs', name: job.name })
    jobLog.info('running')
    job.handler(storage, jobLog, function () {
      jobLog.info('done')
    })
  })
})
