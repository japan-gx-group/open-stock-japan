// 確認画面の行を作り（照合つき）、行ごとの問題・注意を調べる（純関数）。
//
// 画面（確認しながら直す）とサーバ（反映の直前にもう一度）の両方が同じ関数を使う。
// サーバは画面から送られた行を信じず、今の台帳（ImportContext）を読み直してから checkReview を通す。

import { formatNumber, formatShares, formatYen, parseNumberText } from '@/lib/equity/format';
import { COMPANY_DEF } from '@/lib/resources/company';
import { emptyFormValue, isUuid, parseFieldValue, parseResourceInput, toFormValue, type FieldDef } from '@/lib/resources/fields';
import { minimumCapitalIncrease } from '@/lib/legal/rules';
import { CAPITAL_TRANSACTION_TYPES, type ShareTransactionType } from '@/lib/equity/types';
import { groupsOfKind, GROUP_SPECS, resourceDefOf, reviewDefaultsOf, reviewFieldsOf, type GroupSpec, type RefSpec, type RefTarget } from './groups';
import { matchFiscalYear, matchShareClass, matchStakeholder, matchTitle, normalizeEntityName, normalizeShareClassName } from './matching';
import type {
  ExtractedItem,
  GroupKey,
  ImportContext,
  ImportDocumentKind,
  ImportExtraction,
  ImportValue,
  NamedRow,
  NameMatch,
  RefValue,
  ReviewCheck,
  ReviewNotice,
  ReviewRow,
  ReviewState,
  RowIssues,
} from './types';

// ---- 参照の指定 ----

export const refExisting = (id: string): RefValue => `existing:${id}`;
export const refNew = (rowKey: string): RefValue => `new:${rowKey}`;

export type ParsedRef = { mode: 'existing'; id: string } | { mode: 'new'; key: string } | null;

export const parseRef = (value: RefValue | undefined): ParsedRef => {
  if (!value) return null;
  if (value.startsWith('existing:')) {
    const id = value.slice('existing:'.length);
    return isUuid(id) ? { mode: 'existing', id } : null;
  }
  if (value.startsWith('new:')) {
    const key = value.slice('new:'.length);
    return /^[A-Za-z]+-\d{1,4}$/.test(key) ? { mode: 'new', key } : null;
  }
  return null;
};

export const rowKeyOf = (group: GroupKey, index: number): string => `${group}-${index}`;

const groupOfRowKey = (key: string): GroupKey | null => {
  const group = key.slice(0, key.lastIndexOf('-'));
  return group in GROUP_SPECS ? (group as GroupKey) : null;
};

/** 参照先の登録済みの行（選択肢） */
export const existingRowsOf = (target: RefTarget, context: ImportContext): NamedRow[] => {
  switch (target) {
    case 'stakeholders':
      return context.stakeholders;
    case 'share-classes':
      return context.shareClasses;
    case 'funding-rounds':
      return context.fundingRounds;
    case 'convertible-rounds':
      return context.convertibleRounds;
    case 'option-plans':
      return context.optionPlans;
    case 'fiscal-years':
      return context.fiscalYears;
    case 'meetings':
      return context.meetings.map((meeting) => ({ id: meeting.id, label: meeting.title }));
    default:
      return [];
  }
};

// ---- 行を作る ----

/** 読み取った値を、フォームの表示値にする（金額・整数は桁区切り、率は %） */
export const toReviewValue = (field: FieldDef, value: ImportValue | undefined, fallback?: string): string | boolean => {
  if (field.type === 'boolean') return value === true;
  if (value == null || typeof value === 'boolean') return fallback ?? emptyFormValue(field);
  if (typeof value === 'number') {
    return field.type === 'yen' || field.type === 'integer' ? value.toLocaleString('ja-JP') : String(value);
  }
  return value;
};

const NO_MATCH: NameMatch = { status: 'none', id: null, candidates: [] };

const text = (item: ExtractedItem, key: string): string | null => (typeof item[key] === 'string' ? (item[key] as string) : null);

