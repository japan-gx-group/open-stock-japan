import { describe, expect, it } from 'vitest';
import { MAX_MFA_FACTORS, mfaLockedMessage, normalizeMfaCode } from '../mfaCode';

describe('normalizeMfaCode', () => {
  it('6 桁の数字はそのまま', () => {
    expect(normalizeMfaCode('012345')).toBe('012345');
  });

  it('空白・ハイフン・全角の数字をそろえる', () => {
    expect(normalizeMfaCode(' 123 456 ')).toBe('123456');
    expect(normalizeMfaCode('123-456')).toBe('123456');
    expect(normalizeMfaCode('１２３４５６')).toBe('123456');
    expect(normalizeMfaCode('１２３　４５６')).toBe('123456');
  });

  it('6 桁の数字でなければ null', () => {
    for (const value of ['', '12345', '1234567', 'abcdef', '12a456', '12.456']) {
      expect(normalizeMfaCode(value), value).toBeNull();
    }
  });

  it('文字列でない値は null（Server Action は任意の値で呼べる）', () => {
    for (const value of [undefined, null, 123456, ['123456'], {}]) {
      expect(normalizeMfaCode(value)).toBeNull();
    }
  });
});

describe('文言と上限', () => {
  it('止めているときの文言に、残りの分数が入る', () => {
    expect(mfaLockedMessage(7)).toContain('約7分後');
  });

  it('登録できる機器は 2 台（ふだんの 1 台と予備の 1 台）', () => {
    expect(MAX_MFA_FACTORS).toBe(2);
  });
});
