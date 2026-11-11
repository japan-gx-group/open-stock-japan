// 改ざんの検査の入力と結果の読み取り。サーバ依存なしの純粋な関数。

import type { ChainVerifyResult } from '../types';
import type { Parsed } from './filters';

export interface Anchor {
  seq: number;
  hash: string;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SEQ_PATTERN = /^[1-9]\d{0,14}$/;

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

/**
 * 以前に控えた連番とハッシュ（本文の anchorSeq / anchorHash）を読む。
 * どちらも空なら「控えなし」（null）。片方だけ・形が正しくないものはエラーにする。
 */
export const parseAnchor = (body: unknown): Parsed<Anchor | null> => {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const seq = textOf(input.anchorSeq).replace(/,/g, '');
  const hash = textOf(input.anchorHash).toLowerCase();
  if (!seq && !hash) return { ok: true, value: null };
  if (!seq || !hash) return { ok: false, error: '控えた連番とハッシュは、両方を入力してください' };
  if (!SEQ_PATTERN.test(seq)) return { ok: false, error: '控えた連番は 1 以上の整数で入力してください' };
  if (!HASH_PATTERN.test(hash)) return { ok: false, error: '控えたハッシュは 64 文字の英数字（0〜9・a〜f）で入力してください' };
  return { ok: true, value: { seq: Number(seq), hash } };
};

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** DB の関数 verify_audit_log_chain の戻り値を読む。形が違えば null（検査できなかったものとして扱う） */
export const toVerifyResult = (data: unknown): ChainVerifyResult | null => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  if (value.ok === true) {
    if (!isCount(value.count) || !isCount(value.lastSeq) || typeof value.lastHash !== 'string') return null;
    return {
      ok: true,
      count: value.count,
      lastSeq: value.lastSeq,
      lastHash: value.lastHash,
      legacyCount: isCount(value.legacyCount) ? value.legacyCount : 0,
      checkedAt: typeof value.checkedAt === 'string' ? value.checkedAt : '',
    };
  }
  if (value.ok === false) {
    if (typeof value.reason !== 'string' || !isCount(value.seq)) return null;
    return {
      ok: false,
      reason: value.reason,
      seq: value.seq,
      count: isCount(value.count) ? value.count : 0,
      ...(isCount(value.expectedSeq) ? { expectedSeq: value.expectedSeq } : {}),
    };
  }
  return null;
};
