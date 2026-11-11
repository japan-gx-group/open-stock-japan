// src/app/icon.svg から、ブラウザのタブ用の favicon.ico と、ホーム画面用の apple-icon.png を書き出す。
//
// 使い方（アイコンの形を変えたときに実行する）:
//   node scripts/brand/build-favicon.mjs
//
// 置き場所を src/app/ にしているのは、Next.js のファイル規約（icon / favicon / apple-icon）に乗せるため。
// 規約に乗せると <link rel="icon"> の URL に内容のハッシュが付き、アイコンを変えたときにブラウザの古いキャッシュが残らない。
// favicon.ico は、SVG のアイコンを読まないブラウザと、/favicon.ico を直接取りに来るもののために置く。

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/app');
const source = await readFile(resolve(appDir, 'icon.svg'));

const ICO_SIZES = [16, 32, 48];
const APPLE_ICON_SIZE = 180;

const renderPng = (size) => sharp(source, { density: 72 * (size / 48) * 8 }).resize(size, size).png().toBuffer();

// ICO は「見出し 6 バイト + 画像ごとの目次 16 バイト + 画像本体」。画像本体には PNG をそのまま入れられる。
const buildIco = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // 予約
  header.writeUInt16LE(1, 2); // 種類: アイコン
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0); // 幅
    entry.writeUInt8(size, 1); // 高さ
    entry.writeUInt8(0, 2); // パレットの色数（使わない）
    entry.writeUInt8(0, 3); // 予約
    entry.writeUInt16LE(1, 4); // カラープレーン
    entry.writeUInt16LE(32, 6); // 1 ピクセルのビット数
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
};

const icoImages = await Promise.all(ICO_SIZES.map(async (size) => ({ size, data: await renderPng(size) })));
await writeFile(resolve(appDir, 'favicon.ico'), buildIco(icoImages));
await writeFile(resolve(appDir, 'apple-icon.png'), await renderPng(APPLE_ICON_SIZE));

console.log(`favicon.ico（${ICO_SIZES.join('・')}px）と apple-icon.png（${APPLE_ICON_SIZE}px）を書き出しました`);
