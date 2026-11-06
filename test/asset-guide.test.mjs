
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const script = new URL('../skills/product-scene-replacement/scripts/asset-guide.mjs', import.meta.url);
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, trailer]);
}
function png(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function run(...args) {
  const result = spawnSync(process.execPath, [fileURLToPath(script), ...args], { encoding: 'utf8' });
  return { status: result.status, data: JSON.parse(result.stdout || result.stderr) };
}
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'asset-ratio-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const images = [
    { id: 'A01', file: 'overall.png', role: 'overall', use: '完整轮廓', when: '全貌', limits: '仅可见面' },
    { id: 'A02', file: 'scale.png', role: 'scale', use: '相对尺度', when: '人物', limits: '仅相对尺度' },
  ];
  return { root, images };
}
test('mixed landscape and portrait ratios round-trip with each image', async t => {
  const { root, images } = await setup(t);
  await writeFile(join(root, images[0].file), png(160, 90));
  await writeFile(join(root, images[1].file), png(90, 160));
  images[0].ratio = '16:9';
  const plan = join(root, 'plan.json');
  await writeFile(plan, JSON.stringify({ product: '测试产品', version: 'v1', images }));
  const written = run('write', root, plan);
  assert.equal(written.status, 0, JSON.stringify(written.data));
  assert.equal(written.data.ratio, null);
  assert.deepEqual(written.data.images.map(image => image.ratio), ['16:9', '9:16']);
  assert.deepEqual(run('check', join(root, '资产说明.txt')).data, written.data);
  const content = await readFile(join(root, '资产说明.txt'), 'utf8');
  assert.match(content, /^格式版本：2/);
  const before = await readFile(join(root, images[0].file));
  assert.equal(run('write', root, plan).status, 1);
  assert.deepEqual(await readFile(join(root, images[0].file)), before);
  await writeFile(plan, JSON.stringify({ product: '测试产品', version: 'v1', images: [{ ...images[0], ratio: '9:16' }, images[1]] }));
  assert.equal(run('write', root, plan).status, 1);
});
test('legacy v1 guide and uniform plan remain readable', async t => {
  const { root, images } = await setup(t);
  const data = png(90, 160);
  for (const image of images) await writeFile(join(root, image.file), data);
  const hash = createHash('sha256').update(data).digest('hex');

  const legacy = ['格式版本：1', '产品：测试产品', '资产版本：v1', '比例：9:16', '', ...images.flatMap(image => [
    '[' + image.id + '] ' + image.file, '角色：' + image.role, '可用于：' + image.use,
    '选用条件：' + image.when, '局限：' + image.limits, '尺寸：90x160', 'SHA-256：' + hash, ''
  ])].join('\n');
  const guide = join(root, 'legacy.txt');
  await writeFile(guide, legacy);
  const read = run('check', guide);
  assert.equal(read.status, 0, JSON.stringify(read.data));
  assert.equal(read.data.ratio, '9:16');
  const plan = join(root, 'plan.json');
  await writeFile(plan, JSON.stringify({ product: '测试产品', version: 'v2', ratio: '9:16', images }));
  assert.equal(run('write', root, plan).status, 0);
});
