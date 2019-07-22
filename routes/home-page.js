module.exports = function (request, response) {
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
    </main>
    <footer role=contentinfo>
    </footer>
  </body>
</html>
  `.trim())
}
