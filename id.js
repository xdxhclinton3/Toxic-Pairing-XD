const crypto = require('crypto');

function makeid() {
  return crypto.randomBytes(12).toString('hex');
}

module.exports = { makeid };
