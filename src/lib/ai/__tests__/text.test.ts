import { describe, expect, it } from 'vitest';
import { normalizeAiText } from '../text';

describe('normalizeAiText', () => {
  it('文字としての \\n を本物の改行に直す', () => {
    expect(normalizeAiText('# 見出し\\n\\n- 項目1\\n- 項目2')).toBe('# 見出し\n\n- 項目1\n- 項目2');
    expect(normalizeAiText('一行目\\r\\n二行目')).toBe('一行目\n二行目');
  });

  it('本物の改行はそのまま、CRLF は LF にそろえる', () => {
    expect(normalizeAiText('一行目\r\n二行目\n三行目')).toBe('一行目\n二行目\n三行目');
  });

  it('改行の無い文章は変えない', () => {
    expect(normalizeAiText('第1号議案 計算書類承認の件')).toBe('第1号議案 計算書類承認の件');
  });
});
