#!/usr/bin/env node

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn, exec } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ghi đè console.log để xuất log tức thời trong thời gian thực (Bypass bộ đệm stream của Node)
const originalLog = console.log;
console.log = function (...args) {
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  try {
    fs.writeSync(1, msg + '\n');
  } catch {
    originalLog(...args);
  }
};

const originalError = console.error;
console.error = function (...args) {
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  try {
    fs.writeSync(2, msg + '\n');
  } catch {
    originalError(...args);
  }
};

const ACCOUNTS_PATH = path.resolve('data/accounts.json');
const CONFIG_PATH = path.resolve('vote-assist.config.json');

// Các thông số mặc định của App và Tọa độ (Thiết kế trên chuẩn màn hình 1440x2560 dọc)
const DEFAULT_PACKAGE_NAME = 'com.neowiz.android.bugs';
const WARP_PACKAGE_NAME = 'com.cloudflare.onedotonedotonedotone';

const DEFAULT_COORDINATES = {
  packageName: DEFAULT_PACKAGE_NAME,

  // Tọa độ switch của Cloudflare WARP trong giả lập
  warpSwitchX: 691,
  warpSwitchY: 581,

  // Quy trình Đăng nhập Bugs
  btnAccountX: 721,            // Nút mở trang tài khoản X
  btnAccountY: 2495,           // Nút mở trang tài khoản Y
  btnLoginListX: 725,          // Nút mở trang danh sách đăng nhập X
  btnLoginListY: 1268,         // Nút mở trang danh sách đăng nhập Y
  btnToLoginX: 239,            // Nút vào trang đăng nhập X
  btnToLoginY: 246,            // Nút vào trang đăng nhập Y
  inputEmailX: 65,             // Ô tài khoản (Email) X
  inputEmailY: 242,            // Ô tài khoản (Email) Y
  inputPasswordX: 75,          // Ô mật khẩu X
  inputPasswordY: 379,         // Ô mật khẩu Y
  btnSubmitLoginX: 1276,       // Nút đăng nhập (Submit) X
  btnSubmitLoginY: 509,        // Nút đăng nhập (Submit) Y
  btnSettingsX: 1375,          // Nút cài đặt (Setting) X
  btnSettingsY: 102,           // Nút cài đặt (Setting) Y

  // Quy trình sạc tim và xem Ad
  btnHeartStationX: 174,       // Nút vào trạm sạc tim X
  btnHeartStationY: 782,       // Nút vào trạm sạc tim Y
  btnAdVideo1X: 687,           // Vid quảng cáo 1 X
  btnAdVideo1Y: 1869,          // Vid quảng cáo 1 Y
  btnClaimRewardX: 75,         // Nút nhận phần thưởng (tắt Ad) X
  btnClaimRewardY: 80,         // Nút nhận phần thưởng (tắt Ad) Y
  btnAdVideo2X: 626,           // Vid quảng cáo 2 X
  btnAdVideo2Y: 2056,          // Vid quảng cáo 2 Y

  // Thời gian chờ load các màn hình (giây)
  appLoadDelay: 8,
  loginDelay: 6,
  adDuration: 60               // Chờ xem hết Ad (1 phút như bạn yêu cầu)
};

let config = { ...DEFAULT_COORDINATES };
let activeDeviceId = '';
let screenWidth = 1440;
let screenHeight = 2560;

