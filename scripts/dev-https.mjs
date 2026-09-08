/**
 * Launch Vite with a self-signed certificate.
 *
 * Needed because a phone on the LAN reaches the dev server by IP, and browsers
 * only expose getUserMedia in a secure context -- http://192.168.x.x is not one.
 * The certificate is self-signed, so the phone shows a warning once; accept it
 * and the camera works.
 */
import { spawn } from 'node:child_process';

const child = spawn('npx', ['vite', '--host'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_HTTPS: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
