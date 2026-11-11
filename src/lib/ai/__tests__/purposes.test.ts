import { describe, expect, it } from 'vitest';
import { AI_PURPOSES, DEFAULT_MAX_INPUT_BYTES, findAiPurpose } from '../purposes';

describe('findAiPurpose', () => {
  it('登録していない用途は undefined（Object の組み込みの名前も用途として扱わない）', () => {
    expect(findAiPurpose('document_extraction_not_registered')).toBeUndefined();
    expect(findAiPurpose('toString')).toBeUndefined();
    expect(findAiPurpose('__proto__')).toBeUndefined();
  });

  it('登録済みの用途は 4 つ（文書からの読取り・入力の補助・文章の下書き・文書テンプレートの作成）', () => {
    expect(Object.keys(AI_PURPOSES).sort()).toEqual(['document_extraction', 'draft_writing', 'form_assist', 'template_writing']);
  });

  // 文章の下書きと文書テンプレートの作成にはファイルを送らない（文字だけ）。読取りと入力の補助はファイルも送れる。
  it('用途ごとに、送れる入力の種類・回数の上限・出力の上限が決まっている', () => {
    expect(findAiPurpose('document_extraction')).toMatchObject({
      inputs: ['pdf', 'image', 'text'],
      limits: { perMinute: 10, perDay: 200 },
      maxOutputTokens: 8_000,
    });
    expect(findAiPurpose('form_assist')).toMatchObject({
      inputs: ['text', 'pdf', 'image'],
      limits: { perMinute: 20, perDay: 400 },
      maxOutputTokens: 4_000,
    });
    expect(findAiPurpose('draft_writing')).toMatchObject({
      inputs: ['text'],
      limits: { perMinute: 10, perDay: 200 },
      maxOutputTokens: 6_000,
    });
    expect(findAiPurpose('template_writing')).toMatchObject({
      inputs: ['text'],
      limits: { perMinute: 6, perDay: 100 },
      maxOutputTokens: 12_000,
    });
  });

  it('登録済みの用途は、送れる量が既定の上限（Vercel の本文の上限に収まる 4MB）以下', () => {
    for (const purpose of Object.values(AI_PURPOSES)) {
      expect((purpose as { maxInputBytes: number }).maxInputBytes).toBeLessThanOrEqual(DEFAULT_MAX_INPUT_BYTES);
    }
  });
});
