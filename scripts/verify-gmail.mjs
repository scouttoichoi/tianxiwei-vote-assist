import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Tải cấu hình từ các nguồn khả dụng
async function loadGmailConfig(accountsPaths) {
  const possiblePaths = [
    path.resolve('vote-assist.config.json'), // Cwd
    path.resolve('../vote-assist.config.json'), // Thư mục cha
    path.join(os.homedir(), 'Library', 'Application Support', 'tianxiwei-vote-assist', 'vote-assist.config.json'), // Thư mục App Data gốc
  ];

  // Bổ sung thêm các config nằm trong thư mục instance
  for (const accPath of accountsPaths) {
    const instDir = path.dirname(path.dirname(accPath));
    possiblePaths.push(path.join(instDir, 'vote-assist.config.json'));
  }

  // Loại bỏ các đường dẫn trùng lặp
  const uniquePaths = Array.from(new Set(possiblePaths));

  for (const p of uniquePaths) {
    try {
      const content = await fs.readFile(p, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.gmail && parsed.gmail.user && parsed.gmail.pass) {
        return {
          user: parsed.gmail.user.trim(),
          pass: parsed.gmail.pass.replace(/\s+/g, '').trim(), // Xóa mọi khoảng trắng trong mật khẩu ứng dụng
          configPath: p
        };
      }
    } catch {
      // Bỏ qua nếu lỗi đọc/parse file
    }
  }

  // Đọc từ biến môi trường làm dự phòng
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    return {
      user: process.env.GMAIL_USER.trim(),
      pass: process.env.GMAIL_PASS.replace(/\s+/g, '').trim(),
      configPath: 'Environment Variables'
    };
  }

  return null;
}