/** 行そのものが登録済みの行と一致するか（一致したら、新しく作らない既定にする） */
const matchSelf = (spec: GroupSpec, item: ExtractedItem, context: ImportContext): NameMatch => {
  switch (spec.key) {
    case 'stakeholders':
      return matchStakeholder(text(item, 'name'), context.stakeholders);
    case 'shareClasses':
      return matchShareClass(text(item, 'name'), context.shareClasses);
    case 'fundingRound':
      return matchTitle(text(item, 'name'), context.fundingRounds);
    case 'convertibleRound':
      return matchTitle(text(item, 'name'), context.convertibleRounds);
    case 'optionPlan':
      return matchTitle(text(item, 'name'), context.optionPlans);
    case 'officers': {
      const name = normalizeEntityName(text(item, 'name') ?? '');
      const same = context.officers.filter(
        (officer) => officer.retiredOn == null && normalizeEntityName(officer.name) === name && (item.position == null || officer.position === item.position),
      );
      return same.length > 0
        ? { status: 'exact', id: same[0].id, candidates: [{ id: same[0].id, label: same[0].name }] }
        : NO_MATCH;
    }
    case 'meeting': {
      const heldOn = text(item, 'heldOn');
      const same = context.meetings.filter(
        (meeting) => heldOn != null && meeting.heldOn === heldOn && (item.meetingType == null || meeting.meetingType === item.meetingType),
      );
      return same.length > 0 ? { status: 'exact', id: same[0].id, candidates: [{ id: same[0].id, label: same[0].title }] } : NO_MATCH;
    }
    case 'financialReport': {
      const start = text(item, 'periodStart');
      const end = text(item, 'periodEnd');
      const same = context.financialReports.filter((report) => end != null && report.periodEnd === end && (start == null || report.periodStart === start));
      return same.length > 0 ? { status: 'exact', id: same[0].id, candidates: [{ id: same[0].id, label: same[0].title }] } : NO_MATCH;
    }
    default:
      return NO_MATCH;
  }
};

const companyCurrentValue = (field: FieldDef, context: ImportContext): string | boolean =>
  context.company ? toFormValue(field, context.company[field.key]) : emptyFormValue(field);

/** 読取りの結果に、ほかの件から名前で参照されているのに一覧に無い株主・株式の種類を足す */
const withReferencedItems = (extraction: ImportExtraction, context: ImportContext): ImportExtraction['groups'] => {
  const specs = groupsOfKind(extraction.documentKind);
  const groups: ImportExtraction['groups'] = { ...extraction.groups };
  const hasGroup = (key: GroupKey) => specs.some((spec) => spec.key === key);

  const stakeholders = [...(groups.stakeholders ?? [])];
  const classes = [...(groups.shareClasses ?? [])];
  const stakeholderKeys = new Set(stakeholders.map((item) => normalizeEntityName(String(item.name ?? ''))));
  const classKeys = new Set(classes.map((item) => normalizeShareClassName(String(item.name ?? ''))));

  for (const spec of specs) {
    for (const item of groups[spec.key] ?? []) {
      for (const ref of spec.refs) {
        const name = ref.nameKey ? text(item, ref.nameKey) : null;
        if (!name) continue;
        if (ref.target === 'stakeholders' && hasGroup('stakeholders')) {
          const key = normalizeEntityName(name);
          if (key !== '' && !stakeholderKeys.has(key)) {
            stakeholderKeys.add(key);
            stakeholders.push({ name });
          }
        }
        if (ref.target === 'share-classes' && ref.source === 'shareClasses' && hasGroup('shareClasses')) {
          const key = normalizeShareClassName(name);
          // 登録済みの種類と一致するなら、新しく作る提案は要らない
          if (key !== '' && !classKeys.has(key) && matchShareClass(name, context.shareClasses).status !== 'exact') {
            classKeys.add(key);
            classes.push({ name, kind: /普通/.test(name) ? 'common' : /優先/.test(name) ? 'preferred' : null });
          }
        }
      }
    }
  }
  if (hasGroup('stakeholders')) groups.stakeholders = stakeholders;
  if (hasGroup('shareClasses')) groups.shareClasses = classes;
  return groups;
};

