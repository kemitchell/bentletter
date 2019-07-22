module.exports = function (request, response) {
  response.statusCode = 404
  response.setHeader('Content-Type', 'text/html')
  response.end(`
<!doctype html>
<html lang=en-US>
  <head>
    <meta charset=UTF-8>
    <meta name=viewport content=width=device-width,initial-scale=1>
    <title>Not Found - bentletter</title>
    <link href=/styles.css rel=stylesheet>
  </head>
  <body>
    <header role=banner>
      <h1>bentletter</h1>
    </header>
    <main role=main>
      <p>Not Found</p>
    </main>
    <footer role=contentinfo>
    </footer>
  </body>
</html>
  `.trim())
}
