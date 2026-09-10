import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/replace-default-wallpapers.mjs <image-directory>');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const align = (length) => Math.ceil(length / 4) * 4;
const mapping = [
  { finish: 'star-white', outer: 'ComfyUI_00036_.png', inner: 'ComfyUI_00037_.png', prefix: 'default' },
  { finish: 'night-sky', outer: 'ComfyUI_00034_.png', inner: 'ComfyUI_00035_.png', prefix: 'night-sky' },
];

function parse(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  assert.equal(json.buffers.length, 1);
  assert.equal(bytes.readUInt32LE(24 + jsonLength), 0x004e4942);
  assert.equal(28 + jsonLength + bytes.readUInt32LE(20 + jsonLength), bytes.length);
  return { json, bin: bytes.subarray(28 + jsonLength) };
}

const updates = mapping.map((entry) => {
  const file = `iphone-duo-${entry.finish}-interactive.glb`;
  const target = path.join(root, 'public/models', file);
  const original = fs.readFileSync(target);
  const { json, bin } = parse(original);
  const originalJson = structuredClone(json);
  const replacementViews = new Map();
  const images = ['outer', 'inner'].map((screen) => {
    const bytes = fs.readFileSync(path.join(input, entry[screen]));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.equal(width / height, screen === 'outer' ? .5 : 2);
    const material = json.materials.find((item) => item.name === (screen === 'outer' ? 'ScreenOuter' : 'ScreenInner'));
    const image = json.images[json.textures[material.emissiveTexture.index].source];
    assert.equal(image.mimeType, 'image/png');
    replacementViews.set(image.bufferView, bytes);
    return { screen, source: entry[screen], width, height, sha256: hash(bytes), bytes, exportName: `${entry.prefix}-${screen}.png` };
  });
  let offset = 0;
  const chunks = json.bufferViews.map((view, index) => {
    const bytes = replacementViews.get(index) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    view.byteOffset = offset;
    view.byteLength = bytes.length;
    const chunk = Buffer.alloc(align(bytes.length));
    bytes.copy(chunk);
    offset += chunk.length;
    return chunk;
  });
  json.buffers[0].byteLength = offset;
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(align(jsonBytes.length), 0x20);
  jsonBytes.copy(jsonChunk);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonChunk.length + offset, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(offset, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const output = Buffer.concat([header, jsonChunk, binHeader, ...chunks]);
  const verified = parse(output);
  // Every untouched buffer view must be byte-identical, including geometry and animation data.
  verified.json.bufferViews.forEach((view, index) => {
    const oldView = originalJson.bufferViews[index];
    const expected = replacementViews.get(index) ?? bin.subarray(oldView.byteOffset ?? 0, (oldView.byteOffset ?? 0) + oldView.byteLength);
    assert.deepEqual(verified.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength), expected);
    assert.equal(view.byteOffset % 4, 0);
  });
  const comparable = structuredClone(verified.json);
  comparable.bufferViews = originalJson.bufferViews;
  comparable.buffers = originalJson.buffers;
  assert.deepEqual(comparable, originalJson);
  return { target, file, original, output, images };
});

const backup = path.join(root, 'docs/model-backups/before-hd-wallpapers');
fs.mkdirSync(backup, { recursive: true });
fs.mkdirSync(path.join(root, 'public/wallpapers'), { recursive: true });
const manifestPath = path.join(root, 'docs/models.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const update of updates) {
  const backupFile = path.join(backup, update.file);
  if (!fs.existsSync(backupFile)) fs.writeFileSync(backupFile, update.original, { flag: 'wx' });
  fs.writeFileSync(update.target, update.output);
  for (const image of update.images) fs.writeFileSync(path.join(root, 'public/wallpapers', image.exportName), image.bytes);
  const record = manifest.models.find((model) => model.file === update.file);
  record.bytes = update.output.length;
  record.sha256 = hash(update.output);
  record.wallpapers = update.images.map(({ bytes, exportName, ...metadata }) => ({ ...metadata, file: `wallpapers/${exportName}` }));
  console.log(`${update.file}: ${update.original.length} -> ${update.output.length} bytes; all non-wallpaper data unchanged`);
}
manifest.wallpaperNote = 'Default screen PNGs replaced with user-provided HD artwork at original resolution. Geometry, materials, UVs and animation data preserved.';
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
