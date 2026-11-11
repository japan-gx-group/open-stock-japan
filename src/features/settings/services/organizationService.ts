// 企業情報（organizations の基本項目）の取得・更新サービス。
// Supabase のブラウザクライアント（RLS 前提）から呼ぶ。
// RLS（organizations_select_own / organizations_update_own_admin）により、取得・更新ともログインユーザーの所属組織1件だけが対象になる。
import { createClient } from '@/lib/supabase/client';
import type { OrganizationInfo } from '../types';

// 企業設定の画面が扱う基本項目だけを読む（機関設計・資本金などは「会社情報・役員」の画面が扱う）。
const ORG_COLUMNS = 'id, name, corporateNumber, address, fiscalYearStartMonth';

interface OrgRow {
  id: string;
  name: string;
  corporateNumber: string | null;
  address: string | null;
  fiscalYearStartMonth: number | null;
}

const toOrganizationInfo = (row: OrgRow): OrganizationInfo => ({
  id: row.id,
  name: row.name,
  corporateNumber: row.corporateNumber ?? '',
  address: row.address ?? '',
  fiscalYearStartMonth: row.fiscalYearStartMonth,
});

export interface OrganizationUpdateInput {
  name: string;
  corporateNumber: string;
  address: string;
  fiscalYearStartMonth: number | null;
}

// 自組織の企業情報を1件取得する。
// RLS が自組織の行だけを返すため、絞り込みなしの single() で自組織が一意に取得できる。
export const getOrganization = async (): Promise<OrganizationInfo> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('organizations')
    .select(ORG_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error('企業情報の取得に失敗しました');
  }
  return toOrganizationInfo(data as OrgRow);
};

// PostgREST が single() で 0 行を返したときのエラーコード。
const NO_ROWS_CODE = 'PGRST116';

// 企業情報を更新する。更新できるのは自組織の管理者だけ（RLS の organizations_update_own_admin が
// current_user_is_admin() を見る）。管理者でない人・自組織以外の id では、RLS で更新対象が 0 行になり、
// エラーではなく 0 行で返るため、single() の 0 行のエラーを「管理者のみ変更できます」として伝える。
export const updateOrganization = async (
  id: string,
  input: OrganizationUpdateInput,
): Promise<OrganizationInfo> => {
  const supabase = createClient();
  // 空文字は null に正規化して保存する（未入力を空文字で残さない）。
  const { data, error } = await supabase
    .from('organizations')
    .update({
      name: input.name.trim(),
      corporateNumber: input.corporateNumber.trim() || null,
      address: input.address.trim() || null,
      fiscalYearStartMonth: input.fiscalYearStartMonth,
    })
    .eq('id', id)
    .select(ORG_COLUMNS)
    .single();

  if (error?.code === NO_ROWS_CODE) {
    throw new Error('企業情報は管理者のみ変更できます');
  }
  if (error || !data) {
    throw new Error('企業情報の保存に失敗しました');
  }
  return toOrganizationInfo(data as OrgRow);
};
