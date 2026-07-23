'use strict';

const net = require('net');

const HOST = '127.0.0.1';

/**
 * 指定ポートがローカルで listen 可能かどうかを調べる。
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port, host = HOST) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });
}

module.exports = { isPortAvailable, HOST };
