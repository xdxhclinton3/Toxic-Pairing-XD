const MAX_ACTIVE = parseInt(process.env.MAX_PAIRING_SESSIONS || '10', 10);
let active = 0;
const activeNumbers = new Set();

function acquire(number) {
  if (active >= MAX_ACTIVE) return false;
  if (number && activeNumbers.has(number)) return false;
  active++;
  if (number) activeNumbers.add(number);
  return true;
}

function release(number) {
  if (active > 0) active--;
  if (number) activeNumbers.delete(number);
}

module.exports = { acquire, release };
