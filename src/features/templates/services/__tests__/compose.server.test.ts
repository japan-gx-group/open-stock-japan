import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceRow } from '@/lib/resources/fields';

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  lists: new Map<string, Record<string, unknown>[]>(),
  recordAudit: vi.fn(),
  listCalls: [] as { name: string; organizationId: string; filters: Record<string, string> }[],
  company: { data: null as Record<string, unknown> | null, error: null as unknown },
}));

vi.mock('@/lib/resources/server', () => ({
  // 組織を付けて引く（別の組織の行は見つからない）
  getResourceRow: async (name: string, organizationId: string, id: string) => (mocks.rows.get(`${name}:${organizationId}:${id}`) as ResourceRow) ?? null,
  listResource: async (name: string, organizationId: string, filters: Record<string, string> = {}) => {
    mocks.listCalls.push({ name, organizationId, filters });
    return (mocks.lists.get(name) ?? []) as ResourceRow[];
  },
  recordAudit: mocks.recordAudit,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => mocks.company }) }) }),
  }),
}));

import { composeDocument } from '../compose.server';

const ORG = 'org-1';
const actor = { id: 'user-1', organizationId: ORG };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TEMPLATE = id(1);
const MEETING = id(2);
const BOARD = id(3);
const ROUND = id(4);
const INVESTMENT = id(5);
const STAKEHOLDER = id(6);

const put = (name: string, row: Record<string, unknown>, organizationId = ORG) => mocks.rows.set(`${name}:${organizationId}:${row.id}`, row);

