const crypto = require('node:crypto');

const password = process.argv[2];
if (!password) throw new Error('usage: node tools/hash-password.js <password>');
const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }).toString('base64');
process.stdout.write(`scrypt$16384$8$1$${salt}$${hash}\n`);
