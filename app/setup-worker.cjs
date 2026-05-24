const net = require('node:net');
const process = require('node:process');

function checkPortActive(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

(async () => {
  const { ensureBinary, binaryInfo } = await import('cloakbrowser');
  const info = binaryInfo?.();
  if (info?.installed) {
    console.log('Trình duyệt đã sẵn sàng.\n');
    process.exit(0);
    return;
  }

  // 1. Nhận diện proxy từ biến môi trường hoặc cổng VPN cục bộ phổ biến
  let activeProxy = process.env.DETECTED_SYSTEM_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || null;
  if (!activeProxy) {
    const proxyPorts = [7890, 10809, 1080, 10808, 8889, 8123, 20112, 2080, 8787, 3213, 1082];
    for (const port of proxyPorts) {
      if (await checkPortActive(port)) {
        if (port === 1080 || port === 10808) {
          activeProxy = `socks5://127.0.0.1:${port}`;
        } else {
          activeProxy = `http://127.0.0.1:${port}`;
        }
        break;
      }
    }
  }

  if (activeProxy) {
    console.log(`[setup-worker] Phát hiện proxy hoạt động tại: ${activeProxy}. Đang định tuyến tải qua proxy...`);
    try {
      const { ProxyAgent, Socks5ProxyAgent, setGlobalDispatcher } = await import('undici');
      if (activeProxy.startsWith('socks5://') || activeProxy.startsWith('socks://')) {
        setGlobalDispatcher(new Socks5ProxyAgent(activeProxy));
      } else {
        setGlobalDispatcher(new ProxyAgent(activeProxy));
      }
    } catch (proxyError) {
      console.warn(`[setup-worker] Không thể thiết lập proxy qua undici: ${proxyError.message}. Tiến hành tải trực tiếp...`);
    }
  }

  // 2. Danh sách các mirror của lập trình viên trong nước & quốc tế
  const mirrors = [
    // 1. Mặc định (Trang chủ cloakbrowser.dev)
    null,
    // 2. GitHub chính thức
    'https://github.com/CloakHQ/cloakbrowser/releases/download',
    // 3. Mirror 1: mirror.ghproxy.com (Tốc độ cao tại Trung Quốc)
    'https://mirror.ghproxy.com/https://github.com/CloakHQ/cloakbrowser/releases/download',
    // 4. Mirror 2: ghproxy.net (Tốc độ cao)
    'https://ghproxy.net/https://github.com/CloakHQ/cloakbrowser/releases/download',
    // 5. Mirror 3: ghproxy.cn (Dự phòng)
    'https://ghproxy.cn/https://github.com/CloakHQ/cloakbrowser/releases/download',
    // 6. Mirror 4: gh-proxy.com (Dự phòng)
    'https://gh-proxy.com/https://github.com/CloakHQ/cloakbrowser/releases/download',
    // 7. Mirror 5: hub.gitmirror.com (Dự phòng)
    'https://hub.gitmirror.com/https://github.com/CloakHQ/cloakbrowser/releases/download',
    // 8. Mirror 6: githubfast.com
    'https://githubfast.com/CloakHQ/cloakbrowser/releases/download'
  ];

  console.log('Bắt đầu tải dữ liệu trình duyệt lần đầu...\n');
  let success = false;
  let lastErr = null;

  for (let i = 0; i < mirrors.length; i++) {
    const mirror = mirrors[i];
    if (mirror) {
      process.env.CLOAKBROWSER_DOWNLOAD_URL = mirror;
      process.env.CLOAKBROWSER_SKIP_CHECKSUM = 'true';
      console.log(`Tải qua mirror: ${mirror}`);
    } else {
      delete process.env.CLOAKBROWSER_DOWNLOAD_URL;
      delete process.env.CLOAKBROWSER_SKIP_CHECKSUM;
      console.log('Tải qua nguồn mặc định chính thức...');
    }

    try {
      await ensureBinary();
      success = true;
      console.log('[setup-worker] Tải trình duyệt thành công!');
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`[setup-worker] Nguồn ${mirror || 'mặc định'} thất bại: ${err.message || err}`);
    }
  }

  if (success) {
    console.log('Trình duyệt đã sẵn sàng.\n');
    process.exit(0);
  } else {
    console.error(`[setup-worker] Thiết lập trình duyệt thất bại hoàn toàn. Lỗi cuối cùng: ${lastErr ? lastErr.message : 'Không xác định'}`);
    process.exit(1);
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
