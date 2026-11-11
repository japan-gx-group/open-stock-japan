import { beforeEach, describe, expect, it, vi } from 'vitest';

// 招待の受諾のうち、入力の検証（DB に触れる前に弾くもの）を確かめる。
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@/lib/audit/events', () => ({ recordAuditEvent: vi.fn(async () => true) }));

import { PASSWORD_POLICY_ERROR } from '@/lib/security/passwordPolicy';
import { acceptInvite } from '../invites';

const TOKEN = '11111111-2222-4333-8444-555555555555';

describe('acceptInvite の入力の検証', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('パスワードの決まり（12 文字以上・英字と数字）を満たさなければ、招待にもアカウントにも触れずに弾く', async () => {
    for (const weak of ['short', 'abcdefgh123', 'abcdefghijklmnop', '1234567890123456']) {
      const result = await acceptInvite({ token: TOKEN, fullName: '山田 太郎', password: weak });

      expect(result, weak).toEqual({ ok: false, error: PASSWORD_POLICY_ERROR });
    }
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('トークンの形が正しくなければ弾く', async () => {
    const result = await acceptInvite({ token: 'not-a-uuid', fullName: '山田 太郎', password: 'valid-password-123' });

    expect(result).toEqual({ ok: false, error: 'この招待リンクは無効です' });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('認証サービスが弱いパスワードとして拒否したら、決まりの文言を返し、招待の確保を戻す', async () => {
    const updates: unknown[] = [];
    const invite = {
      token: TOKEN,
      organizationId: 'org-1',
      email: 'new@example.com',
      role: 'viewer',
      stakeholderId: null,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      acceptedAt: null,
    };
    mocks.createAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: invite, error: null }) }) }),
        update: (values: unknown) => {
          updates.push(values);
          const chain = {
            eq: () => chain,
            is: () => chain,
            select: () => ({ maybeSingle: async () => ({ data: { token: TOKEN }, error: null }) }),
            then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
          };
          return chain;
        },
      }),
      auth: {
        admin: {
          createUser: vi.fn(async () => ({ data: { user: null }, error: { code: 'weak_password', status: 422, message: 'weak' } })),
        },
      },
    });

    const result = await acceptInvite({ token: TOKEN, fullName: '山田 太郎', password: 'valid-password-123' });

    expect(result).toEqual({ ok: false, error: PASSWORD_POLICY_ERROR });
    // 確保（acceptedAt を入れる）→ 戻す（null に戻す）
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual({ acceptedAt: null });
  });
});
