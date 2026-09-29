import { spawn } from 'node:child_process';

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Please install Node.js 24 LTS from https://nodejs.org/en/download');
  process.exit(1);
}

const { createApp } = await import('./server.mjs');
const app = createApp({ host: '127.0.0.1', cookieSecure: false, publicOrigin: '' });
try {
  const address = await app.start();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`\nإرث الطيب جاهز: ${url}\n`);
  console.log('Keep this window open while using the app. Press Ctrl+C to stop.');
  if (process.env.IRTH_NO_OPEN !== '1') {
    const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'start', '""', url] : [url];
    const browser = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.log(`Open ${url} in your browser.`));
    browser.on('exit', code => { if (code) console.log(`Open ${url} in your browser.`); });
    browser.unref();
  }
} catch (error) {
  await app.close();
  console.error(error.code === 'EADDRINUSE'
    ? 'Port 3000 is already in use. Close the other server, or change PORT.'
    : `Unable to start: ${error.message}`);
  process.exit(1);
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