describe('composeDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.clear();
    mocks.lists.clear();
    mocks.listCalls.length = 0;
    mocks.company = { data: { name: '架空テクノロジーズ株式会社', representativeTitle: '代表取締役', representativeName: '創業 太郎' }, error: null };
    put('meetings', { id: MEETING, meetingType: 'egm', title: '臨時株主総会', format: 'in_person', heldOn: '2026-12-10', startTime: '10:00', place: '本店会議室', fiscalYearId: null });
    put('meetings', { id: BOARD, meetingType: 'board', title: '第19回 取締役会', format: 'in_person', heldOn: '2026-12-18' });
    put('convertible-rounds', { id: ROUND, name: '第2回 J-KISS 型新株予約権', instrumentType: 'jkiss', valuationCap: 2_500_000_000, capBasis: 'post_money', discountRate: 0.2, issueDate: '2026-12-01' });
    mocks.lists.set('convertible-investments', [{ id: INVESTMENT, roundId: ROUND, stakeholderId: STAKEHOLDER, amount: 50_000_000, investmentDate: '2026-12-01' }]);
    mocks.lists.set('stakeholders', [{ id: STAKEHOLDER, name: '架空事業会社株式会社', address: '東京都架空区' }]);
  });

  it('会議のテンプレート: 差し込み項目を、会社と会議の値に置き換える', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'shareholder_notice', title: '招集通知', status: 'reviewed', body: '{{会社名}} {{代表者}}\n{{会議の名称}} {{開催日時}} {{開催場所}} {{議長}}' });
    const result = await composeDocument(actor, { templateId: TEMPLATE, subjectId: MEETING });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).toBe('架空テクノロジーズ株式会社 代表取締役　創業 太郎\n臨時株主総会 令和8年12月10日（木曜日）午前10時00分 本店会議室 【要確認: 議長】');
    expect(result.data.missing).toEqual(['議長']);
    expect(result.data.title).toBe('臨時株主総会_招集通知');
    expect(result.data.templateStatus).toBe('reviewed');
    // 議案・出欠は、この会議のものだけを、自分の組織で読む
    expect(mocks.listCalls).toEqual([
      { name: 'meeting-agenda-items', organizationId: ORG, filters: { meetingId: MEETING } },
      { name: 'meeting-responses', organizationId: ORG, filters: { meetingId: MEETING } },
    ]);
  });

  it('作ったことを監査ログに残す（文面は残さない）', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'shareholder_notice', title: '招集通知', status: 'draft', body: '{{会社名}}の秘密の文面' });
    await composeDocument(actor, { templateId: TEMPLATE, subjectId: MEETING });
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    const [, auditActor, action, entityName, entityId, detail] = mocks.recordAudit.mock.calls[0];
    expect(auditActor).toBe(actor);
    expect(action).toBe('document-templates.compose');
    expect(entityName).toBe('document_templates');
    expect(entityId).toBe(TEMPLATE);
    expect(detail).toEqual({ label: '招集通知', kind: 'shareholder_notice', subjectTable: 'meetings', subjectId: MEETING, missing: 0 });
    expect(JSON.stringify(detail)).not.toContain('秘密の文面');
  });

  it('株主総会のテンプレートを取締役会に（またはその逆に）使わせない', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'shareholder_notice', title: '招集通知', status: 'draft', body: '{{会議の名称}}' });
    const result = await composeDocument(actor, { templateId: TEMPLATE, subjectId: BOARD });
    expect(result).toEqual({ ok: false, status: 404, error: '会議が見つかりません' });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('別の組織のテンプレート・会議は見つからない', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'shareholder_notice', title: '他社', status: 'draft', body: 'x' }, 'org-2');
    expect(await composeDocument(actor, { templateId: TEMPLATE, subjectId: MEETING })).toMatchObject({ ok: false, status: 404 });

    put('document-templates', { id: TEMPLATE, kind: 'shareholder_notice', title: '自社', status: 'draft', body: 'x' });
    const other = id(9);
    put('meetings', { id: other, meetingType: 'egm', title: '他社の総会', format: 'in_person' }, 'org-2');
    expect(await composeDocument(actor, { templateId: TEMPLATE, subjectId: other })).toMatchObject({ ok: false, status: 404 });
  });

  it('id の形が正しくない・対象を選んでいないときは 400', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'shareholder_notice', title: '招集通知', status: 'draft', body: 'x' });
    expect(await composeDocument(actor, { templateId: 'abc' })).toMatchObject({ ok: false, status: 400 });
    expect(await composeDocument(actor, { templateId: TEMPLATE })).toMatchObject({ ok: false, status: 400, error: '会議を選んでください' });
    expect(await composeDocument(actor, { templateId: TEMPLATE, subjectId: { id: MEETING } })).toMatchObject({ ok: false, status: 400 });
  });

  it('書面決議の会議に、開催する会議用のテンプレートを使うと、注意を返す', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'shareholder_minutes', title: '議事録', status: 'reviewed', body: '{{会議の名称}}' });
    const written = id(7);
    put('meetings', { id: written, meetingType: 'egm', title: '書面決議', format: 'written_resolution', heldOn: '2026-10-16' });
    const result = await composeDocument(actor, { templateId: TEMPLATE, subjectId: written });
    expect(result.ok && result.data.warnings).toEqual(['この会議は書面決議です。このテンプレートは、開催する会議のためのものです。書面決議用のテンプレートを使ってください。']);
    const inPerson = await composeDocument(actor, { templateId: TEMPLATE, subjectId: MEETING });
    expect(inPerson.ok && inPerson.data.warnings).toEqual([]);
  });

  it('転換型証券のテンプレート: 回次の条件と投資家を入れる', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'convertible_terms', title: '条件のまとめ', status: 'reviewed', body: '{{回次の名称}} 金{{評価上限額}}円 {{ディスカウント率}}% {{登記の期限}}\n{{投資家の一覧}}\n{{投資家名}}' });
    const result = await composeDocument(actor, { templateId: TEMPLATE, subjectId: ROUND });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).toBe(
      '第2回 J-KISS 型新株予約権 金2,500,000,000円 20% 令和8年12月15日\n架空事業会社株式会社　金50,000,000円（払込日: 令和8年12月1日）\n【要確認: 投資家名】',
    );
    // 投資家 1 名ずつの項目は、この種類では使えない（値が無いのではなく、置き換えられない名前として返す）
    expect(result.data.unknown).toEqual(['投資家名']);
    expect(result.data.missing).toEqual([]);
  });

  it('投資家 1 名ずつ作る種類は、その回次の投資を選ばないと作れない', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'convertible_payment_notice', title: '払込みの案内', status: 'draft', body: '{{投資家名}} 御中 金{{投資額}}円 {{払込日}}' });
    expect(await composeDocument(actor, { templateId: TEMPLATE, subjectId: ROUND })).toMatchObject({ ok: false, status: 400, error: '投資家を選んでください' });
    // この回次に無い投資（別の回次・別の組織の id）は見つからない
    expect(await composeDocument(actor, { templateId: TEMPLATE, subjectId: ROUND, investmentId: id(8) })).toMatchObject({ ok: false, status: 404 });

    const result = await composeDocument(actor, { templateId: TEMPLATE, subjectId: ROUND, investmentId: INVESTMENT });
    expect(result.ok && result.data.text).toBe('架空事業会社株式会社 御中 金50,000,000円 令和8年12月1日');
    expect(result.ok && result.data.title).toBe('第2回 J-KISS 型新株予約権_架空事業会社株式会社_払込みの案内');
    expect(mocks.recordAudit.mock.calls[0][5]).toMatchObject({ subjectTable: 'convertible_rounds', subjectId: ROUND, investmentId: INVESTMENT });
  });

  it('会社の文書（その他）は、対象を選ばずに作れる', async () => {
    put('document-templates', { id: TEMPLATE, kind: 'other', title: '通知', status: 'draft', body: '{{会社名}} {{作成日（西暦）}}' });
    const result = await composeDocument(actor, { templateId: TEMPLATE });
    expect(result.ok && result.data.text).toMatch(/^架空テクノロジーズ株式会社 \d{4}年\d{1,2}月\d{1,2}日$/);
    expect(result.ok && result.data.title).toBe('通知');
  });
});