// Hàm thực thi lệnh an toàn hoàn toàn không dùng Shell (Bypass hoàn toàn /bin/sh hoặc cmd.exe để tránh bị treo)
function execShellSafe(cmdStr) {
  return new Promise((resolve, reject) => {
    // Tách lệnh và các đối số dựa trên khoảng trắng
    const parts = cmdStr.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const cmd = parts[0].replace(/^"|"$/g, ''); // Bỏ dấu ngoặc kép bọc ngoài nếu có
    const args = parts.slice(1).map(arg => arg.replace(/^"|"$/g, ''));

    const child = spawn(cmd, args, {
      windowsHide: true,
      shell: false // Tuyệt đối không dùng Shell
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Exit code ${code}: ${stderr.trim()}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// Tìm tọa độ phần tử trong XML dump của UIAutomator dựa trên các từ khóa tìm kiếm
async function findClickableBounds(keywords) {
  try {
    await adbExec('shell uiautomator dump /sdcard/window_dump.xml').catch(() => { });
    const tempXmlPath = path.resolve('data/window_dump.xml');
    await adbExec(`pull /sdcard/window_dump.xml "${tempXmlPath}"`).catch(() => { });
    if (!fs.existsSync(tempXmlPath)) return null;
    const xmlContent = await fsPromises.readFile(tempXmlPath, 'utf8');
    await adbExec('shell rm /sdcard/window_dump.xml').catch(() => { });
    await fsPromises.rm(tempXmlPath, { force: true }).catch(() => { });

    // Biểu thức chính quy để phân tích cú pháp các thuộc tính node: text, content-desc, resource-id, bounds
    const nodeRegex = /<node[^>]*?(?:text="([^"]*)"|content-desc="([^"]*)"|resource-id="([^"]*)")[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;

    let match;
    const candidates = [];
    while ((match = nodeRegex.exec(xmlContent)) !== null) {
      const text = match[1] || '';
      const contentDesc = match[2] || '';
      const resourceId = match[3] || '';
      const x1 = parseInt(match[4], 10);
      const y1 = parseInt(match[5], 10);
      const x2 = parseInt(match[6], 10);
      const y2 = parseInt(match[7], 10);

      const centerX = Math.round((x1 + x2) / 2);
      const centerY = Math.round((y1 + y2) / 2);

      candidates.push({ text, contentDesc, resourceId, centerX, centerY });
    }

    // Tìm kiếm các phần tử theo danh sách từ khóa ưu tiên
    for (const kw of keywords) {
      const found = candidates.find(c =>
        (c.text && c.text.toLowerCase().includes(kw.toLowerCase())) ||
        (c.contentDesc && c.contentDesc.toLowerCase().includes(kw.toLowerCase())) ||
        (c.resourceId && c.resourceId.toLowerCase().includes(kw.toLowerCase()))
      );
      if (found) {
        console.log(`🔍 [UI Dump] Tìm thấy phần tử khớp với từ khóa "${kw}": text="${found.text}", desc="${found.contentDesc}", id="${found.resourceId}" tại (${found.centerX}, ${found.centerY})`);
        return found;
      }
    }
  } catch (err) {
    console.error('❌ [UI Dump] Lỗi phân tích cú pháp màn hình:', err.message);
  }
  return null;
}

// Tắt quảng cáo động dựa trên quét XML dump màn hình thực tế
async function closeAdDynamically() {
  console.log(`🔍 [Ad Closer] Đang quét màn hình tìm nút tắt quảng cáo...`);

  // 1. Quét tìm các nút đóng lớp phủ thông dụng trước (tắt, close, 닫기, bỏ qua, skip, X, x)
  // Việc đóng lớp phủ (ví dụ: Google Play overlay) phải được thực hiện TRƯỚC để tránh bị click nhầm quảng cáo
  const closeNode = await findClickableBounds(['닫기', 'close', 'dismiss', 'tắt', 'bỏ qua', 'skip']);
  if (closeNode) {
    console.log(`👉 Bấm nút đóng lớp phủ phát hiện được tại (${closeNode.centerX}, ${closeNode.centerY})...`);
    await adbExec(`shell input tap ${closeNode.centerX} ${closeNode.centerY}`);
    await sleep(2500); // Chờ 2.5s để lớp phủ đóng hẳn
  }

  // 2. Sau khi đã dọn lớp phủ, mới quét tìm nút tắt quảng cáo chính "Đã cấp phần thưởng" hoặc "Reward granted"
  const rewardNode = await findClickableBounds(['Đã cấp phần thưởng', 'Reward granted']);
  if (rewardNode) {
    console.log(`👉 Bấm nút nhận phần thưởng và đóng quảng cáo chính tại (${rewardNode.centerX}, ${rewardNode.centerY})...`);
    await adbExec(`shell input tap ${rewardNode.centerX} ${rewardNode.centerY}`);
    await sleep(2000);
  }

  // 3. Dự phòng: Nếu không tìm thấy nút nào qua cả 2 bước trên, bấm tọa độ mặc định của cấu hình
  if (!rewardNode && !closeNode) {
    console.log(`⚠️ Không tìm thấy nút đóng nào qua UI Dump. Sử dụng tọa độ click dự phòng từ config (${config.btnClaimRewardX}, ${config.btnClaimRewardY})...`);
    await tap(config.btnClaimRewardX, config.btnClaimRewardY);
  }
}
//
async function handlePermissionDialogs() {
  console.log(`🔍 [Permission Checker] Đang kiểm tra popup quyền Android...`);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const allowButton = await findClickableBounds([
      'ALLOW',
      'Allow',
      'allow',
      '허용',
      'Cho phép',
      'permission_allow_button'
    ]);

    if (allowButton) {
      console.log(`👉 Phát hiện nút ALLOW tại (${allowButton.centerX}, ${allowButton.centerY}). Bấm cho phép...`);
      await adbExec(`shell input tap ${allowButton.centerX} ${allowButton.centerY}`);
      await sleep(1500);
      continue;
    }

    await sleep(1000);
  }

  console.log(`ℹ️ Đã kiểm tra xong popup quyền Android.`);
}
//
// Phát hiện và đóng popup quảng cáo trang chủ (Who is your bias) nếu xuất hiện
async function handleWelcomePopup() {
  console.log(`🔍 [Popup Checker] Đang quét tìm popup quảng cáo trang chủ...`);

  // Quét tối đa 6 lần (khoảng 9-10 giây) để chờ popup xuất hiện bất đồng bộ (tránh bất đồng bộ mạng chậm)
  for (let attempt = 1; attempt <= 6; attempt++) {
    console.log(`🔍 [Popup Checker] Lần quét thứ ${attempt}/6...`);
    const popup = await findClickableBounds(['1일 동안 보지 않기', 'layerOpenCheck']);
    if (popup) {
      console.log(`👉 Phát hiện popup trang chủ Bugs. Bấm "1일 동안 보지 않기" tại (${popup.centerX}, ${popup.centerY})...`);
      await adbExec(`shell input tap ${popup.centerX} ${popup.centerY}`);
      await sleep(1500);

      // Quét thêm nút "닫기" (Close) để đóng hẳn nếu vẫn chưa đóng
      const closeBtn = await findClickableBounds(['닫기']);
      if (closeBtn) {
        console.log(`👉 Bấm tiếp nút "닫기" tại (${closeBtn.centerX}, ${closeBtn.centerY}) để đóng popup...`);
        await adbExec(`shell input tap ${closeBtn.centerX} ${closeBtn.centerY}`);
        await sleep(2000);
      }
      return true;
    }
    await sleep(1500); // Chờ 1.5 giây trước khi quét lại
  }

  console.log(`ℹ️ Không phát hiện popup trang chủ Bugs sau 6 lần quét.`);
  return false;
}

async function main() {
  const emulatorType = process.argv[3] || 'avd_genymotion';
  const preferredDeviceId = process.argv[4] || '';
  console.log(`🚀 KHỞI ĐỘNG TIẾN TRÌNH FARM ADS TỰ ĐỘNG`);
  console.log(`📱 Giả lập lựa chọn: ${emulatorType.toUpperCase()}`);

  console.log(`🔍 DEBUG: Bắt đầu loadInstanceConfig()...`);
  // 1. Tải cấu hình động nếu có
  loadInstanceConfig();
  console.log(`🔍 DEBUG: Đã hoàn tất loadInstanceConfig()`);

  console.log(`🔍 DEBUG: Bắt đầu setupAdbConnection()...`);
  // 2. Thiết lập kết nối ADB
  const connected = await setupAdbConnection(emulatorType, preferredDeviceId);
  console.log(`🔍 DEBUG: Đã hoàn tất setupAdbConnection(), kết quả: ${connected}`);
  if (!connected) {
    console.error(`❌ LỖI: Không tìm thấy máy ảo nào đang hoạt động. Vui lòng mở giả lập của bạn trước!`);
    process.exit(1);
  }

  console.log(`🔍 DEBUG: Bắt đầu detectScreenSize()...`);
  // 3. Lấy kích thước màn hình thực tế của máy ảo để tự động co giãn tọa độ
  await detectScreenSize();
  console.log(`🔍 DEBUG: Đã hoàn tất detectScreenSize()`);

  console.log(`🔍 DEBUG: Bắt đầu runSchedulerLoop()...`);
  // 4. Khởi động vòng lặp xoay vòng tài khoản 24/7
  await runSchedulerLoop();
}

let adbPathCached = '';

async function resolveAdbPath() {
  if (adbPathCached) return adbPathCached;

  console.log(`🔍 DEBUG: resolveAdbPath: Bắt đầu`);
  const platform = os.platform();
  const isWin = platform === 'win32';

  // 1. Thử dùng ADB nhúng sẵn đi kèm với Tool (Đã được giải phóng Gatekeeper và cấp quyền)
  const scriptDir = path.dirname(process.argv[1]);
  const platformDir = isWin ? 'win' : 'mac';
  const exeName = isWin ? 'adb.exe' : 'adb';
  let bundledAdbPath = path.join(scriptDir, '..', 'app', 'assets', 'bin', platformDir, exeName);

  if (bundledAdbPath.includes('app.asar')) {
    bundledAdbPath = bundledAdbPath.replace('app.asar', 'app.asar.unpacked');
  }

  console.log(`🔍 DEBUG: resolveAdbPath: Thử dùng bundled ADB tại: ${bundledAdbPath}...`);
  if (fs.existsSync(bundledAdbPath)) {
    if (platform === 'darwin') {
      try {
        console.log(`🔍 DEBUG: resolveAdbPath: Đang tự động mở khóa Gatekeeper & phân quyền cho ADB nhúng...`);
        // Sử dụng exec trực tiếp không dùng Shell để cấp quyền
        const chmodChild = spawn('chmod', ['+x', bundledAdbPath], { windowsHide: true });
        await new Promise((res) => chmodChild.on('exit', res));

        const xattrChild = spawn('xattr', ['-d', 'com.apple.quarantine', bundledAdbPath], { windowsHide: true });
        await new Promise((res) => xattrChild.on('exit', res));
        console.log(`🔍 DEBUG: resolveAdbPath: Đã mở khóa thành công!`);
      } catch (err) {
        console.log(`🔍 DEBUG: resolveAdbPath: Lỗi phân quyền bundled ADB: ${err.message}`);
      }
    }
    console.log(`🔍 DEBUG: resolveAdbPath: bundled ADB SẴN SÀNG!`);
    adbPathCached = isWin ? `"${bundledAdbPath}"` : bundledAdbPath;
    return adbPathCached;
  }

  // 2. Thử tìm trong thư mục Android SDK mặc định trên máy
  const home = os.homedir();
  if (platform === 'darwin') {
    const macPath = path.join(home, 'Library/Android/sdk/platform-tools/adb');
    console.log(`🔍 DEBUG: resolveAdbPath: Thử tìm adb của Android SDK Mac tại: ${macPath}...`);
    if (fs.existsSync(macPath)) {
      try {
        const chmodChild = spawn('chmod', ['+x', macPath], { windowsHide: true });
        await new Promise((res) => chmodChild.on('exit', res));
        console.log(`🔍 DEBUG: resolveAdbPath: Tìm thấy Android SDK Mac và đã phân quyền!`);
        adbPathCached = macPath;
        return macPath;
      } catch { }
    }
  } else if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const winPath = path.join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
    console.log(`🔍 DEBUG: resolveAdbPath: Thử tìm adb của Android SDK Win tại: ${winPath}...`);
    if (fs.existsSync(winPath)) {
      console.log(`🔍 DEBUG: resolveAdbPath: Tìm thấy Android SDK Win!`);
      adbPathCached = `"${winPath}"`;
      return `"${winPath}"`;
    }
  }

  console.log(`🔍 DEBUG: resolveAdbPath: Không tìm thấy bất kỳ ADB nào, dùng mặc định 'adb'`);
  adbPathCached = 'adb';
  return 'adb';
}

// Chạy lệnh shell adb an toàn
function isAdbTransportError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('error: closed') ||
    message.includes('device offline') ||
    message.includes('device unauthorized') ||
    message.includes('device not found') ||
    message.includes('no devices/emulators found') ||
    message.includes('cannot connect') ||
    message.includes('connection refused')
  );
}

