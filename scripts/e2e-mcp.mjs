import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const exe = path.resolve(process.env.VOLUMA_EXE || 'Voluma.exe');
const sample = path.resolve('assets/M0-阅读样本.pdf');
const formSample = path.resolve('assets/M3-表单样本.pdf');
const tmp = path.resolve('tmp-e2e');
fs.mkdirSync(tmp, { recursive: true });
for (const f of ['mcp-clean.pdf', 'mcp-extract.pdf', 'mcp-flat.pdf', 'mcp-plan.pdf', 'mcp-merge.pdf', 'mcp-crop.pdf']) {
  try { fs.rmSync(path.join(tmp, f), { force: true }); } catch {}
}
for (const f of fs.readdirSync(tmp)) {
  if (f.startsWith('mcp-split-')) fs.rmSync(path.join(tmp, f), { force: true });
}
fs.copyFileSync(sample, path.join(tmp, 'mcp-plan.pdf'));
fs.copyFileSync(sample, path.join(tmp, 'mcp-merge-part.pdf'));

const child = spawn(exe, ['--mcp'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let nextId = 1;
const pending = new Map();
let stdoutBuf = '';
child.stdout.on('data', (buf) => {
  stdoutBuf += buf.toString('utf8');
  const lines = stdoutBuf.split(/\r?\n/);
  stdoutBuf = lines.pop() || '';
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    } catch (e) {
      console.error('bad stdout line', line, e);
    }
  }
});
child.stderr.on('data', (b) => process.stderr.write(b));
child.on('exit', (code) => {
  for (const { reject } of pending.values()) reject(new Error(`voluma-mcp exited ${code}`));
  pending.clear();
});

function call(method, params, timeout = 20000) {
  const id = nextId++;
  const req = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(JSON.stringify(req) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} timeout`));
      }
    }, timeout);
  });
}

function textOf(result) {
  const block = result?.content?.find((x) => x.type === 'text');
  if (!block) throw new Error('tool returned no text');
  if (result.isError) throw new Error(block.text);
  return JSON.parse(block.text);
}

const init = await call('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'voluma-e2e', version: '0.1' },
});
console.log('server', init.serverInfo.name, init.serverInfo.version, init.protocolVersion);
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const list = await call('tools/list', {});
const names = list.tools.map((t) => t.name);
console.log('tools', names.join(', '));
for (const need of [
  'voluma_pdf_info',
  'voluma_extract_pages',
  'voluma_export_clean',
  'voluma_apply_page_plan',
  'voluma_merge_pdfs',
  'voluma_split_pdf',
  'voluma_crop_pages',
  'voluma_flatten_form',
]) {
  if (!names.includes(need)) throw new Error(`missing tool ${need}`);
}
if (names.length !== 8) throw new Error(`expected 8 tools, got ${names.length}`);

const info = textOf(await call('tools/call', { name: 'voluma_pdf_info', arguments: { path: sample } }));
if (info.pages !== 5) throw new Error('sample should have 5 pages');
console.log('info', info.pages, 'pages', info.pageSizes[0].width + 'x' + info.pageSizes[0].height);

const extract = textOf(await call('tools/call', {
  name: 'voluma_extract_pages',
  arguments: { path: sample, dest: path.join(tmp, 'mcp-extract.pdf'), pages: '1-3' },
}));
const exDoc = await PDFDocument.load(fs.readFileSync(path.join(tmp, 'mcp-extract.pdf')));
if (exDoc.getPageCount() !== 3) throw new Error('extract should produce 3 pages');
console.log('extract', extract.pages, 'pages');

const clean = textOf(await call('tools/call', {
  name: 'voluma_export_clean',
  arguments: { path: sample, dest: path.join(tmp, 'mcp-clean.pdf') },
}));
const cleanInfo = textOf(await call('tools/call', { name: 'voluma_pdf_info', arguments: { path: path.join(tmp, 'mcp-clean.pdf') } }));
if (cleanInfo.annotations !== 0) throw new Error('clean pdf still has annotations');
console.log('clean', clean.bytes, 'bytes', clean.removed, 'removed');

const flat = textOf(await call('tools/call', {
  name: 'voluma_flatten_form',
  arguments: { path: formSample, dest: path.join(tmp, 'mcp-flat.pdf') },
}));
const flatDoc = await PDFDocument.load(fs.readFileSync(path.join(tmp, 'mcp-flat.pdf')));
if (flatDoc.getForm().getFields().length !== 0) throw new Error('form was not flattened');
console.log('flatten', flat.bytes, 'bytes, widgets 0');

const plan = textOf(await call('tools/call', {
  name: 'voluma_apply_page_plan',
  arguments: { path: path.join(tmp, 'mcp-plan.pdf'), order: [1, 2, 3, 4, 5], rotations: { '1': 90 }, backup: false },
}));
const planInfo = textOf(await call('tools/call', { name: 'voluma_pdf_info', arguments: { path: path.join(tmp, 'mcp-plan.pdf') } }));
if (planInfo.pageSizes[0].rotate !== 90) throw new Error('rotate 90 was not written');
console.log('plan', plan.pages, 'pages, page1 rotate', planInfo.pageSizes[0].rotate);

const merge = textOf(await call('tools/call', {
  name: 'voluma_merge_pdfs',
  arguments: {
    inputs: [sample, path.join(tmp, 'mcp-merge-part.pdf')],
    dest: path.join(tmp, 'mcp-merge.pdf'),
  },
}));
const mergeDoc = await PDFDocument.load(fs.readFileSync(path.join(tmp, 'mcp-merge.pdf')));
if (mergeDoc.getPageCount() !== 10) throw new Error('merge should produce 10 pages');
console.log('merge', merge.pages, 'pages');

const split = textOf(await call('tools/call', {
  name: 'voluma_split_pdf',
  arguments: {
    path: sample,
    mode: 'chunk',
    chunk: 2,
    destDir: tmp,
    prefix: 'mcp-split',
  },
}));
if (split.files.length !== 3) throw new Error('split should produce 3 files');
for (const [i, f] of split.files.entries()) {
  const d = await PDFDocument.load(fs.readFileSync(f.path));
  const expected = [2, 2, 1][i];
  if (d.getPageCount() !== expected) throw new Error(`split file ${i} pages ${d.getPageCount()}`);
}
console.log('split', split.files.length, 'files', split.files.map((f) => f.pages).join('/'));

const crop = textOf(await call('tools/call', {
  name: 'voluma_crop_pages',
  arguments: {
    path: sample,
    dest: path.join(tmp, 'mcp-crop.pdf'),
    pages: '1-3',
    margins: { top: 10, right: 20, bottom: 30, left: 40 },
  },
}));
const cropDoc = await PDFDocument.load(fs.readFileSync(path.join(tmp, 'mcp-crop.pdf')));
const mm = 72 / 25.4;
const box = cropDoc.getPage(0).getCropBox();
if (Math.abs(box.x - 40 * mm) > 0.1 || Math.abs(box.y - 30 * mm) > 0.1) {
  throw new Error(`crop box ${JSON.stringify(box)}`);
}
console.log('crop', crop.pages, 'pages', Math.round(box.width), 'x', Math.round(box.height), 'pt');

const err = await call('tools/call', { name: 'voluma_pdf_info', arguments: { path: 'D:\\no-such-file.pdf' } });
if (!err.isError) throw new Error('missing file should be isError');
console.log('error path ok:', err.content[0].text);

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'exit' }) + '\n');
child.stdin.end();
await new Promise((r) => child.on('exit', r));
console.log('MCP OK');