// Giải mã HTML Entities thông dụng
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Hàm xác thực link Bugs bằng Playwright ẩn danh
async function authenticateBugsLink(authUrl) {
  console.log(`🤖 [Playwright] Khởi chạy trình duyệt ẩn danh để xác thực link...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 }
  });
  const page = await context.newPage();

  try {
    console.log(`🔗 [Playwright] Điều hướng tới: ${authUrl}`);
    await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const confirmSelectors = [
      'a.btnJoin[href*="music.bugs.co.kr/member/register/after/welcome"]',
      'a.btnJoin:has-text("Confirm")',
      'a.btnJoin:has-text("확인")',
      'a:has-text("Confirm")',
      'text=/Confirm/i',
      'a.btnJoin'
    ];

    let clicked = false;
    for (const selector of confirmSelectors) {
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0) > 0) {
        console.log(`👉 [Playwright] Phát hiện và nhấp nút xác thực: "${selector}"`);
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.click({ timeout: 5000, force: true });
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      console.log(`⚠️ [Playwright] Không tìm thấy nút xác thực Confirm đặc thù, kiểm tra trạng thái trang...`);
    }

    await page.waitForTimeout(4000); // Đợi xử lý từ server Bugs
    const currentUrl = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const isSuccess = /bugs\.co\.kr/.test(currentUrl) || 
                      /authenticated|complete|welcome|success|인증|확인|완료/i.test(bodyText);

    if (isSuccess) {
      console.log(`✅ [Playwright] Xác thực thành công trên Bugs!`);
      return true;
    } else {
      console.log(`❌ [Playwright] Xác thực thất bại hoặc trang báo lỗi. URL hiện tại: ${currentUrl}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ [Playwright] Lỗi trong quá trình xác thực: ${error.message}`);
    return false;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Cập nhật trạng thái tài khoản trong file accounts.json
async function updateAccountStatus(accountsPaths, targetEmail) {
  let updatedCount = 0;
  const emailLower = targetEmail.toLowerCase();

  for (const filePath of accountsPaths) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const accounts = JSON.parse(content);
      if (!Array.isArray(accounts)) continue;

      let fileChanged = false;
      for (const acc of accounts) {
        if (acc.email && acc.email.toLowerCase() === emailLower) {
          if (acc.status !== 'active') {
            acc.status = 'active';
            acc.password = acc.password || 'Abcd@1234'; // Đảm bảo luôn có pass mặc định
            acc.lastError = '';
            fileChanged = true;
            updatedCount++;
            console.log(`💾 Đã cập nhật trạng thái [Active] cho [${acc.email}] trong file: ${filePath}`);
          } else {
            console.log(`ℹ️ Tài khoản [${acc.email}] đã ở trạng thái [Active] sẵn.`);
          }
        }
      }

      if (fileChanged) {
        // Lưu an toàn bằng file ghi tạm
        const tmpPath = `${filePath}.tmp_${Date.now()}`;
        await fs.writeFile(tmpPath, JSON.stringify(accounts, null, 2), 'utf8');
        await fs.rename(tmpPath, filePath);
      }
    } catch (error) {
      console.error(`⚠️ Lỗi khi cập nhật file ${filePath}: ${error.message}`);
    }
  }

  return updatedCount;
}

// Hàm tìm tài khoản khớp trong danh sách để in log chi tiết
async function findAccountInFiles(accountsPaths, targetEmail) {
  const emailLower = targetEmail.toLowerCase();
  for (const filePath of accountsPaths) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const accounts = JSON.parse(content);
      if (!Array.isArray(accounts)) continue;
      const found = accounts.find(acc => acc.email && acc.email.toLowerCase() === emailLower);
      if (found) return found;
    } catch {}
  }
  return null;
}

async function main() {
  console.log(`=======================================================`);
  console.log(`🚀 BẮT ĐẦU TIẾN TRÌNH XÁC THỰC EMAIL ALIAS TỰ ĐỘNG`);
  console.log(`=======================================================`);

  // 1. Quét tìm tất cả các file accounts.json khả dụng
  const accountsPaths = [];
  const argPath = process.argv[2];

  if (argPath) {
    const resolved = path.resolve(argPath);
    try {
      const stats = await fs.stat(resolved);
      if (stats.isDirectory()) {
        const p1 = path.join(resolved, 'data', 'accounts.json');
        const p2 = path.join(resolved, 'accounts.json');
        if (await fs.stat(p1).then(() => true).catch(() => false)) {
          accountsPaths.push(p1);
        } else if (await fs.stat(p2).then(() => true).catch(() => false)) {
          accountsPaths.push(p2);
        } else {
          console.warn(`⚠️ Không tìm thấy file accounts.json trong thư mục: ${resolved}`);
        }
      } else {
        accountsPaths.push(resolved);
      }
    } catch {
      // Kiểm tra xem có phải là ID của instance không
      const defaultInstanceDir = path.join(os.homedir(), 'Library', 'Application Support', 'tianxiwei-vote-assist', 'instances', argPath);
      const possible = path.join(defaultInstanceDir, 'data', 'accounts.json');
      if (await fs.stat(possible).then(() => true).catch(() => false)) {
        accountsPaths.push(possible);
      } else {
        console.error(`❌ Lỗi: Không tìm thấy thư mục hoặc file accounts.json tương ứng với: ${argPath}`);
        process.exit(1);
      }
    }
  } else {
    // Thử mục data/accounts.json cục bộ trước
    const localAccounts = path.resolve('data/accounts.json');
    if (await fs.stat(localAccounts).then(() => true).catch(() => false)) {
      accountsPaths.push(localAccounts);
    } else {
      // Quét toàn bộ instances của Electron
      const defaultUserData = path.join(os.homedir(), 'Library', 'Application Support', 'tianxiwei-vote-assist');
      const instancesDir = path.join(defaultUserData, 'instances');
      try {
        const dirs = await fs.readdir(instancesDir);
        for (const dir of dirs) {
          const p = path.join(instancesDir, dir, 'data', 'accounts.json');
          if (await fs.stat(p).then(() => true).catch(() => false)) {
            accountsPaths.push(p);
          }
        }
      } catch {
        // Bỏ qua nếu thư mục không tồn tại
      }
    }
  }

  if (accountsPaths.length === 0) {
    console.error(`❌ Lỗi: Không tìm thấy bất kỳ tệp accounts.json nào để xử lý.`);
    console.error(`💡 Hướng dẫn: Bạn có thể truyền đường dẫn trực tiếp: node scripts/verify-gmail.mjs <đường_dẫn_file_hoặc_thư_mục>`);
    process.exit(1);
  }

  console.log(`📂 Đã phát hiện ${accountsPaths.length} tệp dữ liệu accounts.json:`);
  accountsPaths.forEach(p => console.log(`   - ${p}`));

  // 2. Nạp cấu hình Gmail
  const gmailConfig = await loadGmailConfig(accountsPaths);
  if (!gmailConfig) {
    console.error(`❌ Lỗi: Chưa cấu hình thông tin Gmail & App Password.`);
    console.error(`💡 Hướng dẫn: Vui lòng thêm mục "gmail" vào file "vote-assist.config.json" ở thư mục dự án của bạn:`);
    console.log(JSON.stringify({
      gmail: {
        user: "email_cua_ban@gmail.com",
        pass: "16_ky_tu_mat_khau_ung_dung"
      }
    }, null, 2));
    process.exit(1);
  }

  console.log(`📧 Kết nối Gmail: ${gmailConfig.user} (App Password từ: ${gmailConfig.configPath})`);

  // 3. Kết nối IMAP
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: gmailConfig.user,
      pass: gmailConfig.pass
    },
    logger: false
  });

  try {
    console.log(`🔌 Đang kết nối tới Gmail qua giao thức IMAP bảo mật...`);
    await client.connect();
    console.log(`✅ Kết nối Gmail thành công.`);

    let lock = await client.getMailboxLock('INBOX');
    try {
      console.log(`🔍 Đang quét các email CHƯA ĐỌC (UNSEEN) từ Bugs trong hộp thư đến...`);
      const messages = await client.search({ unseen: true });
      console.log(`📨 Tìm thấy ${messages.length} email chưa đọc tổng cộng.`);

      let processedCount = 0;
      let successCount = 0;

      for (const msgId of messages) {
        try {
          const message = await client.fetchOne(msgId, { source: true, flags: true });
          const parsed = await simpleParser(message.source);

          const subject = parsed.subject || '';
          const fromText = parsed.from?.text || '';
          const htmlContent = parsed.html || parsed.textAsHtml || '';

          // Lọc các email liên quan tới Bugs
          if (/bugs/i.test(fromText) || /bugs/i.test(subject) || /join/i.test(subject) || /인증/i.test(subject)) {
            processedCount++;
            console.log(`\n📬 [Thư ${processedCount}] Tiêu đề: "${subject}" | Người gửi: ${fromText}`);

            // Tìm link xác thực trong nội dung HTML
            const authUrlPattern = /https:\/\/secure\.bugs\.co\.kr\/member\/join\/authCode\/check[^"'<\s]+/i;
            const match = htmlContent.match(authUrlPattern);

            if (match) {
              const rawAuthUrl = match[0];
              const authUrl = decodeHtmlEntities(rawAuthUrl);

              // Xác định email nhận thư (để đối khớp)
              const toAddress = parsed.to?.value?.[0]?.address || '';
              const deliveredTo = parsed.headers?.get?.('delivered-to') || '';
              let targetEmail = toAddress || deliveredTo || '';

              if (typeof targetEmail === 'object') {
                targetEmail = targetEmail.initial || targetEmail.value || '';
              }
              targetEmail = String(targetEmail).trim().toLowerCase();

              // Nếu không lấy được To/Delivered-To chuẩn xác, thử trích xuất bằng regex từ email
              if (!targetEmail || !targetEmail.includes('@')) {
                const matchEmail = htmlContent.match(/[a-zA-Z0-9._%+-]+\.[a-zA-Z0-9._%+-]+@gmail\.com/i);
                if (matchEmail) targetEmail = matchEmail[0].toLowerCase();
              }

              console.log(`✉️ Người nhận (Alias): ${targetEmail || 'Không rõ'}`);

              // Chạy Playwright để xác thực
              const isOk = await authenticateBugsLink(authUrl);

              if (isOk) {
                successCount++;
                // Đánh dấu email đã đọc
                await client.messageFlagsAdd(msgId, ['\\Seen']);
                console.log(`👁️ Đã đánh dấu email là ĐÃ ĐỌC (Seen).`);

                if (targetEmail) {
                  // Cập nhật database
                  const updated = await updateAccountStatus(accountsPaths, targetEmail);
                  if (updated > 0) {
                    console.log(`🎉 Xác thực tự động hoàn tất cho [${targetEmail}]!`);
                  } else {
                    console.log(`⚠️ Cảnh báo: Xác thực thành công nhưng không tìm thấy tài khoản [${targetEmail}] trong file accounts.json.`);
                  }
                }
              } else {
                console.log(`❌ Không thể xác thực tự động email này. Giữ trạng thái Chưa đọc để xử lý sau.`);
              }
            } else {
              console.log(`⚠️ Không tìm thấy link xác thực trong email này.`);
            }
          }
        } catch (msgError) {
          console.error(`❌ Lỗi khi xử lý email msgId=${msgId}: ${msgError.message}`);
        }
      }

      console.log(`\n=======================================================`);
      console.log(`📊 KẾT QUẢ: Đã xử lý ${processedCount} email liên quan đến Bugs.`);
      console.log(`🏆 Xác thực thành công: ${successCount} tài khoản.`);
      console.log(`=======================================================`);

    } finally {
      lock.release();
    }

    await client.logout();
  } catch (error) {
    console.error(`❌ Lỗi hệ thống: ${error.message}`);
  }
}

main().catch(console.error);
