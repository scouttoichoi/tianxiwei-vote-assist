const path = require('node:path');
const { pathToFileURL } = require('node:url');

const command = process.argv[2] || 'signup';
const param = process.argv[3]; // count for signup, emulatorType for ads

const isAdsMode = command === 'ads';
const scriptName = isAdsMode ? 'ads-farm.mjs' : 'vote-assist.mjs';
const scriptPath = path.join(__dirname, '..', 'scripts', scriptName);
const scriptUrl = pathToFileURL(scriptPath).href;

process.argv = [process.execPath, scriptPath, command, param].filter(Boolean);

import(scriptUrl).then(() => {
  // Không gọi process.exit(0) ở đây để tránh chấm dứt tiến trình sớm.
  // Node.js sẽ tự động thoát khi vòng lặp sự kiện (event loop) rỗng (đối với vote-assist.mjs),
  // và sẽ giữ tiến trình hoạt động mãi mãi đối với vòng lặp vô hạn của ads-farm.mjs.
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