const targetOfRow = (row: ReviewRow | undefined): RefValue => (row ? (row.existing ? refExisting(row.existing.id) : refNew(row.key)) : '');

/** 読取りの結果と今の台帳から、確認画面の初期状態を作る（照合の結果を既定値にする） */
export const buildReviewState = (extraction: ImportExtraction, context: ImportContext): ReviewState => {
  const kind = extraction.documentKind;
  const specs = groupsOfKind(kind);
  const groups = withReferencedItems(extraction, context);
  const state: ReviewState = {};

  // 1) 行そのもの（値・自分自身の照合）
  for (const spec of specs) {
    const fields = reviewFieldsOf(spec, kind);
    const defaults = reviewDefaultsOf(spec, kind);
    state[spec.key] = (groups[spec.key] ?? []).slice(0, spec.maxItems).map((item, index): ReviewRow => {
      const values: Record<string, string | boolean> = {};
      for (const field of fields) values[field.key] = toReviewValue(field, item[field.key], defaults[field.key]);
      const names: Record<string, string> = {};
      for (const ref of spec.refs) {
        const name = ref.nameKey ? text(item, ref.nameKey) : null;
        if (name) names[ref.key] = name;
      }
      const self = matchSelf(spec, item, context);
      const row: ReviewRow = {
        key: rowKeyOf(spec.key, index),
        include: self.status !== 'exact' && spec.target.type !== 'crosscheck',
        values,
        refs: {},
        names,
        matches: {},
        existing: self.status === 'exact' ? self.candidates[0] : null,
        similar: self.status === 'candidates' ? self.candidates : [],
      };

      if (spec.target.type === 'company') {
        // 読み取れて、今の値と違う項目だけを既定で選ぶ（管理者でなければ何も選ばない）
        row.ticked = context.canEditCompany
          ? fields.filter((field) => item[field.key] != null && values[field.key] !== companyCurrentValue(field, context)).map((field) => field.key)
          : [];
        row.include = row.ticked.length > 0;
      }
      if (spec.key === 'convertibleRound' && item.roundNo == null) {
        values.roundNo = String(Math.max(0, ...context.convertibleRounds.map((round) => round.roundNo)) + 1);
      }
      return row;
    });
  }

  // 2) 参照（名前の照合。同じ取り込みで作る行があればそれを既定にする）
  const stakeholderRows = new Map((state.stakeholders ?? []).map((row) => [normalizeEntityName(String(row.values.name ?? '')), row]));
  const classRows = new Map((state.shareClasses ?? []).map((row) => [normalizeShareClassName(String(row.values.name ?? '')), row]));

  const resolve = (ref: RefSpec, row: ReviewRow): { value: RefValue; match: NameMatch } => {
    const name = row.names[ref.key] ?? null;
    if (ref.target === 'stakeholders') {
      const match = matchStakeholder(name, context.stakeholders);
      const proposal = name ? stakeholderRows.get(normalizeEntityName(name)) : undefined;
      return { value: proposal ? targetOfRow(proposal) : match.id ? refExisting(match.id) : '', match };
    }
    if (ref.target === 'share-classes') {
      const match = matchShareClass(name, context.shareClasses);
      if (match.id) return { value: refExisting(match.id), match };
      const proposal = name && ref.source === 'shareClasses' ? classRows.get(normalizeShareClassName(name)) : undefined;
      return { value: targetOfRow(proposal), match };
    }
    if (ref.target === 'fiscal-years') {
      const match = matchFiscalYear(
        typeof row.values.periodStart === 'string' && row.values.periodStart ? row.values.periodStart : null,
        typeof row.values.periodEnd === 'string' && row.values.periodEnd ? row.values.periodEnd : null,
        context.fiscalYears,
      );
      const id = match.id ?? match.candidates[0]?.id ?? null;
      return { value: id ? refExisting(id) : '', match };
    }
    // 名前の無い参照（ラウンド・回次・会議）は、同じ取り込みの 1 件を既定にする
    return { value: targetOfRow(ref.source ? state[ref.source]?.[0] : undefined), match: NO_MATCH };
  };

  for (const spec of specs) {
    for (const row of state[spec.key] ?? []) {
      for (const ref of spec.refs) {
        const { value, match } = resolve(ref, row);
        row.refs[ref.key] = value;
        row.matches[ref.key] = match;
      }
    }
  }
  return state;
};

