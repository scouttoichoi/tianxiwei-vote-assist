(async () => {
  const { ensureBinary, binaryInfo } = await import('cloakbrowser');
  const info = binaryInfo?.();
  if (info?.installed) {
    console.log('Trình duyệt đã sẵn sàng.\n');
    process.exit(0);
    return;
  }
  console.log('Đang tải dữ liệu trình duyệt lần đầu...\n');
  await ensureBinary();
  console.log('Trình duyệt đã sẵn sàng.\n');
  process.exit(0);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
