import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireEditor: vi.fn(),
  generateStructured: vi.fn(),
  company: { data: null as Record<string, unknown> | null, error: null as unknown },
}));

vi.mock('@/lib/authz', () => ({ requireEditor: mocks.requireEditor }));
vi.mock('@/lib/ai/generate', () => ({ generateStructured: mocks.generateStructured }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => mocks.company }) }) }),
  }),
}));

import { POST } from '../route';

const editor = { id: 'user-1', organizationId: 'org-1', email: 'a@example.com', fullName: null, role: 'logger' };

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/ai/template', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

/** generateStructured に渡った validate を通して、成功の結果を返す */
const answerWith = (raw: unknown) =>
  mocks.generateStructured.mockImplementation(async (args: { validate: (value: unknown) => unknown }) => {
    const value = args.validate(raw);
    return value === null ? { ok: false, code: 'bad_response', message: 'AI の結果を解釈できませんでした' } : { ok: true, value, provider: 'google', modelId: 'model-x' };
  });

describe('POST /api/ai/template', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEditor.mockResolvedValue({ ok: true, profile: editor });
    mocks.company = { data: { name: '架空テクノロジーズ株式会社', hasBoardOfDirectors: true, hasAuditor: true }, error: null };
  });

  it('編集できる人でなければ 403 で、AI を呼ばない', async () => {
    mocks.requireEditor.mockResolvedValue({ ok: false, status: 403, error: '閲覧のみの権限では操作できません' });
    const response = await post({ mode: 'write', kind: 'shareholder_notice' });
    expect(response.status).toBe(403);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });

  it('種類・操作が正しくなければ 400', async () => {
    expect((await post({ mode: 'write', kind: 'toString' })).status).toBe(400);
    expect((await post({ mode: 'rewrite', kind: 'shareholder_notice' })).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });

  it('契約書の文面は、AI に書かせない', async () => {
    const response = await post({ mode: 'write', kind: 'convertible_contract' });
    expect(response.status).toBe(400);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });

  it('長すぎる要望・参考の文面・取り込む文面は 400', async () => {
    expect((await post({ mode: 'write', kind: 'other', request: 'あ'.repeat(2_001) })).status).toBe(400);
    expect((await post({ mode: 'write', kind: 'other', reference: 'あ'.repeat(20_001) })).status).toBe(400);
    expect((await post({ mode: 'convert', kind: 'convertible_contract', source: 'あ'.repeat(80_001) })).status).toBe(400);
    expect((await post({ mode: 'convert', kind: 'convertible_contract', source: '   ' })).status).toBe(400);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });

  it('ひな形を書かせるときは、機関設計と要望だけを送る（会社名などの台帳の値は送らない）', async () => {
    answerWith({ title: '臨時株主総会の招集通知', body: '株主各位\n{{会社名}}\n{{割当株式数}}', notes: [] });
    const response = await post({ mode: 'write', kind: 'shareholder_notice', request: '簡潔に' });
    expect(response.status).toBe(200);

    const args = mocks.generateStructured.mock.calls[0][0];
    expect(args.purpose).toBe('template_writing');
    expect(args.profile).toBe(editor);
    expect(args.instructions).toContain('{{開催日時}}');
    expect(args.input).toHaveLength(1);
    expect(args.input[0].text).toContain('- 取締役会設置会社');
    expect(args.input[0].text).toContain('【利用者からの要望】\n簡潔に');
    expect(args.input[0].text).not.toContain('架空テクノロジーズ');

    // 一覧に無い差し込み項目は【要確認】に置き換わって返る
    await expect(response.json()).resolves.toEqual({
      title: '臨時株主総会の招集通知',
      body: '株主各位\n{{会社名}}\n【要確認: 割当株式数】',
      notes: ['差し込み項目の一覧に無い名前（割当株式数）は、「【要確認】」に置き換えました。'],
      provider: 'google',
      modelId: 'model-x',
    });
  });

  it('空欄の置き換えは、AI の案をサーバが確かめてから適用する（空欄以外を変える案は使わない）', async () => {
    answerWith({
      replacements: [
        { find: '[発行会社名称]', replace: '{{会社名}}' },
        { find: '金●円を払い込む', replace: '金{{投資額}}円を直ちに払い込む' },
      ],
      notes: ['署名欄は自分で埋める'],
    });
    const source = '[発行会社名称]は、金●円を払い込む。\r\n署名: [発行会社名称]';
    const response = await post({ mode: 'convert', kind: 'convertible_contract', source });
    expect(response.status).toBe(200);

    const args = mocks.generateStructured.mock.calls[0][0];
    expect(args.purpose).toBe('template_writing');
    expect(args.instructions).toContain('あなたは文面を書き換えません');
    expect(args.input[0].text).toBe('【文面】\n[発行会社名称]は、金●円を払い込む。\n署名: [発行会社名称]');

    const body = await response.json();
    expect(body.body).toBe('{{会社名}}は、金●円を払い込む。\n署名: {{会社名}}');
    expect(body.applied).toEqual([{ before: '[発行会社名称]', after: '{{会社名}}', names: ['会社名'], count: 2 }]);
    expect(body.skipped).toHaveLength(1);
    expect(body.remainingBlanks).toBe(1);
    expect(body.notes).toEqual(['署名欄は自分で埋める']);
  });

  it('AI の失敗は 502、回数の上限は 429 で返す', async () => {
    mocks.generateStructured.mockResolvedValue({ ok: false, code: 'not_configured', message: 'AI はまだ使えません。管理者に確認してください' });
    const failed = await post({ mode: 'write', kind: 'other' });
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: 'AI はまだ使えません。管理者に確認してください', code: 'not_configured' });

    mocks.generateStructured.mockResolvedValue({ ok: false, code: 'limit_exceeded', message: '上限' });
    expect((await post({ mode: 'convert', kind: 'other', source: '●' })).status).toBe(429);
  });

  it('会社情報を読めなければ、AI を呼ばずに 500', async () => {
    mocks.company = { data: null, error: { message: 'down' } };
    const response = await post({ mode: 'write', kind: 'shareholder_notice' });
    expect(response.status).toBe(500);
    expect(mocks.generateStructured).not.toHaveBeenCalled();
  });
});