async function reconnectActiveDevice(adbCmd) {
  if (!activeDeviceId) return false;

  console.log(`🔌 ADB bị ngắt với ${activeDeviceId}. Đang kết nối lại...`);

  await execShellSafe(`${adbCmd} connect ${activeDeviceId}`).catch(() => { });
  await sleep(1500);

  const devicesOutput = await execShellSafe(`${adbCmd} devices`).catch(() => '');
  const isOnline = devicesOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line.startsWith(activeDeviceId) && /\bdevice\b/.test(line));

  if (isOnline) {
    console.log(`✅ Đã kết nối lại ADB: [${activeDeviceId}]`);
  } else {
    console.log(`❌ Không thể kết nối lại ADB: [${activeDeviceId}]`);
  }

  return isOnline;
}

async function adbExec(args) {
  const adbCmd = await resolveAdbPath();
  const targetFlag = activeDeviceId ? `-s ${activeDeviceId}` : '';
  const fullCmd = `${adbCmd} ${targetFlag} ${args}`.trim();
  try {
    return await execShellSafe(fullCmd);
  } catch (error) {
    if (activeDeviceId && isAdbTransportError(error)) {
      const reconnected = await reconnectActiveDevice(adbCmd);
      if (reconnected) {
        try {
          return await execShellSafe(fullCmd);
        } catch (retryError) {
          throw new Error(`ADB command failed after reconnect: [${fullCmd}] - ${retryError.message}`);
        }
      }
    }

    throw new Error(`ADB command failed: [${fullCmd}] - ${error.message}`);
  }
}

