// 汎用 API（PATCH /api/resources/<name>/<id>）は「行全体の置き換え」なので、1 項目だけ変えるときも全項目を送る。
// 一覧で読んだ行から、その送信用の値を作る。サーバ依存なし。

import { RESOURCES, type ResourceName } from '@/lib/resources/definitions';
import { toFormValue, type FieldValue } from '@/lib/resources/fields';

export const fullRowPayload = (
  resource: ResourceName,
  row: Record<string, unknown>,
  patch: Record<string, FieldValue> = {},
): Record<string, FieldValue> => {
  const payload: Record<string, FieldValue> = {};
  for (const field of RESOURCES[resource].fields) {
    const value = row[field.key];
    // 率（percent）だけは保存値（0.2）と入力値（20）が違うので、入力値に直す
    payload[field.key] = field.type === 'percent' ? toFormValue(field, value) : ((value ?? null) as FieldValue);
  }
  for (const key of Object.keys(patch)) {
    if (!(key in payload)) throw new Error(`${resource} に ${key} という項目はありません`);
    payload[key] = patch[key];
  }
  return payload;
};
