var AJV = require('ajv')
var glob = require('glob')
var path = require('path')
var runSeries = require('run-series')
var tape = require('tape')

tape('schemas', function (test) {
  var ajv = new AJV()
  glob('../schemas/*.js', function (error, files) {
    test.ifError(error, 'no glob error')
    runSeries(files.map(function (file) {
      return function (done) {
        var schema = require(path.resolve(file))
        test.assert(
          ajv.validateSchema(schema),
          path.basename(file, '.js')
        )
        done()
      }
    }), test.end.bind(test))
  })
})
