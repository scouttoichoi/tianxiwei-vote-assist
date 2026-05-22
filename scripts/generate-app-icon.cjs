const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const rootDir = path.resolve(__dirname, '..');
const sourceImage = path.join(rootDir, 'app', 'assets', 'splash-tian-xiwei.jpg');
const outputImage = path.join(rootDir, 'app', 'assets', 'icon-source.png');
const sourceImageBase64 = fs.readFileSync(sourceImage).toString('base64');
const sourceImageUrl = `data:image/jpeg;base64,${sourceImageBase64}`;

const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        width: 1024px;
        height: 1024px;
        overflow: hidden;
        background: transparent;
      }

      body {
        display: grid;
        place-items: center;
        padding: 68px;
      }

      .icon {
        width: 100%;
        height: 100%;
        border-radius: 224px;
        overflow: hidden;
        position: relative;
        background:
          linear-gradient(180deg, rgba(255, 245, 228, 0.18), rgba(45, 25, 12, 0.18)),
          url("${sourceImageUrl}") 32% center / cover no-repeat;
        box-shadow:
          0 26px 60px rgba(45, 24, 10, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.35);
      }

      .icon::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        border: 1px solid rgba(255, 255, 255, 0.2);
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div class="icon"></div>
  </body>
</html>
`;

async function main() {
  await app.whenReady();

  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    webPreferences: {
      backgroundThrottling: false
    }
  });

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(outputImage, image.toPNG());
    console.log(`Generated ${outputImage}`);
  } finally {
    window.destroy();
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