// Cấu hình động
function loadInstanceConfig() {
  try {
    console.log(`🔍 DEBUG: loadInstanceConfig: Đọc cấu hình từ ${CONFIG_PATH}...`);
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    console.log(`🔍 DEBUG: loadInstanceConfig: Đọc file thành công, độ dài content: ${content.length}`);
    const userConfig = JSON.parse(content);
    if (userConfig.adsConfig) {
      config = { ...config, ...userConfig.adsConfig };
      console.log(`⚙️ Đã nạp cấu hình tùy chỉnh Farm Ads từ vote-assist.config.json`);
    }
  } catch (err) {
    console.log(`🔍 DEBUG: loadInstanceConfig thất bại (sử dụng mặc định): ${err.stack || err.message}`);
  }
}

// Thiết lập kết nối ADB dựa trên loại giả lập
async function setupAdbConnection(emulatorType, preferredDeviceId = '') {
  const adbCmd = await resolveAdbPath();
  //
  if (preferredDeviceId) {
    console.log(`🔌 Đang kết nối giả lập đã chọn: ${preferredDeviceId}...`);

    await execShellSafe(`${adbCmd} connect ${preferredDeviceId}`).catch(() => { });
    await sleep(1000);

    const stdout = await execShellSafe(`${adbCmd} devices`);
    const online = stdout
      .split('\n')
      .map((line) => line.trim())
      .some((line) => line.startsWith(preferredDeviceId) && /\bdevice\b/.test(line));

    if (!online) {
      console.log(`❌ Giả lập ${preferredDeviceId} không còn online.`);
      return false;
    }

    activeDeviceId = preferredDeviceId;
    console.log(`✅ Kết nối thành công tới máy ảo đã chọn: [${activeDeviceId}]`);

    await adbExec('shell settings put system accelerometer_rotation 0').catch(() => { });
    await adbExec('shell settings put system user_rotation 0').catch(() => { });
    await sleep(1500);

    return true;
  }
  //

  try {
    if (emulatorType === 'ldplayer' || emulatorType === 'bluestacks') {
      console.log(`🔌 Đang kết nối giả lập cổng 5555...`);
      await execShellSafe(`${adbCmd} connect 127.0.0.1:5555`).catch(() => { });
    } else if (emulatorType === 'nox') {
      console.log(`🔌 Đang kết nối giả lập cổng 62001 (Nox)...`);
      await execShellSafe(`${adbCmd} connect 127.0.0.1:62001`).catch(() => { });
    } else if (emulatorType === 'avd_genymotion') {
      console.log(`🔌 Đang quét thiết bị giả lập...`);
      await execShellSafe(`${adbCmd} connect 127.0.0.1:5555`).catch(() => { });
    }
  } catch { }

  await sleep(1000);

  try {
    const stdout = await execShellSafe(`${adbCmd} devices`);
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
    const devices = [];

    for (const line of lines.slice(1)) {
      const parts = line.split(/\s+/);
      if (parts[1] === 'device') {
        devices.push(parts[0]);
      }
    }

    if (devices.length === 0) return false;

    if (emulatorType === 'nox') {
      activeDeviceId = devices.find(d => d.includes('62001')) || devices[0];
    } else if (emulatorType === 'ldplayer' || emulatorType === 'bluestacks') {
      activeDeviceId = devices.find(d => d.includes('5555')) || devices[0];
    } else {
      activeDeviceId = devices[0];
    }

    console.log(`✅ Kết nối thành công tới máy ảo: [${activeDeviceId}]`);

    // Cưỡng bức màn hình giả lập luôn xoay dọc để đảm bảo tọa độ click hoạt động ổn định
    try {
      console.log(`📐 Đang tự động cấu hình cưỡng bức màn hình dọc (Portrait)...`);
      await adbExec('shell settings put system accelerometer_rotation 0').catch(() => { });
      await adbExec('shell settings put system user_rotation 0').catch(() => { });
      await sleep(1500); // Chờ 1.5s để giả lập hoàn tất xoay màn hình dọc
    } catch { }

    return true;
  } catch {
    return false;
  }
}

