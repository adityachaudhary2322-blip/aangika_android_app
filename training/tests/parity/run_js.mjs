// Runs the REAL packFrame / bodyNormalise from src/services/signRecognizer.js
// on cases read from stdin (JSON) and writes their float32 bytes to stdout.
//
// signRecognizer.js imports onnxruntime-web at the top, which is irrelevant to
// these two functions and heavy under node. The harness copies the file to a
// temp module with that one import line removed; every function body is the
// original source, byte for byte.
//
// Wire format: numbers JSON cannot carry are sent as {"$num": "NaN" |
// "Infinity" | "-Infinity" | "-0"}. Outputs are base64 of little-endian bytes.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../../src/services/signRecognizer.js');

const ORT_IMPORT = "import * as ort from 'onnxruntime-web';";
const text = readFileSync(source, 'utf8');
if (!text.includes(ORT_IMPORT)) {
  throw new Error(`expected import line not found in ${source}`);
}
const dir = mkdtempSync(join(tmpdir(), 'parity-'));
const copy = join(dir, 'signRecognizer.mjs');
writeFileSync(copy, text.replace(ORT_IMPORT, 'const ort = null;'));

let mod;
try {
  mod = await import(pathToFileURL(copy).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const SPECIAL = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 };
const input = JSON.parse(readFileSync(0, 'utf8'), (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value) && '$num' in value
    ? SPECIAL[value.$num]
    : value);

const b64f32 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');

const results = input.cases.map((c) => {
  if (c.kind === 'pack') {
    return b64f32(mod.packFrame(c.pose, c.hands, c.mirrored));
  }
  if (c.kind === 'norm') {
    return b64f32(mod.bodyNormalise(Float32Array.from(c.frame)));
  }
  if (c.kind === 'pack_norm') {
    return b64f32(mod.bodyNormalise(mod.packFrame(c.pose, c.hands, c.mirrored)));
  }
  throw new Error(`unknown case kind ${c.kind}`);
});

const hypot = (input.hypot || []).map(([a, b]) => {
  const buf = Buffer.alloc(8);
  buf.writeDoubleLE(Math.hypot(a, b));
  return buf.toString('base64');
});

process.stdout.write(JSON.stringify({
  node: process.version,
  constants: {
    FEATURE_DIM: mod.FEATURE_DIM, POSE_COUNT: mod.POSE_COUNT, HAND_COUNT: mod.HAND_COUNT,
    LEFT_HAND_START: mod.LEFT_HAND_START, RIGHT_HAND_START: mod.RIGHT_HAND_START,
  },
  results,
  hypot,
}));
