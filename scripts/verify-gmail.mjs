import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

const POLL_INTERVAL_MS = 15000; // Quét lại sau mỗi 15 giây

// Tải tất cả cấu hình Gmail từ file vote-assist.config.json cục bộ
async function loadGmailConfigs() {
  const configPath = path.resolve('vote-assist.config.json');
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);
    
    // Hỗ trợ cấu hình nhiều Gmail dưới dạng Mảng (Array)
    if (Array.isArray(parsed.gmail)) {
      const validConfigs = parsed.gmail
        .filter(item => item && item.user && item.pass)
        .map(item => ({
          user: item.user.trim(),
          pass: item.pass.replace(/\s+/g, '').trim(), // Xóa khoảng trắng mật khẩu
          configPath
        }));
      if (validConfigs.length > 0) return validConfigs;
    }
    
    // Hỗ trợ cấu hình đơn lẻ
    if (parsed.gmail && parsed.gmail.user && parsed.gmail.pass) {
      return [{
        user: parsed.gmail.user.trim(),
        pass: parsed.gmail.pass.replace(/\s+/g, '').trim(),
        configPath
      }];
    }
  } catch {
    // Bỏ qua nếu lỗi
  }

  // Dự phòng từ biến môi trường
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    return [{
      user: process.env.GMAIL_USER.trim(),
      pass: process.env.GMAIL_PASS.replace(/\s+/g, '').trim(),
      configPath: 'Environment Variables'
    }];
  }

  return [];
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
  console.log(`   🤖 [Playwright] Khởi chạy trình duyệt ngầm để click xác thực...`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 }
  });
  const page = await context.newPage();

  try {
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
        console.log(`   👉 [Playwright] Nhấp nút xác thực: "${selector}"`);
        await locator.scrollIntoViewIfNeeded().catch(() => {});
        await locator.click({ timeout: 5000, force: true });
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        clicked = true;
        break;
      }
    }

    await page.waitForTimeout(4000); // Đợi server xử lý
    const currentUrl = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const isSuccess = /bugs\.co\.kr/.test(currentUrl) || 
                      /authenticated|complete|welcome|success|인증|확인|완료/i.test(bodyText);

    if (isSuccess) {
      console.log(`   ✅ [Playwright] Kích hoạt thành công trên trang chủ Bugs!`);
      return true;
    } else {
      console.log(`   ❌ [Playwright] Thất bại. URL: ${currentUrl}`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ [Playwright] Lỗi xác thực: ${error.message}`);
    return false;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Xử lý quét và xác thực cho 1 tài khoản Gmail cụ thể
async function processGmailAccount(gmailConfig) {
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

  const timeStr = new Date().toLocaleTimeString();

  try {
    await client.connect();

    let lock = await client.getMailboxLock('INBOX');
    try {
      const messages = await client.search({ unseen: true, from: 'admin@bugs.co.kr' });

      // Log siêu gọn nếu không có thư mới để đỡ rác màn hình Terminal
      if (messages.length === 0) {
        console.log(`[${timeStr}] 📬 [${gmailConfig.user}] Trạng thái: Yên lặng (0 thư mới từ admin@bugs.co.kr)`);
        return;
      }

      console.log(`\n[${timeStr}] 🎉 [${gmailConfig.user}] PHÁT HIỆN ${messages.length} THƯ MỚI CHƯA ĐỌC! Đang xử lý...`);

      let processedCount = 0;
      let successCount = 0;

      for (const msgId of messages) {
        try {
          const message = await client.fetchOne(msgId, { source: true, flags: true });
          const parsed = await simpleParser(message.source);

          const subject = parsed.subject || '';
          const htmlContent = parsed.html || parsed.textAsHtml || '';

          processedCount++;
          console.log(` 📬 [Thư ${processedCount}] Tiêu đề: "${subject}"`);

          // Tìm link xác thực trong nội dung HTML
          const authUrlPattern = /https:\/\/secure\.bugs\.co\.kr\/member\/join\/authCode\/check[^"'<\s]+/i;
          const match = htmlContent.match(authUrlPattern);

          if (match) {
            const rawAuthUrl = match[0];
            const authUrl = decodeHtmlEntities(rawAuthUrl);

            // Xác định email nhận thư
            const toAddress = parsed.to?.value?.[0]?.address || '';
            const deliveredTo = parsed.headers?.get?.('delivered-to') || '';
            let targetEmail = toAddress || deliveredTo || '';

            if (typeof targetEmail === 'object') {
              targetEmail = targetEmail.initial || targetEmail.value || '';
            }
            targetEmail = String(targetEmail).trim().toLowerCase();

            if (!targetEmail || !targetEmail.includes('@')) {
              const matchEmail = htmlContent.match(/[a-zA-Z0-9._%+-]+\.[a-zA-Z0-9._%+-]+@gmail\.com/i);
              if (matchEmail) targetEmail = matchEmail[0].toLowerCase();
            }

            console.log(`   ✉️ Người nhận (Alias): ${targetEmail || 'Không rõ'}`);

            // Chạy Playwright để xác thực
            const isOk = await authenticateBugsLink(authUrl);

            if (isOk) {
              successCount++;
              // Đánh dấu email đã đọc
              await client.messageFlagsAdd(msgId, ['\\Seen']);
              console.log(`   👁️ Đã đánh dấu thư của [${targetEmail}] là ĐÃ ĐỌC (Seen).`);
            } else {
              console.log(`   ❌ Giữ trạng thái email Chưa đọc để xử lý sau.`);
            }
          } else {
            console.log(`   ⚠️ Không tìm thấy link xác thực trong thư này.`);
          }
        } catch (msgError) {
          console.error(` ❌ Lỗi xử lý email: ${msgError.message}`);
        }
      }

      console.log(`📊 Kết quả lượt quét: Đã xử lý ${processedCount} thư | Xác thực thành công: ${successCount} tài khoản.`);

    } finally {
      lock.release();
    }

    await client.logout();
  } catch (error) {
    console.error(`[${timeStr}] ❌ Lỗi khi kết nối hòm thư ${gmailConfig.user}: ${error.message}`);
  }
}

async function main() {
  console.log(`=======================================================`);
  console.log(`🚀 KHỞI CHẠY THIẾT BỊ LỌC VÀ XÁC THỰC EMAIL TỰ ĐỘNG`);
  console.log(`⏱️  Chế độ: Chạy liên tục (Quét tuần hoàn mỗi 15 giây)`);
  console.log(`=======================================================`);

  // 1. Nạp tất cả cấu hình Gmail
  const gmailConfigs = await loadGmailConfigs();
  if (gmailConfigs.length === 0) {
    console.error(`❌ Lỗi: Chưa cấu hình thông tin Gmail & App Password ở file "vote-assist.config.json".`);
    console.error(`💡 Hướng dẫn: Vui lòng điền thông tin Gmail vào file "vote-assist.config.json" ở gốc dự án.`);
    process.exit(1);
  }

  console.log(`📂 Đã nạp thành công cấu hình cho ${gmailConfigs.length} hòm thư Gmail.`);
  console.log(`💡 Nhấn Ctrl + C để dừng dịch vụ.\n`);

  // 2. Vòng lặp quét vô hạn
  while (true) {
    for (const config of gmailConfigs) {
      await processGmailAccount(config);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch(console.error);
