#!/usr/bin/env node
/**
 * Android over a USB cable (same idea as the Tovel app's Android flow).
 *
 *   node scripts/android-usb.mjs reverse        only set up port forwarding
 *   node scripts/android-usb.mjs start [...]    forwarding + Metro on localhost
 *   node scripts/android-usb.mjs run [...]      forwarding + build/install/launch debug app
 *
 * `adb reverse tcp:8081 tcp:8081` lets the phone load the JS bundle from Metro on this PC
 * through the cable (Fast Refresh, no Wi-Fi needed). It resets when the cable is unplugged;
 * run `npm run android:reverse` again.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTS = [8081];
const [mode = 'reverse', ...rest] = process.argv.slice(2);
const ADB_EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';
const ANDROID_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'android');

function findSdk() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.env.HOME && join(process.env.HOME, 'Library', 'Android', 'sdk'),
    process.env.HOME && join(process.env.HOME, 'Android', 'Sdk'),
  ].filter(Boolean);
  return roots.find((root) => existsSync(join(root, 'platform-tools', ADB_EXE)));
}

/**
 * `npx expo prebuild` deletes android/local.properties. Recreate it so Gradle finds the SDK
 * and uses CMake >= 3.31 (its ninja handles Windows paths over 260 characters).
 */
function ensureLocalProperties(sdk) {
  if (!sdk || !existsSync(ANDROID_DIR)) return;
  const file = join(ANDROID_DIR, 'local.properties');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const esc = (p) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  const lines = [];
  if (!/^sdk\.dir=/m.test(current)) lines.push(`sdk.dir=${esc(sdk)}`);
  if (!/^cmake\.dir=/m.test(current)) {
    const cmakeRoot = join(sdk, 'cmake');
    const newest = existsSync(cmakeRoot)
      ? readdirSync(cmakeRoot)
          .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .pop()
      : undefined;
    if (newest && newest.localeCompare('3.31.0', undefined, { numeric: true }) >= 0) lines.push(`cmake.dir=${esc(join(cmakeRoot, newest))}`);
  }
  if (!lines.length) return;
  writeFileSync(file, (current && !current.endsWith('\n') ? current + '\n' : current) + lines.join('\n') + '\n');
  console.log(`Restored android/local.properties (${lines.map((l) => l.split('=')[0]).join(', ')})`);
}

const sdk = findSdk();
if (sdk) process.env.ANDROID_HOME ??= sdk; // child processes (Gradle) find the SDK too
ensureLocalProperties(sdk);
const adb = sdk ? join(sdk, 'platform-tools', ADB_EXE) : ADB_EXE;
const run = (args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();

let devices;
try {
  devices = run(['devices'])
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2);
} catch {
  console.error(`Could not run adb (${adb}). Install Android SDK platform-tools or set ANDROID_HOME.`);
  process.exit(1);
}

const ready = devices.filter(([, state]) => state === 'device');
const unauthorized = devices.filter(([, state]) => state === 'unauthorized');
if (!ready.length) {
  console.error(
    unauthorized.length
      ? 'Phone found but not authorized: unlock it and accept "Allow USB debugging?", then retry.'
      : 'No Android phone found. Connect the cable, enable Developer options > USB debugging, and set USB mode to File transfer.',
  );
  process.exit(1);
}

for (const [serial] of ready) {
  for (const port of PORTS) run(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  console.log(`USB forwarding ready on ${serial}: ${PORTS.map((p) => `phone localhost:${p} -> PC :${p}`).join(', ')}`);
}

if (mode === 'reverse') process.exit(0);

if (mode === 'logs') {
  // App logs only (console.log/warn/error and React Native errors).
  const logcat = spawn(adb, ['-s', ready[0][0], 'logcat', '*:S', 'ReactNative:V', 'ReactNativeJS:V', 'expo:V', 'AndroidRuntime:E'], { stdio: 'inherit' });
  logcat.on('exit', (code) => process.exit(code ?? 0));
} else {

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args =
  mode === 'start'
    ? ['expo', 'start', '--localhost', ...rest]
    : mode === 'run'
      ? ['expo', 'run:android', '--device', ...rest]
      : null;
if (!args) {
  console.error(`Unknown mode "${mode}". Use reverse, start, run or logs.`);
  process.exit(1);
}
// Windows needs a shell to run npx.cmd; pass one command string (args are fixed flags here).
const child =
  process.platform === 'win32'
    ? spawn([npx, ...args].join(' '), { stdio: 'inherit', shell: true })
    : spawn(npx, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
}