// ---- 反映する値を作る ----

/** 参照の指定を id にする関数。解決できなければ null */
export type RefResolver = (value: RefValue, ref: RefSpec) => string | null;

/**
 * 行から、リソースの登録に渡す本文を作る。画面に出していない項目はリソース定義の初期値で埋め、
 * 画面から送られた値は、確認画面に出している項目だけを使う（それ以外のキーは無視する）。
 */
export const buildRowBody = (spec: GroupSpec, kind: ImportDocumentKind, row: ReviewRow, resolveRef: RefResolver): Record<string, unknown> => {
  const body: Record<string, unknown> = {};
  const def = resourceDefOf(spec);
  for (const field of def?.fields ?? []) {
    if (field.type !== 'ref' && !field.hidden) body[field.key] = emptyFormValue(field);
  }
  for (const field of reviewFieldsOf(spec, kind)) body[field.key] = row.values[field.key] ?? emptyFormValue(field);
  for (const ref of spec.refs) body[ref.key] = resolveRef(row.refs[ref.key] ?? '', ref) ?? '';
  return body;
};

const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

// ---- 調べる ----

const numberOf = (value: string | boolean | undefined): number | null => (typeof value === 'string' ? parseNumberText(value) : null);
const stringOf = (value: string | boolean | undefined): string => (typeof value === 'string' ? value.trim() : '');

/** その日までの異動を合計した持株数（台帳の今の状態から） */
export const heldShares = (context: ImportContext, stakeholderId: string, shareClassId: string, asOf: string | null): number =>
  context.shareTransactions
    .filter(
      (transaction) =>
        transaction.stakeholderId === stakeholderId &&
        transaction.shareClassId === shareClassId &&
        (asOf == null || transaction.transactionDate <= asOf),
    )
    .reduce((total, transaction) => total + transaction.shares, 0);

const emptyIssues = (): RowIssues => ({ errors: [], fieldErrors: {}, warnings: [] });

const findRow = (state: ReviewState, key: string): ReviewRow | undefined => {
  const group = groupOfRowKey(key);
  return group ? state[group]?.find((row) => row.key === key) : undefined;
};

const labelOfExisting = (target: RefTarget, id: string, context: ImportContext): string | null =>
  existingRowsOf(target, context).find((row) => row.id === id)?.label ?? null;

const checkRefs = (spec: GroupSpec, row: ReviewRow, state: ReviewState, context: ImportContext, issues: RowIssues): void => {
  for (const ref of spec.refs) {
    const raw = row.refs[ref.key] ?? '';
    const parsed = parseRef(raw);
    if (!parsed) {
      if (raw !== '') issues.fieldErrors[ref.key] = `${ref.label}を選び直してください`;
      else if (ref.required) issues.fieldErrors[ref.key] = `${ref.label}を選んでください`;
      continue;
    }
    if (parsed.mode === 'existing') {
      if (!labelOfExisting(ref.target, parsed.id, context)) issues.fieldErrors[ref.key] = `${ref.label}が見つかりません。選び直してください`;
      continue;
    }
    const target = findRow(state, parsed.key);
    if (!ref.source || groupOfRowKey(parsed.key) !== ref.source || !target) {
      issues.fieldErrors[ref.key] = `${ref.label}を選び直してください`;
    } else if (!target.include) {
      issues.fieldErrors[ref.key] = `新しく作る${ref.label}の行が対象から外れています。その行を対象に戻すか、登録済みの${ref.label}を選んでください`;
    }
  }
};

