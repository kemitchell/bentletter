var path = require('path')
var pump = require('pump')
var send = require('send')

var routes = module.exports = require('http-hash')()

routes.set('/', require('./home-page'))

staticFile('styles.css')

function staticFile (file) {
  var filePath = path.join(__dirname, '..', 'static', file)
  routes.set('/' + file, function (request, response) {
    pump(send(request, filePath), response)
  })
}
