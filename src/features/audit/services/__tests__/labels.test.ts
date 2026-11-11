import { describe, expect, it } from 'vitest';
import {
  actionsMatchingLabel,
  AUDIT_CATEGORIES,
  auditActionLabel,
  auditCategoryLabel,
  auditCategoryOf,
  auditOutcomeLabel,
  auditOutcomeTone,
  auditRoleLabel,
  auditSourceLabel,
  categoryActionPatterns,
  describeActor,
  describeEntity,
  isAuditCategory,
  tableLabel,
  verifyReasonLabel,
} from '../labels';

describe('auditActionLabel', () => {
  it('データの変更は、テーブルの名前から「〜を追加・更新・削除（データ）」を作る', () => {
    expect(auditActionLabel('share_transactions.insert', 'db')).toBe('株式の異動を追加（データ）');
    expect(auditActionLabel('stakeholders.update', 'db')).toBe('株主・権利者を更新（データ）');
    expect(auditActionLabel('organizations.update', 'db')).toBe('会社情報を更新（データ）');
    expect(auditActionLabel('document_shares.delete', 'db')).toBe('文書の公開先を削除（データ）');
  });

  it('同じ名前の操作でも、アプリの操作とデータの変更を見分ける', () => {
    expect(auditActionLabel('stakeholders.update', 'app')).toBe('株主・権利者を更新');
    expect(auditActionLabel('stakeholders.update', 'db')).toBe('株主・権利者を更新（データ）');
  });

  it('アプリの操作は、リソース名（kebab-case）からも引ける', () => {
    expect(auditActionLabel('share-transactions.create', 'app')).toBe('株式の異動を登録');
    expect(auditActionLabel('option-grants.delete', 'app')).toBe('新株予約権の割当を削除');
    expect(auditActionLabel('equity.transfer', 'app')).toBe('株式の譲渡を記録');
    expect(auditActionLabel('company.update', 'app')).toBe('会社情報を更新');
    expect(auditActionLabel('audit_log.export', 'app')).toBe('監査ログを CSV で出力');
  });

  it('認証の操作に名前を付ける', () => {
    expect(auditActionLabel('auth.login', 'auth')).toBe('ログイン');
    expect(auditActionLabel('auth.logout', 'auth')).toBe('ログアウト');
    expect(auditActionLabel('auth.login.failed', 'app')).toBe('ログインの失敗');
    expect(auditActionLabel('auth.user_recovery_requested', 'auth')).toBe('パスワードの再設定を要求');
  });

  it('ブラウザでの出力（src/lib/audit/activity.ts の種類）は、そこの名前を使う', () => {
    expect(auditActionLabel('export.shareholder_registry', 'app')).toBe('株主名簿を Excel に出力');
  });

  it('知らない操作は元の文字のまま返す（記録を隠さない）', () => {
    expect(auditActionLabel('something.new', 'app')).toBe('something.new');
    expect(auditActionLabel('auth.brand_new_event', 'auth')).toBe('auth.brand_new_event');
    expect(auditActionLabel('noperiod', 'app')).toBe('noperiod');
    expect(auditActionLabel('', 'app')).toBe('');
    expect(auditActionLabel('toString', 'app')).toBe('toString');
    expect(auditActionLabel('constructor.update', 'app')).toBe('constructor.update');
  });

  it('知らないテーブルのデータの変更は、テーブル名をそのまま使う', () => {
    expect(auditActionLabel('new_table.insert', 'db')).toBe('new_table を追加（データ）');
    expect(auditActionLabel('new_table.truncate', 'db')).toBe('new_table.truncate');
  });

  it('名前を決めていない出力は、何を出したかを元の文字で添える', () => {
    expect(auditActionLabel('export.something_else', 'app')).toBe('データを出力（something_else）');
  });
});

describe('tableLabel', () => {
  it('テーブル名・リソース名のどちらでも引ける。知らない名前はそのまま', () => {
    expect(tableLabel('share_transactions')).toBe('株式の異動');
    expect(tableLabel('share-transactions')).toBe('株式の異動');
    expect(tableLabel('profiles')).toBe('アカウント');
    expect(tableLabel('auth.sessions')).toBe('ログイン');
    expect(tableLabel('unknown_table')).toBe('unknown_table');
    expect(tableLabel('__proto__')).toBe('__proto__');
  });
});

