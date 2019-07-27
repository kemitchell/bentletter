module.exports = function (stream, callback) {
  var objects = []
  var failed
  stream
    .on('data', function (object) { objects.push(object) })
    .once('error', function (error) {
      failed = true
      this.destroy()
      if (!failed) callback(error)
    })
    .once('end', function () {
      if (!failed) callback(null, objects)
    })
}
