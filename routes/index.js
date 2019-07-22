var path = require('path')
var pump = require('pump')
var send = require('send')

var routes = module.exports = require('http-hash')()

routes.set('/', require('./home-page'))
// TODO: routes.set('/timeline', require('./timeline'))
// TODO: routes.set('/mentions', require('./mentions'))
// TODO: routes.set('/posts/:publicKey/:index', require('./post'))
// TODO: routes.set('/users/:publicKey', require('./user'))

staticFile('styles.css')

function staticFile (file) {
  var filePath = path.join(__dirname, '..', 'static', file)
  routes.set('/' + file, function (request, response) {
    pump(send(request, filePath), response)
  })
}