describe('種類（category）', () => {
  it('操作を種類に振り分ける', () => {
    expect(auditCategoryOf('auth.login')).toBe('auth');
    expect(auditCategoryOf('access.denied')).toBe('auth');
    expect(auditCategoryOf('stakeholders.update')).toBe('equity');
    expect(auditCategoryOf('share-transactions.create')).toBe('equity');
    expect(auditCategoryOf('share_transactions.insert')).toBe('equity');
    expect(auditCategoryOf('option_grants.insert')).toBe('options');
    expect(auditCategoryOf('convertible-rounds.update')).toBe('options');
    expect(auditCategoryOf('meeting_agenda_items.update')).toBe('meetings');
    expect(auditCategoryOf('compliance.complete')).toBe('meetings');
    expect(auditCategoryOf('documents.download')).toBe('disclosure');
    expect(auditCategoryOf('share_links.access')).toBe('sharing');
    expect(auditCategoryOf('export.cap_table')).toBe('sharing');
    expect(auditCategoryOf('member.role.update')).toBe('members');
    expect(auditCategoryOf('invite.create')).toBe('members');
    expect(auditCategoryOf('profiles.update')).toBe('members');
    expect(auditCategoryOf('ai.request')).toBe('settings');
    expect(auditCategoryOf('ai_settings.update')).toBe('settings');
    expect(auditCategoryOf('company.update')).toBe('settings');
    expect(auditCategoryOf('audit_log.verify')).toBe('audit');
    expect(auditCategoryOf('access_review.export')).toBe('audit');
  });

  it('どの種類にも入らない操作は「その他」', () => {
    expect(auditCategoryOf('something.new')).toBe('other');
    expect(auditCategoryOf('')).toBe('other');
    expect(auditCategoryLabel('other')).toBe('その他');
    expect(auditCategoryLabel('auth')).toBe('認証');
    expect(auditCategoryLabel('zzz')).toBe('zzz');
  });

  it('同じ語が 2 つの種類に入っていない（絞り込みが重ならない）', () => {
    const prefixes = AUDIT_CATEGORIES.flatMap((category) => category.prefixes);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('DB で絞るパターンは「語.%」。その他は、すべての種類のパターン（どれにも合わないもの）', () => {
    expect(categoryActionPatterns('auth')).toEqual(['auth.%', 'access.%']);
    expect(categoryActionPatterns('audit')).toEqual(['audit_log.%', 'access_review.%']);
    expect(categoryActionPatterns('other').length).toBe(AUDIT_CATEGORIES.flatMap((category) => category.prefixes).length);
    expect(categoryActionPatterns('zzz')).toEqual([]);
  });

  it('種類の値を検証する', () => {
    expect(isAuditCategory('equity')).toBe(true);
    expect(isAuditCategory('other')).toBe(true);
    expect(isAuditCategory('zzz')).toBe(false);
    expect(isAuditCategory('')).toBe(false);
  });
});

describe('actionsMatchingLabel', () => {
  it('表示名にキーワードを含む操作を返す（「ログイン」で auth.login を探せる）', () => {
    const actions = actionsMatchingLabel('ログイン');
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.login.failed');
    expect(actions).not.toContain('auth.logout');
  });

  it('データの変更の表示名・アプリの操作の表示名のどちらでも引ける', () => {
    expect(actionsMatchingLabel('株式の異動を追加')).toContain('share_transactions.insert');
    expect(actionsMatchingLabel('株式の異動を登録')).toContain('share-transactions.create');
    expect(actionsMatchingLabel('株主・権利者を更新')).toContain('stakeholders.update');
  });

  it('空・合うものが無いキーワードは空。件数には上限がある', () => {
    expect(actionsMatchingLabel('')).toEqual([]);
    expect(actionsMatchingLabel('   ')).toEqual([]);
    expect(actionsMatchingLabel('該当なしのキーワード')).toEqual([]);
    expect(actionsMatchingLabel('を', 5).length).toBe(5);
  });
});

describe('記録元・結果・ロール・検査の結果', () => {
  it('記録元と結果の表示名。知らない値はそのまま', () => {
    expect(auditSourceLabel('app')).toBe('アプリの操作');
    expect(auditSourceLabel('db')).toBe('データの変更');
    expect(auditSourceLabel('auth')).toBe('認証');
    expect(auditSourceLabel('x')).toBe('x');
    expect(auditOutcomeLabel('success')).toBe('成功');
    expect(auditOutcomeLabel('failure')).toBe('失敗');
    expect(auditOutcomeLabel('denied')).toBe('拒否');
    expect(auditOutcomeLabel('x')).toBe('x');
    expect(auditOutcomeTone('success')).toBe('gt-pill-good');
    expect(auditOutcomeTone('failure')).toBe('gt-pill-bad');
    expect(auditOutcomeTone('denied')).toBe('gt-pill-warn');
    expect(auditOutcomeTone('x')).toBe('gt-pill-neutral');
  });

  it('ロールの表示名（当時の値）。知らない値はそのまま、無ければ空', () => {
    expect(auditRoleLabel('admin')).toBe('管理者');
    expect(auditRoleLabel('logger')).toBe('メンバー');
    expect(auditRoleLabel('shareholder')).toBe('株主');
    expect(auditRoleLabel('future_role')).toBe('future_role');
    expect(auditRoleLabel(null)).toBe('');
  });

  it('検査で見つかった問題の理由', () => {
    expect(verifyReasonLabel('gap')).toContain('連番が飛んでいます');
    expect(verifyReasonLabel('prev_hash_mismatch')).toContain('直前の記録のハッシュ');
    expect(verifyReasonLabel('hash_mismatch')).toContain('内容とハッシュが合いません');
    expect(verifyReasonLabel('new_reason')).toContain('new_reason');
  });
});

describe('describeActor / describeEntity', () => {
  it('氏名があれば氏名、2 行目にメールアドレスと当時のロール', () => {
    expect(describeActor({ userId: 'u1', actorName: '創業 太郎', actorEmail: 'admin@example.com', actorRole: 'admin' })).toEqual({
      primary: '創業 太郎',
      secondary: 'admin@example.com・管理者',
    });
  });

  it('氏名が無ければメールアドレス（アカウントが削除済みでも、当時のメールアドレスは残る）', () => {
    expect(describeActor({ userId: 'u1', actorName: null, actorEmail: 'gone@example.com', actorRole: 'logger' })).toEqual({
      primary: 'gone@example.com',
      secondary: 'メンバー',
    });
    expect(describeActor({ userId: 'u1', actorName: null, actorEmail: null, actorRole: null }).primary).toBe('削除済みのアカウント');
  });

  it('操作した人が決まらない記録は「システム」', () => {
    expect(describeActor({ userId: null, actorName: null, actorEmail: null, actorRole: null })).toEqual({ primary: 'システム', secondary: '' });
  });

  it('操作した人の id が無くても、メールアドレスが残っていればそれを出す（ログインの失敗など）', () => {
    expect(describeActor({ userId: null, actorName: null, actorEmail: 'tried@example.com', actorRole: null }).primary).toBe('tried@example.com');
  });

  it('対象は、種類の日本語名と行の名前。AI の利用は用途を出す', () => {
    expect(describeEntity({ action: 'stakeholders.update', entityName: 'stakeholders', entityId: 'x', entityLabel: '営業 花子' })).toEqual({
      type: '株主・権利者',
      name: '営業 花子',
    });
    expect(describeEntity({ action: 'x.y', entityName: 'unknown_table', entityId: null, entityLabel: null })).toEqual({ type: 'unknown_table', name: null });
    expect(describeEntity({ action: 'ai.request', entityName: 'draft_writing', entityId: null, entityLabel: '文章の下書き' })).toEqual({
      type: 'AI の用途',
      name: '文章の下書き',
    });
  });
});
