// 株主ポータルの利用（招待・状況・取り消し）のサーバ処理（サーバ専用）。
//
// 守ること:
//   - 招待・取り消しは、呼び出し側（Route Handler）が requireAdmin を通してから呼ぶ。状況の一覧は requireInternal。
//   - invites への stakeholderId の書き込みは service_role で行う（authenticated の列 GRANT に stakeholderId は無い）。
//     招待の role は必ず 'shareholder'（社内のロールをこの経路で発行しない）。
//   - 招待リンクの token は秘密。監査ログ・ログ出力に残さない。返すのは管理者あての応答だけ。
//   - アカウントの削除は、自組織の、株主ロールの、その権利者に紐づくプロフィールだけ（社内の人は決して消さない）。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isInviteEmailConfigured, type InviteEmailStatus } from '@/features/settings/services/inviteEmail';
import type { CurrentProfile } from '@/lib/currentProfile';
import { isValidEmail } from '@/lib/email';
import { logger } from '@/lib/logging/logger';
import { isUuid } from '@/lib/resources/fields';
import { recordAudit, type WriteResult } from '@/lib/resources/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SHAREHOLDER_ROLE } from '@/types/role';
import { buildShareholderInviteEmail } from './shareholderInviteEmail';
import { buildPortalAccessMap, type LinkedProfileRow, type PendingInviteRow, type PortalAccessMap } from './status';

type Actor = Pick<CurrentProfile, 'id' | 'organizationId'>;

const RESEND_API_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

/**
 * 招待リンクの origin。運用者が決めた APP_URL を優先し、未設定のときだけリクエストのヘッダから求める
 * （src/features/settings/services/invites.ts の resolveRequestOrigin と同じ規則）。
 */
export const resolveOrigin = (headers: { get(name: string): string | null }): string | null => {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/+$/, '');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return null;
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const protocol = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${protocol}://${host}`;
};

const inviteUrlOf = (origin: string | null, token: string): string | null => (origin ? `${origin}/invite/${token}` : null);

/** 権利者ごとの利用状況。includeLinks（管理者）のときだけ、期限内の招待にリンクを付ける */
export const listPortalAccess = async (
  organizationId: string,
  options: { includeLinks: boolean; origin: string | null },
  admin: SupabaseClient = createAdminClient(),
): Promise<PortalAccessMap> => {
  const [stakeholders, profiles, invites] = await Promise.all([
    admin.from('stakeholders').select('id').eq('organizationId', organizationId).limit(5000),
    admin
      .from('profiles')
      .select('stakeholderId, role, createdAt')
      .eq('organizationId', organizationId)
      .eq('role', SHAREHOLDER_ROLE)
      .not('stakeholderId', 'is', null),
    admin
      .from('invites')
      .select('stakeholderId, role, token, expiresAt, acceptedAt, createdAt')
      .eq('organizationId', organizationId)
      .eq('role', SHAREHOLDER_ROLE)
      .is('acceptedAt', null)
      .not('stakeholderId', 'is', null),
  ]);
  if (stakeholders.error || profiles.error || invites.error) throw new Error('株主ポータルの利用状況の取得に失敗しました');
  return buildPortalAccessMap(
    ((stakeholders.data ?? []) as { id: string }[]).map((row) => row.id),
    (profiles.data ?? []) as LinkedProfileRow[],
    (invites.data ?? []) as PendingInviteRow[],
    new Date(),
    options.includeLinks ? (token) => inviteUrlOf(options.origin, token) : undefined,
  );
};

const sendShareholderInviteEmail = async (input: Parameters<typeof buildShareholderInviteEmail>[0] & { to: string }): Promise<InviteEmailStatus> => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_EMAIL_FROM;
  if (!apiKey || !from) return 'skipped';
  try {
    const { subject, text, html } = buildShareholderInviteEmail(input);
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [input.to], subject, text, html }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 失敗の理由は運用者向けにサーバのログへだけ残す（宛先を含み得るので短く切る。招待リンクは含めない）
      const detail = await response.text().catch(() => '');
      logger.error({ status: response.status, detail: detail.slice(0, 300) }, '株主ポータルの招待メールの送信に失敗しました');
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    logger.error({ error }, '株主ポータルの招待メールの送信に失敗しました');
    return 'failed';
  }
};

export interface PortalInviteResult {
  /** 招待リンク。origin が決められないときは null（そのときは画面に出せない） */
  inviteUrl: string | null;
  email: string;
  expiresAt: string;
  emailStatus: InviteEmailStatus;
}