// Nhận diện kích thước màn hình
async function detectScreenSize() {
  try {
    const output = await adbExec('shell wm size');
    const match = output.match(/(\d+)x(\d+)/);
    if (match) {
      screenWidth = parseInt(match[1], 10);
      screenHeight = parseInt(match[2], 10);
      console.log(`📊 Độ phân giải thực tế màn hình máy ảo: ${screenWidth}x${screenHeight}`);
    }
  } catch (error) {
    console.warn(`⚠️ Cảnh báo: Không lấy được độ phân giải màn hình máy ảo, sử dụng mặc định 1440x2560.`);
  }
}

// Click tự động co giãn tọa độ tỉ lệ màn hình (Tự động thích ứng với xoay màn hình máy ảo)
async function tap(x, y) {
  // Lấy chiều rộng (cạnh ngắn) và chiều cao (cạnh dài) thực tế của chế độ dọc (portrait)
  const realWidth = Math.min(screenWidth, screenHeight);
  const realHeight = Math.max(screenWidth, screenHeight);

  const scaledX = Math.round((x / 1440) * realWidth);
  const scaledY = Math.round((y / 2560) * realHeight);

  console.log(`🖱️ ADB Tap: Tọa độ gốc (${x}, ${y}) -> Tọa độ quy đổi thực tế (${scaledX}, ${scaledY})`);
  await adbExec(`shell input tap ${scaledX} ${scaledY}`);
}

// Kiểm tra trạng thái kết nối VPN thực tế của giả lập thông qua mạng hệ thống (tun interface)
async function isWarpConnected() {
  try {
    const output = await adbExec('shell ip addr');
    // Tránh khớp nhầm với 'tunl0' (mặc định luôn có sẵn trên Android nhưng ở trạng thái DOWN).
    // Chỉ khớp với 'tun0', 'tun1', vv. đại diện cho kết nối VPN đang hoạt động.
    return /\btun\d+/.test(output);
  } catch {
    return false;
  }
}

// Xoay IP Cloudflare WARP trong giả lập
async function rotateWarpIP() {
  console.log(`🌐 Đang mở Cloudflare WARP trong giả lập để xoay IP...`);
  await adbExec(`shell am start -n com.cloudflare.onedotonedotonedotone/com.cloudflare.app.presentation.main.SplashActivity`).catch(() => { });
  await sleep(4000);

  // Kiểm tra trạng thái kết nối thực tế
  const connected = await isWarpConnected();
  console.log(`🔍 Kiểm tra hệ thống: WARP hiện tại ${connected ? 'ĐANG KẾT NỐI' : 'ĐANG NGẮT KẾT NỐI'}`);

  if (connected) {
    console.log(`👉 WARP đang bật -> Bấm để TẮT kết nối cũ...`);
    await tap(config.warpSwitchX, config.warpSwitchY);
    await sleep(2500);

    // Kiểm tra xem có xuất hiện hộp thoại Pause của WARP hay không
    console.log(`🔍 Đang kiểm tra hộp thoại tạm dừng của WARP...`);
    const pauseOption = await findClickableBounds(['Until I turn it back on', 'turn it back on', 'Until I turn']);
    if (pauseOption) {
      console.log(`👉 Phát hiện hộp thoại tạm dừng. Bấm "Until I turn it back on" tại (${pauseOption.centerX}, ${pauseOption.centerY}) để ngắt kết nối...`);
      await adbExec(`shell input tap ${pauseOption.centerX} ${pauseOption.centerY}`);
      await sleep(3000);
    } else {
      console.log(`ℹ️ Không thấy hộp thoại tạm dừng (có thể đã tắt trực tiếp). Chờ thêm...`);
      await sleep(1500);
    }

    console.log(`👉 Bấm để BẬT lại kết nối mới (Xoay IP sạch)...`);
    await tap(config.warpSwitchX, config.warpSwitchY);
  } else {
    console.log(`👉 WARP đang tắt -> Chỉ bấm 1 lần duy nhất để BẬT kết nối mới...`);
    await tap(config.warpSwitchX, config.warpSwitchY);
  }

  console.log(`⏳ Đang chờ WARP thiết lập kết nối VPN an toàn (15 giây)...`);
  await sleep(15000);

  // Nhấn phím HOME để ẩn ứng dụng WARP xuống chạy ngầm dưới nền thay vì dùng force-stop (force-stop sẽ diệt tiến trình VPN)
  await adbExec('shell input keyevent 3').catch(() => { });
  await sleep(1000);
}