const checkResourceRow = (spec: GroupSpec, kind: ImportDocumentKind, row: ReviewRow, issues: RowIssues): void => {
  const def = resourceDefOf(spec);
  if (!def) return;
  // 参照は別に調べるので、ここでは仮の id を入れて項目の検証だけを通す
  const body = buildRowBody(spec, kind, row, () => PLACEHOLDER_ID);
  const parsed = parseResourceInput(def, body, 'create');
  if (!parsed.ok) {
    const refKeys = new Set(spec.refs.map((ref) => ref.key));
    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (!refKeys.has(key)) issues.fieldErrors[key] = message;
    }
  }
  // 取り込みで選べる値を絞っている選択肢（株主名簿の異動の種類など）は、絞った定義でも確かめる
  for (const field of reviewFieldsOf(spec, kind)) {
    if (field.type !== 'select' || issues.fieldErrors[field.key]) continue;
    const checked = parseFieldValue(field, row.values[field.key]);
    if (!checked.ok) issues.fieldErrors[field.key] = checked.error;
  }
};

const checkCompanyRow = (kind: ImportDocumentKind, row: ReviewRow, context: ImportContext, issues: RowIssues): void => {
  const fields = reviewFieldsOf(GROUP_SPECS.company, kind);
  const ticked = (row.ticked ?? []).filter((key) => fields.some((field) => field.key === key));
  if (!context.canEditCompany) {
    issues.errors.push('会社情報の変更は管理者だけが行えます。管理者に反映を依頼するか、会社情報を対象から外してください');
    return;
  }
  if (ticked.length === 0) {
    issues.errors.push('反映する項目を 1 つ以上選んでください（反映しないときは、会社情報を対象から外します）');
    return;
  }
  for (const field of fields) {
    if (!ticked.includes(field.key)) continue;
    const parsed = parseFieldValue(field, row.values[field.key]);
    if (!parsed.ok) issues.fieldErrors[field.key] = parsed.error;
  }
  if (Object.keys(issues.fieldErrors).length > 0) return;
  // 今の値に重ねた全体でも検証する（項目をまたぐ決まり。監査役を置かない会社の会計限定など）
  const merged = mergeCompanyValues(kind, row, context);
  const parsed = parseResourceInput(COMPANY_DEF, merged, 'update');
  if (!parsed.ok) {
    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (ticked.includes(key)) issues.fieldErrors[key] = message;
      else issues.errors.push(`${message}（今の会社情報の値との組み合わせ。会社情報の画面で直してから反映してください）`);
    }
  }
};

/** 今の会社情報に、選んだ項目だけを重ねた値（フォームの表示値） */
export const mergeCompanyValues = (kind: ImportDocumentKind, row: ReviewRow, context: ImportContext): Record<string, string | boolean> => {
  const allowed = new Set(reviewFieldsOf(GROUP_SPECS.company, kind).map((field) => field.key));
  const merged: Record<string, string | boolean> = {};
  for (const field of COMPANY_DEF.fields) {
    const ticked = allowed.has(field.key) && (row.ticked ?? []).includes(field.key);
    merged[field.key] = ticked ? (row.values[field.key] ?? emptyFormValue(field)) : companyCurrentValue(field, context);
  }
  return merged;
};

const existingId = (row: ReviewRow, key: string): string | null => {
  const parsed = parseRef(row.refs[key]);
  return parsed?.mode === 'existing' ? parsed.id : null;
};

