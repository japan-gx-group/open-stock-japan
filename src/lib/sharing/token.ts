// 共有リンクのトークンの生成とハッシュ（サーバ用。node:crypto を使う）。
//
// トークンは 32 バイトの乱数を base64url にしたもの（43 文字）。作った人に 1 回だけ見せ、
// DB には SHA-256（16 進 64 文字）だけを保存する。DB が漏れてもリンクは復元できない。
//
// ブラウザ側のコード（'use client' のファイルと、そこから読み込まれるファイル）は、このファイルではなく
// linkRules.ts を読み込むこと。このファイルを読み込むと、node:crypto の代替実装がブラウザ用のバンドルに入る。

import { createHash, randomBytes } from 'node:crypto';

export const SHARE_TOKEN_BYTES = 32;

export const generateShareToken = (): string => randomBytes(SHARE_TOKEN_BYTES).toString('base64url');

export const hashShareToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

// 有効期間・状態・トークンの形の決まりは linkRules.ts にある（サーバ側の読み込み口をここに揃える）
export {
  expiryFromDays,
  isShareTokenFormat,
  parseExpiryDays,
  SHARE_LINK_DEFAULT_DAYS,
  SHARE_LINK_MAX_DAYS,
  SHARE_LINK_MIN_DAYS,
  shareLinkStatus,
  type ShareLinkStatus,
} from './linkRules';
