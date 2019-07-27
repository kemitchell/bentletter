var tape = require('tape')

module.exports = process.env.WEBDRIVER.length ? tape.test : tape.skip