const checkTransactionRow = (row: ReviewRow, context: ImportContext, issues: RowIssues): void => {
  const shares = numberOf(row.values.shares);
  const price = numberOf(row.values.pricePerShare);
  const amount = numberOf(row.values.amount) ?? (price != null && shares != null ? Math.round(price * Math.abs(shares)) : null);
  const capital = numberOf(row.values.capitalAmount);
  const type = stringOf(row.values.transactionType) as ShareTransactionType;
  const date = stringOf(row.values.transactionDate);

  if (capital != null && amount != null && capital > amount) {
    issues.fieldErrors.capitalAmount = '資本金に組み入れた額は金額（合計）以下にしてください';
  } else if (capital != null && amount != null && CAPITAL_TRANSACTION_TYPES.includes(type) && capital < minimumCapitalIncrease(amount)) {
    issues.warnings.push(
      `資本金に組み入れた額（${formatYen(capital)}）が、払込金額（${formatYen(amount)}）の 2 分の 1（${formatYen(minimumCapitalIncrease(amount))}）を下回っています（会社法445条2項）`,
    );
  }
  if (price != null && shares != null && numberOf(row.values.amount) != null && Math.round(price * Math.abs(shares)) !== numberOf(row.values.amount)) {
    issues.warnings.push(`1 株あたりの金額 × 株式数（${formatYen(Math.round(price * Math.abs(shares)))}）と、金額（合計）が合いません`);
  }

  const holder = existingId(row, 'stakeholderId');
  const shareClass = existingId(row, 'shareClassId');
  if (shares != null && shares < 0) {
    const held = holder && shareClass ? heldShares(context, holder, shareClass, date || null) : 0;
    if (held + shares < 0) {
      issues.warnings.push(`この異動を入れると持株がマイナスになります（${date || '現在'} 時点の持株は ${formatShares(held)}）`);
    }
  }
  if (holder && shareClass && shares != null && date) {
    const duplicate = context.shareTransactions.some(
      (transaction) =>
        transaction.stakeholderId === holder &&
        transaction.shareClassId === shareClass &&
        transaction.transactionDate === date &&
        transaction.shares === shares,
    );
    if (duplicate) issues.warnings.push('同じ株主・種類・異動日・株式数の異動がすでに登録されています（二重に入れていないか確かめてください）');
  }
};

/** 譲渡の行を調べる。used は、同じ取り込みの前の行までに譲渡人が手放す株式数（譲渡人:種類 → 株式数） */
const checkTransferRow = (kind: ImportDocumentKind, row: ReviewRow, context: ImportContext, used: Map<string, number>, issues: RowIssues): void => {
  for (const field of reviewFieldsOf(GROUP_SPECS.transfers, kind)) {
    const parsed = parseFieldValue(field, row.values[field.key]);
    if (!parsed.ok) issues.fieldErrors[field.key] = parsed.error;
  }
  const from = parseRef(row.refs.fromStakeholderId);
  const to = parseRef(row.refs.toStakeholderId);
  if (from && to && row.refs.fromStakeholderId === row.refs.toStakeholderId) {
    issues.fieldErrors.toStakeholderId = '譲渡人と譲受人には別の人を選んでください';
  }
  if (from?.mode === 'new') {
    issues.fieldErrors.fromStakeholderId = '譲渡人は、登録済みの株主から選んでください（新しく作る株主には持株がありません）';
    return;
  }
  const shareClass = existingId(row, 'shareClassId');
  const shares = numberOf(row.values.shares);
  const date = stringOf(row.values.transactionDate);
  if (!from || !shareClass || shares == null || !date || issues.fieldErrors.shares || issues.fieldErrors.transactionDate) return;

  // 譲渡日時点で譲渡人が持っている株式数を超える譲渡は記録しない（/api/equity/transfer と同じ決まり）
  const key = `${from.id}:${shareClass}`;
  const held = heldShares(context, from.id, shareClass, date) - (used.get(key) ?? 0);
  if (shares > held) {
    const name = labelOfExisting('stakeholders', from.id, context) ?? '譲渡人';
    issues.fieldErrors.shares = `${name} が ${date} 時点で譲渡できるのは ${formatShares(Math.max(0, held))}までです`;
    return;
  }
  used.set(key, (used.get(key) ?? 0) + shares);
};

const SELF_DUPLICATE_LABEL: Partial<Record<GroupKey, string>> = {
  stakeholders: '同じ名前の株主・権利者',
  shareClasses: '同じ名前の株式の種類',
  officers: '同じ氏名・役職の在任中の役員',
  fundingRound: '同じ名前の資金調達ラウンド',
  convertibleRound: '同じ名前の回次',
  optionPlan: '同じ名前の回次',
  meeting: '同じ開催日・種類の会議',
  financialReport: '同じ期間の決算情報',
};

