import { describe, expect, it } from 'vitest';
import { buildShareholderInviteEmail } from '../shareholderInviteEmail';
import { buildPortalAccessMap } from '../status';

const now = new Date('2026-11-11T00:00:00Z');
const invite = (stakeholderId: string | null, patch: Record<string, unknown> = {}) => ({
  stakeholderId,
  role: 'shareholder',
  token: `token-${stakeholderId}`,
  expiresAt: '2026-11-15T00:00:00Z',
  acceptedAt: null,
  createdAt: '2026-11-08T00:00:00Z',
  ...patch,
});

describe('buildPortalAccessMap', () => {
  it('招待なしは none、招待済みは invited、アカウントがあれば active', () => {
    const map = buildPortalAccessMap(
      ['s1', 's2', 's3'],
      [{ stakeholderId: 's3', role: 'shareholder', createdAt: '2026-10-01T00:00:00Z' }],
      [invite('s2'), invite('s3')],
      now,
    );
    expect(map.s1).toEqual({ status: 'none' });
    expect(map.s2).toEqual({ status: 'invited', invitedAt: '2026-11-08T00:00:00Z', expiresAt: '2026-11-15T00:00:00Z', isExpired: false });
    expect(map.s3).toEqual({ status: 'active', invitedAt: '2026-10-01T00:00:00Z' });
  });

  it('期限切れの招待は invited のまま isExpired にする', () => {
    const map = buildPortalAccessMap(['s1'], [], [invite('s1', { expiresAt: '2026-11-10T00:00:00Z' })], now);
    expect(map.s1).toMatchObject({ status: 'invited', isExpired: true });
  });

  it('受諾済み・社内ロール・権利者なしの招待、社内ロールのプロフィールは数えない', () => {
    const map = buildPortalAccessMap(
      ['s1', 's2', 's3'],
      [{ stakeholderId: 's3', role: 'admin' }],
      [invite('s1', { acceptedAt: '2026-11-09T00:00:00Z' }), invite('s2', { role: 'logger' }), invite(null)],
      now,
    );
    expect(map).toEqual({ s1: { status: 'none' }, s2: { status: 'none' }, s3: { status: 'none' } });
  });

  it('一覧に無い権利者（他組織など）の行は結果に入れない', () => {
    const map = buildPortalAccessMap(['s1'], [{ stakeholderId: 'other', role: 'shareholder' }], [invite('other2')], now);
    expect(Object.keys(map)).toEqual(['s1']);
  });

  it('招待リンクは、作り方を渡したとき（管理者）だけ、期限内の招待に付ける', () => {
    const invites = [invite('s1'), invite('s2', { expiresAt: '2026-11-01T00:00:00Z' })];
    const withLinks = buildPortalAccessMap(['s1', 's2'], [], invites, now, (token) => `https://example.com/invite/${token}`);
    expect(withLinks.s1.inviteUrl).toBe('https://example.com/invite/token-s1');
    expect(withLinks.s2.inviteUrl).toBeUndefined();
    const withoutLinks = buildPortalAccessMap(['s1', 's2'], [], invites, now);
    expect(JSON.stringify(withoutLinks)).not.toContain('token-');
  });

  it('同じ権利者に複数の招待があれば新しいものを使う', () => {
    const map = buildPortalAccessMap(
      ['s1'],
      [],
      [invite('s1', { createdAt: '2026-11-09T00:00:00Z', expiresAt: '2026-11-16T00:00:00Z' }), invite('s1', { createdAt: '2026-11-01T00:00:00Z' })],
      now,
    );
    expect(map.s1.expiresAt).toBe('2026-11-16T00:00:00Z');
  });
});

describe('buildShareholderInviteEmail', () => {
  const input = {
    organizationName: '架空テック株式会社',
    stakeholderName: '架空 太郎',
    inviteUrl: 'https://example.com/invite/abc',
    expiresAt: '2026-11-18T03:00:00Z',
  };
  it('株主あての文面で、リンクと期限を含む（社内メンバー向けの文言を使わない）', () => {
    const email = buildShareholderInviteEmail(input);
    expect(email.subject).toBe('【架空テック株式会社】株主ポータルのご案内');
    expect(email.text).toContain('架空 太郎 様');
    expect(email.text).toContain('https://example.com/invite/abc');
    expect(email.text).toContain('2026/11/18');
    expect(email.text).not.toContain('メンバーとして');
    expect(email.html).toContain('<a href="https://example.com/invite/abc">');
  });
  it('名前に入った改行と HTML を無害化する', () => {
    const email = buildShareholderInviteEmail({ ...input, stakeholderName: '太郎\n<b>x</b>', organizationName: 'A&B\r\n社' });
    expect(email.subject).toBe('【A&B 社】株主ポータルのご案内');
    expect(email.html).toContain('太郎 &lt;b&gt;x&lt;/b&gt; 様');
    expect(email.html).toContain('A&amp;B 社');
    expect(email.html).not.toContain('<b>x</b>');
  });
});