// Tạo ngẫu nhiên Android Device ID mới
function generateRandomAndroidId() {
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

// Kiểm tra xem đăng nhập có thành công hay không bằng uiautomator dump
async function checkLoginSuccess() {
  try {
    await adbExec('shell uiautomator dump /sdcard/window_dump.xml');

    const tempXmlPath = path.resolve('data/window_dump.xml');
    await adbExec(`pull /sdcard/window_dump.xml "${tempXmlPath}"`);

    const xmlContent = await fsPromises.readFile(tempXmlPath, 'utf8');

    await adbExec('shell rm /sdcard/window_dump.xml').catch(() => { });
    await fsPromises.rm(tempXmlPath, { force: true }).catch(() => { });

    const hasPasswordInput = xmlContent.includes('비밀번호') || xmlContent.includes('password') || xmlContent.includes('passwd');
    const hasLoginIndicator = xmlContent.includes('로그인') || xmlContent.includes('login') || xmlContent.includes('userId');

    if (hasPasswordInput && hasLoginIndicator) {
      console.log(`❌ [Xác thực] Phát hiện vẫn kẹt ở màn hình Đăng nhập. Login thất bại!`);
      return false;
    }

    console.log(`✅ [Xác thực] Vượt qua màn hình Đăng nhập thành công!`);
    return true;
  } catch (error) {
    console.warn(`⚠️ Cảnh báo: Lỗi khi kiểm tra màn hình ngầm (${error.message}). Tự động bỏ qua.`);
    return true;
  }
}

// Xoay vòng hàng chờ tài khoản
async function runSchedulerLoop() {
  while (true) {
    const accounts = await loadAccounts();
    if (accounts.length === 0) {
      console.log(`😴 Không tìm thấy tài khoản nào trong dữ liệu. Chờ 1 phút rồi kiểm tra lại...`);
      await sleep(60000);
      continue;
    }

    const nextAccount = getNextEligibleAccount(accounts);
    if (!nextAccount) {
      const now = Date.now();
      const oldestAccount = [...accounts].sort((a, b) => {
        const timeA = a.lastAdWatchAt ? new Date(a.lastAdWatchAt).getTime() : 0;
        const timeB = b.lastAdWatchAt ? new Date(b.lastAdWatchAt).getTime() : 0;
        return timeA - timeB;
      })[0];

      const elapsed = now - new Date(oldestAccount.lastAdWatchAt).getTime();
      const remainingCooldown = Math.max(0, (30 * 60 * 1000) - elapsed);
      const minutesToSleep = Math.ceil(remainingCooldown / 60000);

      console.log(`⏳ Tất cả tài khoản đã xem Ads. Nghỉ ngơi tạm dừng ${minutesToSleep} phút để chờ cooldown...`);
      await sleep(remainingCooldown + 2000);
      continue;
    }

    console.log(`\n----------------------------------------`);
    console.log(`🔑 BẮT ĐẦU CHU KỲ MỚI CHO: [${nextAccount.email}]`);
    console.log(`----------------------------------------`);

    let success = false;
    try {
      // Đảm bảo xoay dọc màn hình trước khi bắt đầu chu kỳ mới
      try {
        await adbExec('shell settings put system accelerometer_rotation 0').catch(() => { });
        await adbExec('shell settings put system user_rotation 0').catch(() => { });
        await sleep(1000);
      } catch { }

      // 1. Dọn sạch dữ liệu cũ của ứng dụng vote trước
      console.log(`🧹 Dọn sạch dữ liệu cũ của ứng dụng vote...`);
      await adbExec(`shell pm clear ${config.packageName}`);
      await sleep(2000);

      // 2. Fake Device ID mới trước khi bật VPN (Thay đổi ID giữa chừng sẽ làm đứt kết nối VPN VPNService)
      const newAndroidId = generateRandomAndroidId();
      await adbExec(`shell settings put secure android_id ${newAndroidId}`);
      console.log(`📱 Đã fake Device ID mới: [${newAndroidId}]`);
      await sleep(1000);

      // Tự động cấp tất cả các quyền hệ thống và tối ưu hóa pin thông qua ADB trước khi chạy
      console.log(`🛡️ Đang tự động cấu hình quyền & pin cho ứng dụng Bugs qua ADB...`);
      const permissions = [
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.BLUETOOTH_CONNECT',
        'android.permission.READ_PHONE_STATE',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.RECORD_AUDIO'
      ];
      for (const perm of permissions) {
        await adbExec(`shell pm grant ${config.packageName} ${perm}`).catch(() => { });
      }
      await adbExec(`shell appops set ${config.packageName} SYSTEM_ALERT_WINDOW allow`).catch(() => { });
      await adbExec(`shell cmd deviceidle whitelist +${config.packageName}`).catch(() => { });
      await sleep(1000);

      // 3. Xoay IP Cloudflare WARP (Bật VPN sau khi cấu hình hệ thống đã ổn định)
      await rotateWarpIP();

      console.log(`🎬 Khởi chạy ứng dụng vote...`);
      await adbExec(`shell am start -n com.neowiz.android.bugs/.MainActivity`);
      console.log(`⏳ Đang chờ app load hẳn vào màn hình chính (tránh kẹt)...`);
      await sleep(Math.max(config.appLoadDelay * 1000, 8000)); // Đảm bảo chờ tối thiểu 8s cho trang chủ load mượt mà

      await handlePermissionDialogs();
      await handleWelcomePopup();

      console.log(`✍️ Bắt đầu tự động đăng nhập...`);

      console.log(`👉 Mở trang tài khoản (tọa độ: ${config.btnAccountX}, ${config.btnAccountY})`);
      await tap(config.btnAccountX, config.btnAccountY);
      await sleep(4000);

      console.log(`👉 Mở danh sách đăng nhập (tọa độ: ${config.btnLoginListX}, ${config.btnLoginListY})`);
      await tap(config.btnLoginListX, config.btnLoginListY);
      await sleep(4000);

      console.log(`👉 Chọn đăng nhập Bugs (tọa độ: ${config.btnToLoginX}, ${config.btnToLoginY})`);
      await tap(config.btnToLoginX, config.btnToLoginY);
      await sleep(4000);

      console.log(`👉 Điền Email vào ô tài khoản (tọa độ: ${config.inputEmailX}, ${config.inputEmailY})`);
      await tap(config.inputEmailX, config.inputEmailY);
      await sleep(1000);
      await adbExec(`shell input text "${nextAccount.email}"`);
      await sleep(2000);

      console.log(`👉 Điền Mật khẩu vào ô mật khẩu (tọa độ: ${config.inputPasswordX}, ${config.inputPasswordY})`);
      await tap(config.inputPasswordX, config.inputPasswordY);
      await sleep(1000);
      await adbExec(`shell input text "${nextAccount.password}"`);
      await sleep(2000);

      console.log(`👉 Gửi đăng nhập (tọa độ: ${config.btnSubmitLoginX}, ${config.btnSubmitLoginY})`);
      await tap(config.btnSubmitLoginX, config.btnSubmitLoginY);
      await sleep(config.loginDelay * 1000);

      console.log(`🔍 Đang kiểm tra trạng thái xác thực tài khoản...`);
      const isLoggedIn = await checkLoginSuccess();
      if (!isLoggedIn) {
        success = false;
        nextAccount.lastError = 'deactive';
        nextAccount.status = 'deactive';
        console.log(`🚫 Tài khoản [${nextAccount.email}] đã bị xóa hoặc sai pass. Chuyển trạng thái sang DEACTIVE.`);
        throw new Error('Đăng nhập thất bại, tài khoản đã bị khóa/xóa.');
      }

      console.log(`📺 Đang điều hướng đến Trạm sạc tim...`);
      await tap(config.btnAccountX, config.btnAccountY);
      await sleep(4000);

      console.log(`👉 Nhấp vào Cài đặt (tọa độ: ${config.btnSettingsX}, ${config.btnSettingsY})`);
      await tap(config.btnSettingsX, config.btnSettingsY);
      await sleep(4000);

      console.log(`👉 Nhấp vào Trạm sạc tim (tọa độ: ${config.btnHeartStationX}, ${config.btnHeartStationY})`);
      await tap(config.btnHeartStationX, config.btnHeartStationY);
      await sleep(5000);

      console.log(`📺 Bắt đầu xem quảng cáo lượt 1...`);
      // Quét tìm tọa độ động của nút Ad 1 (#5 Video Hearts) để đảm bảo click chính xác
      const ad1Node = await findClickableBounds(['#5 Video Hearts', 'Video Hearts']);
      if (ad1Node) {
        console.log(`👉 Tìm thấy nút Ad 1 qua UI Dump tại (${ad1Node.centerX}, ${ad1Node.centerY}). Bấm để xem...`);
        await adbExec(`shell input tap ${ad1Node.centerX} ${ad1Node.centerY}`);
      } else {
        console.log(`⚠️ Không tìm thấy nút Ad 1 qua UI Dump. Sử dụng tọa độ dự phòng từ config (${config.btnAdVideo1X}, ${config.btnAdVideo1Y})...`);
        await tap(config.btnAdVideo1X, config.btnAdVideo1Y);
      }
      console.log(`⏳ Đang chờ xem hết quảng cáo 1 trong 1 phút...`);
      await sleep(config.adDuration * 1000);

      // KHI XEM XONG AD 1, TIM ĐÃ ĐƯỢC CẬP NHẬT TRÊN HỆ THỐNG. CHỈ CẦN FORCE-CLOSE APP VÀ KHỞI ĐỘNG LẠI ĐỂ XEM AD 2!
      console.log(`❌ Hết thời gian quảng cáo 1 -> Diệt toàn bộ app Bugs, Play Store và Trình duyệt để dọn sạch màn hình...`);
      await adbExec(`shell am force-stop ${config.packageName}`).catch(() => { });
      await adbExec(`shell am force-stop com.android.vending`).catch(() => { });
      await adbExec(`shell am force-stop com.android.chrome`).catch(() => { });
      await sleep(2000);

      // Khởi động lại ứng dụng Bugs và đi vào Trạm sạc tim để xem tiếp Ad 2
      console.log(`🎬 Khởi chạy lại ứng dụng...`);
      await adbExec(`shell am start -n com.neowiz.android.bugs/.MainActivity`);
      console.log(`⏳ Đang chờ app load hẳn vào màn hình chính...`);
      await sleep(Math.max(config.appLoadDelay * 1000, 8000));

      // Đóng popup quảng cáo nếu xuất hiện
      await handlePermissionDialogs();
      await handleWelcomePopup();

      console.log(`📺 Đang điều hướng lại đến Trạm sạc tim...`);
      await tap(config.btnAccountX, config.btnAccountY);
      await sleep(4000);

      console.log(`👉 Nhấp vào Cài đặt (tọa độ: ${config.btnSettingsX}, ${config.btnSettingsY})`);
      await tap(config.btnSettingsX, config.btnSettingsY);
      await sleep(4000);

      console.log(`👉 Nhấp vào Trạm sạc tim (tọa độ: ${config.btnHeartStationX}, ${config.btnHeartStationY})`);
      await tap(config.btnHeartStationX, config.btnHeartStationY);
      await sleep(5000);

      console.log(`📺 Bắt đầu xem quảng cáo lượt 2...`);
      // Quét tìm tọa độ động của nút Ad 2 (#6 Video Hearts)
      const ad2Node = await findClickableBounds(['#6 Video Hearts']);
      if (ad2Node) {
        console.log(`👉 Tìm thấy nút Ad 2 qua UI Dump tại (${ad2Node.centerX}, ${ad2Node.centerY}). Bấm để xem...`);
        await adbExec(`shell input tap ${ad2Node.centerX} ${ad2Node.centerY}`);
      } else {
        console.log(`⚠️ Không tìm thấy nút Ad 2 qua UI Dump. Sử dụng tọa độ dự phòng từ config (${config.btnAdVideo2X}, ${config.btnAdVideo2Y})...`);
        await tap(config.btnAdVideo2X, config.btnAdVideo2Y);
      }
      console.log(`⏳ Đang chờ xem hết quảng cáo 2 trong 1 phút...`);
      await sleep(config.adDuration * 1000);

      // Tương tự, sau khi xem xong Ad 2, tim đã cập nhật, ta tắt hẳn app để chuẩn bị cho chu kỳ tiếp theo
      console.log(`❌ Hết thời gian quảng cáo 2 -> Diệt toàn bộ app Bugs, Play Store và Trình duyệt để chuẩn bị chu kỳ mới...`);
      await adbExec(`shell am force-stop ${config.packageName}`).catch(() => { });
      await adbExec(`shell am force-stop com.android.vending`).catch(() => { });
      await adbExec(`shell am force-stop com.android.chrome`).catch(() => { });
      await sleep(2000);

      console.log(`✅ [Thành công] Tài khoản [${nextAccount.email}] đã xem xong 2 Ads và nhận tim.`);
      success = true;
    } catch (err) {
      console.error(`❌ [Lỗi] Gặp sự cố khi tự động chạy tài khoản ${nextAccount.email}:`, err.message);
    } finally {
      await adbExec(`shell am force-stop ${config.packageName}`).catch(() => { });
      await adbExec(`shell am force-stop com.android.vending`).catch(() => { });
      await adbExec(`shell am force-stop com.android.chrome`).catch(() => { });

      if (success) {
        nextAccount.lastAdWatchAt = new Date().toISOString();
        nextAccount.lastVoteCount = (nextAccount.lastVoteCount || 0) + 20;
        nextAccount.lastError = '';
      } else {
        if (nextAccount.status !== 'deactive') {
          nextAccount.lastError = 'ad-farm-failed';
        }
      }
      await saveAccounts(accounts);
      console.log(`💾 Đã lưu lịch sử Farm Ads của tài khoản vào database hệ thống.`);
    }

    await sleep(2000);
  }
}

// Đọc danh sách account của Instance hiện tại
async function loadAccounts() {
  try {
    return JSON.parse(await fsPromises.readFile(ACCOUNTS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

// Lưu danh sách account về database của Instance hiện tại
async function saveAccounts(accounts) {
  await fsPromises.writeFile(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2) + '\n');
}

// Thuật toán chọn tài khoản chờ lâu nhất quá 30 phút cooldown
function getNextEligibleAccount(accounts) {
  const now = Date.now();
  const eligible = accounts.filter(acc => {
    const status = String(acc.status || 'active').trim().toLowerCase();
    if (status !== 'active') return false;

    if (!acc.lastAdWatchAt) return true;
    const elapsed = now - new Date(acc.lastAdWatchAt).getTime();
    return elapsed >= 30 * 60 * 1000;
  });

  if (eligible.length === 0) return null;

  return eligible.sort((a, b) => {
    const timeA = a.lastAdWatchAt ? new Date(a.lastAdWatchAt).getTime() : 0;
    const timeB = b.lastAdWatchAt ? new Date(b.lastAdWatchAt).getTime() : 0;
    return timeA - timeB;
  })[0];
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng trong tiến trình:', err.message);
  process.exit(1);
});
