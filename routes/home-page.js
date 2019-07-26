var passwordCriteria = require('./partials/password-criteria')

module.exports = function (request, response, error) {
  var errorMessage = error ? `<p class=error>${error}</p>` : ''
  response.setHeader('Content-Type', 'text/html')
  response.end(`
<!doctype html>
<html lang=en-US>
  <head>
    <meta charset=UTF-8>
    <meta name=viewport content=width=device-width,initial-scale=1>
    <title>bentletter</title>
    <link href=/styles.css rel=stylesheet>
  </head>
  <body>
    <header role=banner>
      <h1>bentletter</h1>
    </header>
    <main role=main>
      <form action=/join method=post>
        ${errorMessage}
        <p>
          <label for=token>Invitation Code</label>
          <input name=token type=text>
        </p>
        <p>
          <label for=email>E-Mail</label>
          <input name=email type=email>
        </p>
        <p>
          <label for=password>Password</label>
          <input name=password type=password>
        </p>
        <p>
          <label for=repeat>Repeat Password</label>
          <input name=repeat type=password>
        </p>
        ${passwordCriteria()}
        <button type=submit>Join</button>
      </form>
    </main>
    <footer role=contentinfo>
    </footer>
  </body>
</html>
  `.trim())
}