const sumIncluded = (rows: ReviewRow[] | undefined, key: string, filter: (row: ReviewRow) => boolean = () => true): number | null => {
  const values = (rows ?? []).filter((row) => row.include && filter(row)).map((row) => numberOf(row.values[key]));
  return values.length === 0 || values.some((value) => value == null) ? null : (values as number[]).reduce((total, value) => total + value, 0);
};

/** 登記簿の発行済株式数と台帳の照合 */
const crossCheckIssuedShares = (rows: ReviewRow[], context: ImportContext): ReviewNotice[] => {
  const notices: ReviewNotice[] = [];
  let registryTotal = 0;
  for (const row of rows) {
    const name = stringOf(row.values.shareClassName) || '普通株式';
    const registered = numberOf(row.values.shares);
    if (registered == null) continue;
    registryTotal += registered;
    const match = matchShareClass(name, context.shareClasses);
    if (!match.id) {
      notices.push({ level: 'warning', message: `登記簿の「${name}」（${formatShares(registered)}）に当たる株式の種類が、台帳にありません` });
      continue;
    }
    const ledger = context.shareTransactions.filter((transaction) => transaction.shareClassId === match.id).reduce((total, transaction) => total + transaction.shares, 0);
    notices.push(
      ledger === registered
        ? { level: 'info', message: `${name}: 登記簿の発行済株式数（${formatShares(registered)}）と台帳が一致しています` }
        : { level: 'warning', message: `${name}: 登記簿の発行済株式数は ${formatShares(registered)}、台帳は ${formatShares(ledger)}です（差 ${formatNumber(registered - ledger)}株）。株式の異動の入力もれ・登記の時期を確かめてください` },
    );
  }
  if (rows.length > 0) {
    const ledgerTotal = context.shareTransactions.reduce((total, transaction) => total + transaction.shares, 0);
    if (ledgerTotal !== registryTotal) {
      notices.push({ level: 'warning', message: `発行済株式の総数: 登記簿は ${formatShares(registryTotal)}、台帳は ${formatShares(ledgerTotal)}です` });
    }
  }
  return notices;
};

/**
 * 確認画面の状態を調べる。errors・fieldErrors が 1 つでもあれば反映できない。
 * 対象から外した行（include が false）は調べない。
 */
