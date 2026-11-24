'use strict';

/**
 * Musicbox POS bootstrap dành cho JetBrains Rider.
 *
 * Rider chỉ cần chạy npm script "start". Nếu node_modules chưa có hoặc
 * thiếu thư viện, script sẽ tự chạy npm install ở lần đầu, sau đó mở server.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PROJECT_DIR = path.resolve(__dirname, '..');
const REQUIRED_PACKAGES = ['express', 'socket.io'];
const packageFiles = REQUIRED_PACKAGES.map((name) =>
  path.join(PROJECT_DIR, 'node_modules', name, 'package.json')
);

function dependenciesAreInstalled() {
  return packageFiles.every((file) => fs.existsSync(file));
}

function installDependencies() {
  console.log('\n[Musicbox] Chưa tìm thấy đủ thư viện. Đang tự cài đặt bằng npm install...');
  console.log('[Musicbox] Lần đầu cần kết nối Internet để tải Express và Socket.IO.\n');

  // Khi chạy dưới npm, dùng đúng npm CLI hiện tại; nếu chạy trực tiếp từ Rider,
  // dùng lệnh npm trong PATH của máy.
  const npmCli = process.env.npm_execpath;
  let result;

  if (npmCli && fs.existsSync(npmCli)) {
    result = spawnSync(process.execPath, [npmCli, 'install'], {
      cwd: PROJECT_DIR,
      stdio: 'inherit',
      env: process.env
    });
  } else {
    result = spawnSync('npm', ['install'], {
      cwd: PROJECT_DIR,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32'
    });
  }

  if (result.error) {
    console.error('\n[Musicbox] Không thể khởi chạy npm:', result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error('\n[Musicbox] Cài thư viện thất bại. Hãy kiểm tra Internet và Node.js/npm, sau đó bấm Run lại.');
    process.exit(result.status || 1);
  }

  if (!dependenciesAreInstalled()) {
    console.error('\n[Musicbox] npm đã kết thúc nhưng vẫn thiếu thư viện cần thiết.');
    process.exit(1);
  }

  console.log('\n[Musicbox] Cài đặt hoàn tất. Đang khởi động máy chủ...\n');
}

if (!dependenciesAreInstalled()) {
  installDependencies();
}

const serverFile = path.join(PROJECT_DIR, 'server.js');
if (!fs.existsSync(serverFile)) {
  console.error(`[Musicbox] Không tìm thấy tệp máy chủ: ${serverFile}`);
  process.exit(1);
}

const serverProcess = spawn(process.execPath, [serverFile], {
  cwd: PROJECT_DIR,
  stdio: 'inherit',
  env: process.env
});

serverProcess.on('error', (error) => {
  console.error('[Musicbox] Không thể khởi động server:', error.message);
  process.exitCode = 1;
});

serverProcess.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (!serverProcess.killed) serverProcess.kill(signal);
  });
}
