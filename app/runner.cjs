const path = require('node:path');
const { pathToFileURL } = require('node:url');

const command = process.argv[2] || 'signup';
const count = process.argv[3];
const scriptPath = path.join(__dirname, '..', 'scripts', 'vote-assist.mjs');
const scriptUrl = pathToFileURL(scriptPath).href;

process.argv = [process.execPath, scriptPath, command, count].filter(Boolean);

import(scriptUrl).then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
