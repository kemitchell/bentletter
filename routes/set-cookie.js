var cookie = require('cookie')

module.exports = function (response, value, expires) {
  response.setHeader(
    'Set-Cookie',
    cookie.serialize('bentletter', value, {
      expires,
      httpOnly: true,
      sameSite: true,
      secure: process.env.NODE_ENV !== 'test'
    })
  )
}
