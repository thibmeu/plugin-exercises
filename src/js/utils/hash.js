const crypto = require('crypto')

module.exports = function(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}
