// 株主ポータルへの招待メールの本文。環境変数やネットワークに依存しない純粋な関数。
// 社内メンバーあての招待メール（src/features/settings/services/inviteEmailTemplate.ts）は
// 「メンバーとして参加できます」という文面で株主には合わないため、株主あての文面をここに持つ。
// 値の無害化（改行の除去・HTML のエスケープ）は同じ関数を使う。

import {
  escapeHtml,
  sanitizeInlineText,
  type InviteEmailContent,
} from '@/features/settings/services/inviteEmailTemplate';

export interface ShareholderInviteEmailInput {
  /** 会社名 */
  organizationName: string;
  /** 株主の氏名・名称（名簿上の表記） */
  stakeholderName: string;
  /** 登録用のリンク（{origin}/invite/{token}） */
  inviteUrl: string;
  /** 有効期限（invites.expiresAt の ISO 文字列） */
  expiresAt: string;
}

const formatExpiryDate = (expiresAt: string): string => {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
};

export const buildShareholderInviteEmail = (input: ShareholderInviteEmailInput): InviteEmailContent => {
  const organizationName = sanitizeInlineText(input.organizationName);
  const stakeholderName = sanitizeInlineText(input.stakeholderName);
  const inviteUrl = input.inviteUrl.trim();
  const expiryDate = formatExpiryDate(input.expiresAt);
  const expiryLine = expiryDate ? `このリンクの有効期限は ${expiryDate} までです。` : 'このリンクには有効期限があります。お早めにご登録ください。';
  const intro = `${organizationName} より、株主ポータルのご案内です。`;
  const what = '株主ポータルでは、会社からのお知らせ・決算情報・文書と、ご自身の保有状況をご確認いただけます。';
  const how = '以下のリンクからパスワードを設定して、アカウントを登録してください。';

  const subject = `【${organizationName}】株主ポータルのご案内`;
  const text = [
    `${stakeholderName} 様`,
    '',
    intro,
    what,
    '',
    how,
    inviteUrl,
    '',
    expiryLine,
    '',
    '※このメールは OpenStock Japan から自動で送信しています。返信はできません。',
    '※心当たりがない場合は、このメールを破棄してください。',
  ].join('\n');

  // メールクライアントでは CSS 変数が使えないため、ここだけ色の値を直接書く（社内あての招待メールと同じ扱い）
  const html = [
    '<div style="font-family: sans-serif; line-height: 1.8; color: #1f2937; max-width: 560px;">',
    `  <p>${escapeHtml(stakeholderName)} 様</p>`,
    `  <p>${escapeHtml(intro)}<br />${escapeHtml(what)}</p>`,
    `  <p>${escapeHtml(how)}</p>`,
    `  <p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>`,
    `  <p>${escapeHtml(expiryLine)}</p>`,
    '  <p style="color: #6b7280; font-size: 12px;">※このメールは OpenStock Japan から自動で送信しています。返信はできません。<br />※心当たりがない場合は、このメールを破棄してください。</p>',
    '</div>',
  ].join('\n');

  return { subject, text, html };
};