/** 権利者を株主ポータルに招待する（管理者）。同じ宛先・同じ権利者の未受諾の招待は置き換える */
export const inviteShareholder = async (
  actor: Actor,
  rawStakeholderId: unknown,
  origin: string | null,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<PortalInviteResult>> => {
  const notFound = { ok: false, status: 404, error: '株主が見つかりません' } as const;
  if (!isUuid(rawStakeholderId)) return notFound;
  const { data: stakeholderData } = await admin
    .from('stakeholders')
    .select('id, name, email')
    .eq('organizationId', actor.organizationId)
    .eq('id', rawStakeholderId)
    .maybeSingle();
  const stakeholder = stakeholderData as { id: string; name: string; email: string | null } | null;
  if (!stakeholder) return notFound;

  const email = (stakeholder.email ?? '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return { ok: false, status: 400, error: 'この株主にはメールアドレスが登録されていません。先に株主の情報にメールアドレスを登録してください' };
  }

  const [byEmail, byStakeholder] = await Promise.all([
    admin.from('profiles').select('id').eq('organizationId', actor.organizationId).eq('email', email).maybeSingle(),
    admin.from('profiles').select('id').eq('organizationId', actor.organizationId).eq('stakeholderId', stakeholder.id).maybeSingle(),
  ]);
  if (byEmail.error || byStakeholder.error) return { ok: false, status: 500, error: '招待の作成に失敗しました' };
  if (byStakeholder.data) return { ok: false, status: 409, error: 'この株主はすでに株主ポータルのアカウントを持っています' };
  if (byEmail.data) {
    return { ok: false, status: 409, error: 'このメールアドレスのアカウントがすでにあります（社内メンバー、または別の株主のアカウント）' };
  }

  // 未受諾の招待を置き換える: 同じ宛先のもの（部分一意インデックスに当たる）と、この権利者あての古いもの（宛先を変えた場合）
  const cleanups = await Promise.all([
    admin.from('invites').delete().eq('organizationId', actor.organizationId).eq('email', email).is('acceptedAt', null),
    admin.from('invites').delete().eq('organizationId', actor.organizationId).eq('stakeholderId', stakeholder.id).is('acceptedAt', null),
  ]);
  if (cleanups.some((result) => result.error)) return { ok: false, status: 500, error: '招待の作成に失敗しました' };

  const { data: created, error: insertError } = await admin
    .from('invites')
    .insert({
      organizationId: actor.organizationId,
      email,
      role: SHAREHOLDER_ROLE,
      stakeholderId: stakeholder.id,
      invitedByUserId: actor.id,
    })
    .select('token, expiresAt')
    .single();
  if (insertError || !created) return { ok: false, status: 500, error: '招待の作成に失敗しました' };
  const token = created.token as string;
  const expiresAt = created.expiresAt as string;

  // token は残さない
  await recordAudit(admin, actor, 'portal_access.invite', 'stakeholders', stakeholder.id, { name: stakeholder.name, email });

  const inviteUrl = inviteUrlOf(origin, token);
  let emailStatus: InviteEmailStatus = 'skipped';
  if (isInviteEmailConfigured() && inviteUrl) {
    const { data: organization } = await admin.from('organizations').select('name').eq('id', actor.organizationId).maybeSingle();
    if (typeof organization?.name === 'string' && organization.name) {
      emailStatus = await sendShareholderInviteEmail({
        to: email,
        organizationName: organization.name,
        stakeholderName: stakeholder.name,
        inviteUrl,
        expiresAt,
      });
    }
  }
  return { ok: true, data: { inviteUrl, email, expiresAt, emailStatus } };
};

/**
 * 株主ポータルの利用を取り消す（管理者）。
 * アカウントがあればそのアカウント（認証ユーザーとプロフィール）を削除し、無ければ未受諾の招待を取り消す。
 */
export const revokePortalAccess = async (
  actor: Actor,
  rawStakeholderId: unknown,
  admin: SupabaseClient = createAdminClient(),
): Promise<WriteResult<{ revoked: 'account' | 'invite' }>> => {
  const notFound = { ok: false, status: 404, error: '取り消す対象が見つかりません' } as const;
  if (!isUuid(rawStakeholderId)) return notFound;
  const { data: stakeholderData } = await admin
    .from('stakeholders')
    .select('id, name')
    .eq('organizationId', actor.organizationId)
    .eq('id', rawStakeholderId)
    .maybeSingle();
  const stakeholder = stakeholderData as { id: string; name: string } | null;
  if (!stakeholder) return notFound;

  // 条件はすべて DB の絞り込みに入れる: 自組織・株主ロール・この権利者。社内のロールの行は対象にならない
  const { data: profileData, error: profileError } = await admin
    .from('profiles')
    .select('id, role, organizationId, stakeholderId')
    .eq('organizationId', actor.organizationId)
    .eq('role', SHAREHOLDER_ROLE)
    .eq('stakeholderId', stakeholder.id)
    .maybeSingle();
  if (profileError) return { ok: false, status: 500, error: '取り消しに失敗しました' };
  const profile = profileData as { id: string; role: string; organizationId: string; stakeholderId: string | null } | null;

  // 未受諾の招待は、アカウントの有無にかかわらず消す（古いリンクから作り直されないようにする）
  const { data: deletedInvites, error: inviteError } = await admin
    .from('invites')
    .delete()
    .eq('organizationId', actor.organizationId)
    .eq('role', SHAREHOLDER_ROLE)
    .eq('stakeholderId', stakeholder.id)
    .is('acceptedAt', null)
    .select('token');
  if (inviteError) return { ok: false, status: 500, error: '取り消しに失敗しました' };

  if (profile) {
    // 念のため、削除の直前にもう一度確かめる（株主ロール・自組織・この権利者・自分自身ではない）
    if (
      profile.role !== SHAREHOLDER_ROLE ||
      profile.organizationId !== actor.organizationId ||
      profile.stakeholderId !== stakeholder.id ||
      profile.id === actor.id
    ) {
      return { ok: false, status: 409, error: 'このアカウントは取り消せません' };
    }
    // 認証ユーザーを消すと profiles の行も消える（on delete cascade）
    const { error: deleteError } = await admin.auth.admin.deleteUser(profile.id);
    if (deleteError) return { ok: false, status: 500, error: 'アカウントの削除に失敗しました' };
    await recordAudit(admin, actor, 'portal_access.revoke_account', 'stakeholders', stakeholder.id, { name: stakeholder.name });
    return { ok: true, data: { revoked: 'account' } };
  }

  if ((deletedInvites ?? []).length === 0) return notFound;
  await recordAudit(admin, actor, 'portal_access.revoke_invite', 'stakeholders', stakeholder.id, { name: stakeholder.name });
  return { ok: true, data: { revoked: 'invite' } };
};
