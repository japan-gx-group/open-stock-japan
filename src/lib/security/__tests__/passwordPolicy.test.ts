import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_ERROR,
  PASSWORD_POLICY_HINT,
  PASSWORD_TOO_LONG_ERROR,
  isWeakPasswordError,
  toPasswordSaveErrorMessage,
  validateNewPassword,
} from '../passwordPolicy';

describe('validateNewPassword', () => {
  it('12 文字以上で、英字と数字を含めば通す', () => {
    for (const password of ['abcdefghijk1', 'A1bcdefghijk', 'correct-horse-battery-9', 'パスワードabc123456789']) {
      expect(validateNewPassword(password), password).toBeNull();
    }
  });

  it('12 文字に満たなければ弾く（11 文字は不可、12 文字は可）', () => {
    expect(validateNewPassword('abcdefghi12')).toBe(PASSWORD_POLICY_ERROR);
    expect('abcdefghi12').toHaveLength(PASSWORD_MIN_LENGTH - 1);
    expect(validateNewPassword('abcdefghij12')).toBeNull();
  });

  it('数字が無ければ弾く', () => {
    expect(validateNewPassword('abcdefghijklmnop')).toBe(PASSWORD_POLICY_ERROR);
  });

  it('英字が無ければ弾く', () => {
    expect(validateNewPassword('1234567890123456')).toBe(PASSWORD_POLICY_ERROR);
    expect(validateNewPassword('1234-5678-9012-3456')).toBe(PASSWORD_POLICY_ERROR);
  });

  it('全角の英数字は、英字・数字として数えない（認証サービスと同じ数え方）', () => {
    expect(validateNewPassword('ａｂｃｄｅｆｇｈｉｊｋｌ１２３')).toBe(PASSWORD_POLICY_ERROR);
  });

  it('文字数は、絵文字などのサロゲートペアを 1 文字として数える', () => {
    // 見た目は 7 文字。UTF-16 の長さ（14）では数えない
    expect(validateNewPassword('a1😀😀😀😀😀')).toBe(PASSWORD_POLICY_ERROR);
  });

  it('72 バイトを超えるものは弾く（認証サービスが保存できない）', () => {
    expect(validateNewPassword(`a1${'x'.repeat(70)}`)).toBeNull();
    expect(validateNewPassword(`a1${'x'.repeat(71)}`)).toBe(PASSWORD_TOO_LONG_ERROR);
    // 日本語は 1 文字 3 バイト
    expect(validateNewPassword(`abc123${'あ'.repeat(23)}`)).toBe(PASSWORD_TOO_LONG_ERROR);
  });

  it('文字列でない値は弾く（Server Action は任意の値で呼べる）', () => {
    for (const value of [undefined, null, 123456789012, {}, ['abcdefghijk1']]) {
      expect(validateNewPassword(value)).toBe(PASSWORD_POLICY_ERROR);
    }
  });

  it('案内とエラーの文言に、同じ決まり（文字数・英字・数字）が入っている', () => {
    for (const text of [PASSWORD_POLICY_HINT, PASSWORD_POLICY_ERROR]) {
      expect(text).toContain(`${PASSWORD_MIN_LENGTH}文字以上`);
      expect(text).toContain('英字');
      expect(text).toContain('数字');
    }
  });
});

describe('認証サービスのエラーの読み替え', () => {
  it('weak_password は、決まりの文言にする', () => {
    const weak = { code: 'weak_password', status: 422, message: 'Password should be at least 12 characters.' };
    expect(isWeakPasswordError(weak)).toBe(true);
    expect(toPasswordSaveErrorMessage(weak, 'パスワードの更新に失敗しました')).toBe(PASSWORD_POLICY_ERROR);
  });

  it('それ以外のエラーは、呼び出し側の文言のまま', () => {
    const other = { code: 'unexpected_failure', status: 500, message: 'boom' };
    expect(isWeakPasswordError(other)).toBe(false);
    expect(isWeakPasswordError(null)).toBe(false);
    expect(toPasswordSaveErrorMessage(other, 'パスワードの更新に失敗しました')).toBe('パスワードの更新に失敗しました');
    expect(toPasswordSaveErrorMessage(null, 'x')).toBe('x');
  });
});
