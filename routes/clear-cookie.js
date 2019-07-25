var setCookie = require('./set-cookie')

module.exports = function (response) {
  setCookie(response, '', new Date('1970-01-01'))
}
