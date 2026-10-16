import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Pinned to a published Node 24 LTS release, downloaded with HTTPS verification.
const nodeVersion = 'v24.22.0';
const archiveName = `node-${nodeVersion}-win-x64.zip`;
const officialBase = `https://nodejs.org/dist/${nodeVersion}`;
const cache = join(root, '.cache', 'node-runtime');
const output = join(root, 'portable', 'windows-x64');
const bundleRoot = join(output, '知页');
const outputZip = join(root, 'portable', '知页-Windows-免安装版.zip');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`打包内容不能包含符号链接：${entry.name}`);
    if (entry.isDirectory()) await copyTree(join(source, entry.name), join(destination, entry.name));
    else if (entry.isFile()) await copyFile(join(source, entry.name), join(destination, entry.name));
  }
}

async function main() {
  await access(join(root, 'dist', 'index.html'));
  await access(join(root, 'scripts', 'launch.mjs'));
  await mkdir(cache, { recursive: true });

  const sumsResponse = await fetch(`${officialBase}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30_000) });
  if (!sumsResponse.ok) throw new Error(`无法读取官方校验文件（HTTP ${sumsResponse.status}）`);
  const sums = await sumsResponse.text();
  const checksumLine = sums.split(/\r?\n/).find(line => line.trim().split(/\s+/)[1] === archiveName);
  if (!checksumLine) throw new Error('官方校验文件没有这个版本的 Windows 运行环境，已停止打包。');
  const expected = checksumLine.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('官方 SHA-256 校验信息格式不正确。');

  const cachedArchive = join(cache, archiveName);
  let downloaded;
  try { downloaded = await readFile(cachedArchive); } catch { /* Download below. */ }
  if (!downloaded || sha256(downloaded) !== expected) {
    console.log(`正在下载官方 Node.js ${nodeVersion} Windows 运行环境…`);
    const response = await fetch(`${officialBase}/${archiveName}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error(`运行环境下载失败（HTTP ${response.status}）`);
    const partial = `${cachedArchive}.partial`;
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
      downloaded = await readFile(partial);
      if (sha256(downloaded) !== expected) throw new Error('官方运行环境 SHA-256 校验失败，已停止打包。');
      await rename(partial, cachedArchive);
    } finally { await rm(partial, { force: true }); }
  }
  if (sha256(downloaded) !== expected) throw new Error('运行环境完整性校验失败。');
  console.log('官方运行环境 SHA-256 校验通过。');

  const runtimeArchive = await JSZip.loadAsync(downloaded, { checkCRC32: true });
  const prefix = `node-${nodeVersion}-win-x64/`;
  const executable = runtimeArchive.file(`${prefix}node.exe`);
  const license = runtimeArchive.file(`${prefix}LICENSE`);
  if (!executable || !license) throw new Error('官方运行环境中缺少必要文件。');
  const nodeExe = await executable.async('nodebuffer');
  const peOffset = nodeExe.readUInt32LE(0x3c);
  if (nodeExe.toString('ascii', 0, 2) !== 'MZ' || nodeExe.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000' || nodeExe.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error('运行环境不是有效的 Windows x64 程序。');
  }

  await rm(output, { recursive: true, force: true });
  await mkdir(join(bundleRoot, 'runtime'), { recursive: true });
  await mkdir(join(bundleRoot, 'scripts'), { recursive: true });
  await mkdir(join(bundleRoot, 'backend'), { recursive: true });
  await writeFile(join(bundleRoot, 'runtime', 'node.exe'), nodeExe);
  await writeFile(join(bundleRoot, 'runtime', 'LICENSE-Node.txt'), await license.async('nodebuffer'));
  await copyTree(join(root, 'dist'), join(bundleRoot, 'dist'));
  for (const filename of ['server.mjs', 'content.mjs']) await copyFile(join(root, 'backend', filename), join(bundleRoot, 'backend', filename));
  await copyFile(join(root, 'scripts', 'launch.mjs'), join(bundleRoot, 'scripts', 'launch.mjs'));
  for (const filename of ['启动知页.bat', '.env.example', 'package.json']) await copyFile(join(root, filename), join(bundleRoot, filename));
  await writeFile(join(bundleRoot, 'portable.json'), JSON.stringify({ app: 'zhiye', version: '0.1.0', platform: 'win-x64', nodeVersion, source: `${officialBase}/${archiveName}`, sourceSha256: expected, runtimeSha256: sha256(nodeExe) }, null, 2) + '\n');
  const guide = [
    '知页 · AI 图文工作室 — Windows 免安装版',
    '',
    '适用：Windows 10 / 11，64 位 Intel 或 AMD 电脑。',
    '',
    '1. 右键压缩包，选择「全部解压」。请完整解压，不要在压缩包里直接启动。',
    '2. 打开解压后的「知页」文件夹，双击「启动知页.bat」。',
    '3. 默认浏览器会打开网页。第一次打开可能需要等待几秒。',
    '4. 使用时保留启动窗口；使用完关闭窗口即可。',
    '',
    '已经包含官方 Node.js 运行环境，不需要安装 Node.js、npm 或其他开发工具。',
    '生成示例、编辑卡片、保存作品、下载 PNG 和 ZIP 不需要模型密钥。',
    '需要生成新选题时，可在页面右上角配置兼容模型的服务地址、模型名称和 API Key。',
    '界面填写的 Key 只保存在运行期间的内存中，重启后需重新填写。',
    '作品保存在当前浏览器中；清理浏览器数据会清除作品，请及时下载保存。',
    '',
    '程序仅在本机地址启动，不会自动发布到抖音，也不会让外部设备访问。',
    '如果提示端口被其他程序占用，请关闭相应程序，或在 .env 中设置其他 API_PORT。',
    '如果页面没有自动打开，使用启动窗口显示的地址在浏览器中打开即可。',
    '',
    '图文可以编辑配色、比例、账号署名和每页文字。发布前请核对知识内容。',
  ].join('\r\n');
  await writeFile(join(bundleRoot, '先看这里.txt'), '\ufeff' + guide, 'utf8');

  const zip = new JSZip();
  async function addFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await addFiles(fullPath);
      else zip.file(relative(output, fullPath).replaceAll('\\', '/'), await readFile(fullPath));
    }
  }
  await addFiles(bundleRoot);
  const bundle = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
  await writeFile(outputZip, bundle);
  await writeFile(`${outputZip}.sha256`, sha256(bundle) + '  ' + '知页-Windows-免安装版.zip' + '\n');
  console.log(`Windows 免安装包已生成：${outputZip}`);
  console.log(`包含 ${Object.keys(zip.files).length} 个文件，${(bundle.length / 1024 / 1024).toFixed(1)} MB。`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
