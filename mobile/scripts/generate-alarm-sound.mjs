#!/usr/bin/env node
/**
 * Generates assets/sounds/alarm.wav: a 30 s alarm-clock tone (two-tone beeps in bursts).
 * Android plays a notification sound once, so the file length is how long the alarm rings.
 *   node scripts/generate-alarm-sound.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 16000; // Hz, mono, 16-bit PCM
const SECONDS = 30;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds', 'alarm.wav');

const total = RATE * SECONDS;
const pcm = new Int16Array(total);
// Pattern per 1.6 s cycle: four 150 ms beeps (alternating 1000/1300 Hz) 50 ms apart, then a pause.
const BEEP = 0.15;
const GAP = 0.05;
const CYCLE = 1.6;
for (let i = 0; i < total; i++) {
  const t = i / RATE;
  const inCycle = t % CYCLE;
  const slot = Math.floor(inCycle / (BEEP + GAP));
  const inSlot = inCycle - slot * (BEEP + GAP);
  if (slot > 3 || inSlot > BEEP) continue;
  const freq = slot % 2 === 0 ? 1000 : 1300;
  // 5 ms fade in/out to avoid clicks; square-ish tone (fundamental + odd harmonics) cuts through.
  const fade = Math.min(1, inSlot / 0.005, (BEEP - inSlot) / 0.005);
  const w = 2 * Math.PI * freq * t;
  const s = Math.sin(w) + Math.sin(3 * w) / 3 + Math.sin(5 * w) / 5;
  pcm[i] = Math.round(s * 0.72 * fade * 32767 * 0.85);
}

const data = Buffer.from(pcm.buffer);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16); // PCM chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, data]));
console.log(`Wrote ${out} (${SECONDS}s, ${((44 + data.length) / 1024).toFixed(0)} KB)`);
