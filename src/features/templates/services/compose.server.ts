// テンプレートから文書を作る（サーバ専用）。台帳の行を読み、差し込み項目を値に置き換える。AI は使わない。
//
// 呼び出し側（Route Handler）が requireInternal でロールを確かめてから呼ぶ。組織 ID は profile から取り、
// テンプレートも、対象（会議・転換型証券の回次・投資）も、すべて自組織の行だけを読む。
// 文書は保存しない（画面でコピー・保存・印刷する）。作ったこと（だれが・どのテンプレートで・何を対象に）は監査ログに残す。

import 'server-only';
import type { CurrentProfile } from '@/lib/currentProfile';
import { todayInTokyo } from '@/lib/equity/format';
import { COMPANY_COLUMNS } from '@/lib/resources/company';
import type { ResourceValues } from '@/lib/resources/fields';
import { isUuid } from '@/lib/resources/fields';
import { getResourceRow, listResource, recordAudit } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fillTemplate, type TemplateValues } from './fill';
import { getTemplateKind, isTemplateKindId, scopesOfKind } from './kinds';
import { companyValues, investmentValues, meetingValues, roundValues, withAllNames, type RoundInvestment } from './values';

type Actor = Pick<CurrentProfile, 'id' | 'organizationId'>;

export interface ComposeInput {
  templateId: unknown;
  /** 会議、または転換型証券の回次の id（種類によっては不要） */
  subjectId?: unknown;
  /** 投資家 1 名ずつ作る種類のときの、投資の id */
  investmentId?: unknown;
}

export interface ComposedDocument {
  /** 文書の名前（ファイル名・印刷の見出しに使う） */
  title: string;
  text: string;
  /** 台帳に値が無く、【要確認】にした差し込み項目 */
  missing: string[];
  /** 置き換えられなかった名前（一覧に無い・この種類では使えない） */
  unknown: string[];
  /** テンプレートと対象が合っていないときの注意（書面決議の会議に、開催する会議用のテンプレートを使った、など） */
  warnings: string[];
  templateStatus: string;
}

export type ComposeResult = { ok: true; data: ComposedDocument } | { ok: false; status: 400 | 404 | 500; error: string };

const fail = (status: 400 | 404 | 500, error: string): ComposeResult => ({ ok: false, status, error });

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

export const composeDocument = async (actor: Actor, input: ComposeInput): Promise<ComposeResult> => {
  if (!isUuid(input.templateId)) return fail(400, 'テンプレートを選んでください');
  const admin = createAdminClient();
  const organizationId = actor.organizationId;

  const template = await getResourceRow('document-templates', organizationId, input.templateId, admin);
  if (!template) return fail(404, 'テンプレートが見つかりません');
  if (!isTemplateKindId(template.kind)) return fail(400, 'テンプレートの種類が正しくありません');
  const kind = getTemplateKind(template.kind);
  const scopes = scopesOfKind(kind);

  const { data: company, error: companyError } = await admin
    .from('organizations')
    .select(COMPANY_COLUMNS)
    .eq('id', organizationId)
    .single();
  if (companyError || !company) return fail(500, '会社情報の取得に失敗しました');

  let values: TemplateValues = companyValues(company as unknown as ResourceValues, todayInTokyo());
  let subjectLabel = '';
  let subjectTable: string | null = null;
  const warnings: string[] = [];

  try {
    if (kind.subject === 'shareholder_meeting' || kind.subject === 'board_meeting') {
      if (!isUuid(input.subjectId)) return fail(400, '会議を選んでください');
      const meeting = await getResourceRow('meetings', organizationId, input.subjectId, admin);
      const board = kind.subject === 'board_meeting';
      // 株主総会のテンプレートを取締役会に（またはその逆に）使わせない
      if (!meeting || (meeting.meetingType === 'board') !== board) return fail(404, '会議が見つかりません');
      const [agendaItems, responses, fiscalYears] = await Promise.all([
        listResource('meeting-agenda-items', organizationId, { meetingId: meeting.id }, admin),
        listResource('meeting-responses', organizationId, { meetingId: meeting.id }, admin),
        meeting.fiscalYearId ? listResource('fiscal-years', organizationId, {}, admin) : Promise.resolve([]),
      ]);
      const fiscalYearLabel = textOf(fiscalYears.find((row) => row.id === meeting.fiscalYearId)?.label) || null;
      const written = meeting.format === 'written_resolution';
      if (kind.meetingUse && kind.meetingUse.written !== written) {
        warnings.push(
          written
            ? 'この会議は書面決議です。このテンプレートは、開催する会議のためのものです。書面決議用のテンプレートを使ってください。'
            : 'このテンプレートは書面決議のためのものです。この会議は書面決議ではありません。',
        );
      }
      values = { ...values, ...meetingValues({ meeting, agendaItems, responses, fiscalYearLabel }) };
      subjectLabel = textOf(meeting.title);
      subjectTable = 'meetings';
    } else if (kind.subject === 'convertible_round') {
      if (!isUuid(input.subjectId)) return fail(400, '転換型証券の回次を選んでください');
      const round = await getResourceRow('convertible-rounds', organizationId, input.subjectId, admin);
      if (!round) return fail(404, '転換型証券の回次が見つかりません');
      const [investments, stakeholders] = await Promise.all([
        listResource('convertible-investments', organizationId, { roundId: round.id }, admin),
        listResource('stakeholders', organizationId, {}, admin),
      ]);
      const stakeholderById = new Map(stakeholders.map((row) => [row.id, row]));
      const entries: RoundInvestment[] = investments.map((investment) => ({
        investment,
        stakeholder: stakeholderById.get(textOf(investment.stakeholderId)) ?? null,
      }));
      values = { ...values, ...roundValues(round, entries) };
      subjectLabel = textOf(round.name);
      subjectTable = 'convertible_rounds';

      if (kind.perInvestor) {
        if (!isUuid(input.investmentId)) return fail(400, '投資家を選んでください');
        const entry = entries.find(({ investment }) => investment.id === input.investmentId);
        if (!entry) return fail(404, '投資の記録が見つかりません');
        values = { ...values, ...investmentValues(entry) };
        const investorName = textOf(entry.stakeholder?.name);
        if (investorName) subjectLabel = `${subjectLabel}_${investorName}`;
      }
    }
  } catch {
    return fail(500, '台帳の取得に失敗しました');
  }

  const filled = fillTemplate(textOf(template.body), withAllNames(values, scopes));
  const templateTitle = textOf(template.title);
  await recordAudit(admin, actor, 'document-templates.compose', 'document_templates', template.id, {
    label: templateTitle,
    kind: kind.id,
    ...(subjectTable && isUuid(input.subjectId) ? { subjectTable, subjectId: input.subjectId } : {}),
    ...(kind.perInvestor && isUuid(input.investmentId) ? { investmentId: input.investmentId } : {}),
    missing: filled.missing.length,
  });

  return {
    ok: true,
    data: {
      title: subjectLabel ? `${subjectLabel}_${templateTitle}` : templateTitle,
      text: filled.text,
      missing: filled.missing,
      unknown: filled.unknown,
      warnings,
      templateStatus: textOf(template.status),
    },
  };
};