export const checkReview = (kind: ImportDocumentKind, state: ReviewState, context: ImportContext): ReviewCheck => {
  const rows: Record<string, RowIssues> = {};
  const notices: ReviewNotice[] = [];
  let includedCount = 0;
  const transferUsed = new Map<string, number>();

  for (const spec of groupsOfKind(kind)) {
    const groupRows = state[spec.key] ?? [];
    if (spec.target.type === 'crosscheck') {
      notices.push(...crossCheckIssuedShares(groupRows, context));
      continue;
    }
    for (const row of groupRows) {
      if (!row.include) continue;
      includedCount += 1;
      const issues = emptyIssues();
      rows[row.key] = issues;

      if (spec.target.type === 'company') {
        checkCompanyRow(kind, row, context, issues);
        continue;
      }
      checkRefs(spec, row, state, context, issues);
      if (spec.target.type === 'transfer') checkTransferRow(kind, row, context, transferUsed, issues);
      else checkResourceRow(spec, kind, row, issues);
      if (spec.key === 'shareTransactions') checkTransactionRow(row, context, issues);

      const duplicateLabel = SELF_DUPLICATE_LABEL[spec.key];
      if (duplicateLabel && row.existing) {
        issues.warnings.push(`${duplicateLabel}「${row.existing.label}」がすでに登録されています。このまま反映すると重複して作られます`);
      }
      if (row.similar.length > 0) {
        issues.warnings.push(
          `似た名前の${spec.label}が登録されています: ${row.similar.map((item) => item.label).join('、')}。同じ相手なら、この行を対象から外し、参照している行で登録済みのほうを選んでください`,
        );
      }
    }
  }

  // ラウンドと引受けの合計
  const round = state.fundingRound?.[0];
  if (round?.include && rows[round.key]) {
    const usesRound = (row: ReviewRow) => row.refs.roundId === refNew(round.key);
    const total = sumIncluded(state.shareTransactions, 'amount', usesRound);
    const target = numberOf(round.values.targetAmount);
    if (total != null && target != null && total !== target) {
      rows[round.key].warnings.push(`調達額（${formatYen(target)}）と、引受けごとの金額の合計（${formatYen(total)}）が合いません`);
    }
  }

  // 新株予約権の総数と割当の合計
  const plan = state.optionPlan?.[0];
  if (plan?.include && rows[plan.key]) {
    const units = sumIncluded(state.optionGrants, 'units', (row) => row.refs.planId === refNew(plan.key));
    const totalUnits = numberOf(plan.values.totalUnits);
    if (units != null && totalUnits != null && units > totalUnits) {
      rows[plan.key].warnings.push(`割当個数の合計（${formatNumber(units)}個）が、発行する総数（${formatNumber(totalUnits)}個）を超えています`);
    }
  }
  for (const row of state.optionGrants ?? []) {
    if (!row.include || !rows[row.key]) continue;
    const planId = existingId(row, 'planId');
    const holder = existingId(row, 'stakeholderId');
    const units = numberOf(row.values.units);
    if (planId && holder && context.optionGrants.some((grant) => grant.planId === planId && grant.stakeholderId === holder && grant.units === units)) {
      rows[row.key].warnings.push('同じ回次・割当先・個数の割当がすでに登録されています（二重に入れていないか確かめてください）');
    }
  }
  for (const row of state.convertibleInvestments ?? []) {
    if (!row.include || !rows[row.key]) continue;
    const roundId = existingId(row, 'roundId');
    const holder = existingId(row, 'stakeholderId');
    const amount = numberOf(row.values.amount);
    if (roundId && holder && context.convertibleInvestments.some((item) => item.roundId === roundId && item.stakeholderId === holder && item.amount === amount)) {
      rows[row.key].warnings.push('同じ回次・投資家・金額の投資がすでに登録されています（二重に入れていないか確かめてください）');
    }
  }
  const convertible = state.convertibleRound?.[0];
  if (convertible?.include && rows[convertible.key]) {
    const roundNo = numberOf(convertible.values.roundNo);
    if (roundNo != null && context.convertibleRounds.some((item) => item.roundNo === roundNo)) {
      rows[convertible.key].fieldErrors.roundNo = `第${roundNo}回はすでに登録されています。回次の数字を変えてください`;
    }
  }

  if (kind === 'shareholder_list' && (state.shareTransactions ?? []).some((row) => row.include)) {
    notices.push({
      level: 'info',
      message:
        '株主名簿・資本政策表からは「今の持株数」だけを取り込みます。選んだ異動日に、持株数と同じ数の株式を取得した 1 件の異動として記録するため、過去の発行・譲渡の履歴や取得日は復元されません。履歴が要る場合は、契約書ごとに取り込むか、株主名簿の画面で入力してください',
    });
    if ((state.shareTransactions ?? []).some((row) => row.include && existingId(row, 'stakeholderId') && existingId(row, 'shareClassId') &&
      heldShares(context, existingId(row, 'stakeholderId') as string, existingId(row, 'shareClassId') as string, null) !== 0)) {
      notices.push({ level: 'warning', message: 'すでに持株が登録されている株主が含まれています。反映すると、今の持株に上乗せされます（置き換えではありません）' });
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const issues of Object.values(rows)) {
    errorCount += issues.errors.length + Object.keys(issues.fieldErrors).length;
    warningCount += issues.warnings.length;
  }
  warningCount += notices.filter((notice) => notice.level === 'warning').length;
  return { rows, notices, errorCount, warningCount, includedCount };
};

/** 最初の問題を 1 文にする（サーバが反映を断るときの文） */
export const firstReviewError = (kind: ImportDocumentKind, check: ReviewCheck): string | null => {
  for (const spec of groupsOfKind(kind)) {
    for (const [key, issues] of Object.entries(check.rows)) {
      if (groupOfRowKey(key) !== spec.key) continue;
      const message = issues.errors[0] ?? Object.values(issues.fieldErrors)[0];
      if (message) return `${spec.label}: ${message}`;
    }
  }
  return null;
};
