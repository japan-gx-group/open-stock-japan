import { describe, expect, it } from 'vitest';
import { parseAnchor, toVerifyResult } from '../verify';

const HASH = 'f5d3c2eef0581228f800a0a8cd805e3cecb0673442defb2c354363e4cf39b5ab';

describe('parseAnchor', () => {
  it('どちらも無ければ「控えなし」', () => {
    expect(parseAnchor(null)).toEqual({ ok: true, value: null });
    expect(parseAnchor({})).toEqual({ ok: true, value: null });
    expect(parseAnchor({ anchorSeq: ' ', anchorHash: '' })).toEqual({ ok: true, value: null });
    expect(parseAnchor('文字')).toEqual({ ok: true, value: null });
    expect(parseAnchor([1, 2])).toEqual({ ok: true, value: null });
  });

  it('連番（数値でも文字でも、桁区切りつきでも）とハッシュ（大文字でも）を読む', () => {
    expect(parseAnchor({ anchorSeq: '1,200', anchorHash: ` ${HASH.toUpperCase()} ` })).toEqual({ ok: true, value: { seq: 1200, hash: HASH } });
    expect(parseAnchor({ anchorSeq: 21, anchorHash: HASH })).toEqual({ ok: true, value: { seq: 21, hash: HASH } });
  });

  it('片方だけ・形の違うものはエラーにする', () => {
    expect(parseAnchor({ anchorSeq: '21' }).ok).toBe(false);
    expect(parseAnchor({ anchorHash: HASH }).ok).toBe(false);
    expect(parseAnchor({ anchorSeq: '0', anchorHash: HASH }).ok).toBe(false);
    expect(parseAnchor({ anchorSeq: '-1', anchorHash: HASH }).ok).toBe(false);
    expect(parseAnchor({ anchorSeq: '1.5', anchorHash: HASH }).ok).toBe(false);
    expect(parseAnchor({ anchorSeq: '21', anchorHash: 'abc' }).ok).toBe(false);
    expect(parseAnchor({ anchorSeq: '21', anchorHash: `${HASH.slice(0, 63)}g` }).ok).toBe(false);
    expect(parseAnchor({ anchorSeq: { $gt: 0 }, anchorHash: HASH }).ok).toBe(false);
  });
});

describe('toVerifyResult', () => {
  it('問題なしの結果を読む', () => {
    expect(toVerifyResult({ ok: true, count: 41, lastSeq: 41, lastHash: HASH, legacyCount: 6, checkedAt: '2026-11-11T04:05:17+00:00' })).toEqual({
      ok: true,
      count: 41,
      lastSeq: 41,
      lastHash: HASH,
      legacyCount: 6,
      checkedAt: '2026-11-11T04:05:17+00:00',
    });
  });

  it('記録が 1 件も無い組織（連番 0・ハッシュは空）も読める', () => {
    expect(toVerifyResult({ ok: true, count: 0, lastSeq: 0, lastHash: '', legacyCount: 0, checkedAt: 'x' })).toMatchObject({ ok: true, count: 0, lastHash: '' });
  });

  it('問題ありの結果を読む（本来の連番は、連番が飛んだときだけ）', () => {
    expect(toVerifyResult({ ok: false, reason: 'gap', seq: 12, expectedSeq: 11, count: 11 })).toEqual({ ok: false, reason: 'gap', seq: 12, expectedSeq: 11, count: 11 });
    expect(toVerifyResult({ ok: false, reason: 'hash_mismatch', seq: 5, count: 5 })).toEqual({ ok: false, reason: 'hash_mismatch', seq: 5, count: 5 });
  });

  it('形の違う値は null（検査できなかったものとして扱い、「問題なし」に見せない）', () => {
    expect(toVerifyResult(null)).toBeNull();
    expect(toVerifyResult('ok')).toBeNull();
    expect(toVerifyResult([])).toBeNull();
    expect(toVerifyResult({})).toBeNull();
    expect(toVerifyResult({ ok: true })).toBeNull();
    expect(toVerifyResult({ ok: true, count: '41', lastSeq: 41, lastHash: HASH })).toBeNull();
    expect(toVerifyResult({ ok: false, seq: 5 })).toBeNull();
    expect(toVerifyResult({ ok: 'true', count: 1, lastSeq: 1, lastHash: HASH })).toBeNull();
  });
});
