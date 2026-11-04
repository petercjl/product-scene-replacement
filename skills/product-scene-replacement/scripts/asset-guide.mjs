import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const guideName = '资产说明.txt';
const roles = new Set(['overall', 'scale', 'structure', 'texture', 'marking', 'use']);
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const labels = { role: '角色', use: '可用于', when: '选用条件', limits: '局限', size: '尺寸', hash: 'SHA-256' };

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function line(value, label) {
  requireValue(typeof value === 'string' && value === value.trim() &&
    value.length && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value), `字段无效：${label}`);
  return value;
}

function parseGuide(source) {
  const [header, ...blocks] = source.replace(/\r\n/g, '\n').trimEnd().split('\n\n');
  const match = /^格式版本：1\n产品：(.+)\n资产版本：(.+)\n比例：(\d+:\d+)$/u.exec(header);
  requireValue(match, '说明头部格式不符');
  const [, product, version, ratio] = match;
  const images = blocks.map(block => {
    const [title, ...fields] = block.split('\n');
    const heading = /^\[(A\d{2,})\] (.+)$/u.exec(title);
    requireValue(heading, `图编号格式无效：${title}`);
    const [, id, file] = heading;
    const entries = Object.entries(labels);
    requireValue(fields.length === entries.length, `图片说明字段数不符：${id}`);
    return { id, file, ...Object.fromEntries(entries.map(([key, label], index) => {
      const prefix = label + '：';
      requireValue(fields[index].startsWith(prefix), `图片字段不符：${id} ${label}`);
      return [key, fields[index].slice(prefix.length)];
    })) };
  });
  return { product, version, ratio, images };
}

async function verify(plan, root, checking) {
  const product = line(plan.product, '产品');
  const version = line(plan.version, '资产版本');
  const ratio = plan.ratio ?? '9:16';
  requireValue(typeof ratio === 'string' && /^[1-9]\d{0,3}:[1-9]\d{0,3}$/u.test(ratio), '比例无效');
  const [rw, rh] = ratio.split(':').map(Number);
  requireValue(Array.isArray(plan.images) && plan.images.some(image => image?.role === 'overall') &&
    plan.images.some(image => image?.role === 'scale'), '完整图组需要全貌和尺度图');
  const ids = new Set();
  const files = new Set();
  const images = [];
  for (const image of plan.images) {
    const { id, file, role } = image;
    requireValue(typeof id === 'string' && /^A\d{2,}$/u.test(id) && !ids.has(id), `编号无效或重复：${id}`);
    requireValue(typeof file === 'string' && /^[a-z0-9][a-z0-9_-]*\.png$/iu.test(file) &&
      !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])\.png$/iu.test(file) && !files.has(file.toLowerCase()), `文件名无效或重复：${file}`);
    requireValue(roles.has(role), `角色无效：${id}`);
    ids.add(id);
    files.add(file.toLowerCase());
    const use = line(image.use, '可用于');
    const when = line(image.when, '选用条件');
    const limits = line(image.limits, '局限');
    const path = join(root, file);
    requireValue((await lstat(path)).isFile(), `需要实体图片文件：${file}`);
    const bytes = await readFile(path);
    requireValue(bytes.length >= 45 && bytes.subarray(0, 8).equals(pngSignature) &&
      bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' &&
      bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex')), `PNG 文件头或结束块无效：${file}`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    requireValue(width > 0 && height > 0 && width * rh === height * rw, `图片比例不符：${file} ${width}x${height}`);
    const size = `${width}x${height}`;
    const hash = createHash('sha256').update(bytes).digest('hex');
    requireValue(!checking || (size === image.size && hash === image.hash), `尺寸或哈希不符：${file}`);
    images.push({ id, file, path, role, use, when, limits, size, hash });
  }
  return { product, version, ratio, images };
}

function formatGuide({ product, version, ratio, images }) {
  const header = `格式版本：1\n产品：${product}\n资产版本：${version}\n比例：${ratio}`;
  const blocks = images.map(image => [
    `[${image.id}] ${image.file}`,
    ...Object.entries(labels).map(([key, label]) => `${label}：${image[key]}`),
  ].join('\n'));
  return [header, ...blocks].join('\n\n') + '\n';
}

async function main([command, location, planPath, ...extra]) {
  const checking = command === 'check';
  requireValue(location && !extra.length && ((checking && !planPath) ||
    (command === 'write' && planPath)), '用法：check GUIDE 或 write SET_DIR PLAN.json');
  const target = checking ? resolve(location) : join(resolve(location), guideName);
  if (checking) requireValue((await lstat(target)).isFile(), '说明需为实体文件');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(checking ? target : planPath));
  const plan = checking ? parseGuide(source) : JSON.parse(source);
  const result = await verify(plan, dirname(target), checking);
  if (!checking) await writeFile(target, formatGuide(result), { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ ok: true, guide: target, ...result }, null, 2) + '\n');
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
  process.exitCode = 1;
});
