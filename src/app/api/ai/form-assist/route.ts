// 入力の補助（POST）。貼り付けた文章や添付した PDF・画像から、フォームの項目の候補を AI に読み取らせる。
// 返すのは候補だけで、保存はしない（利用者がフォームで確かめて保存する）。編集できる人（管理者・メンバー）だけが使える。
// 本文は multipart/form-data: resource（リソース名）、text（任意）、file（任意・PDF または画像・4MB まで）。

import { NextResponse } from 'next/server';
import { generateStructured } from '@/lib/ai/generate';
import type { AiInputPart } from '@/lib/ai/inputCheck';
import { requireEditor } from '@/lib/authz';
import { badRequest, denied } from '@/lib/api/respond';
import { detectFileMimeType } from '@/lib/files/fileSignature';
import {
  buildFormAssistInstructions,
  buildFormAssistSchema,
  validateFormAssist,
  type RefCandidate,
} from '@/lib/resources/aiSchema';
import { COMPANY_DEF } from '@/lib/resources/company';
import { getResource, isResourceName, RESOURCES, type ResourceName } from '@/lib/resources/definitions';
import type { ResourceDef } from '@/lib/resources/fields';
import { listResource } from '@/lib/resources/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_TEXT_LENGTH = 60_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REF_CANDIDATES = 200;

export const POST = async (request: Request) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest('入力内容が不正です');
  }
  const resource = String(form.get('resource') ?? '');
  const def: ResourceDef | null = resource === 'company' ? COMPANY_DEF : isResourceName(resource) ? getResource(resource) : null;
  if (!def) return badRequest('対象が見つかりません', 404);

  const text = String(form.get('text') ?? '').trim();
  const file = form.get('file');
  if (text.length > MAX_TEXT_LENGTH) return badRequest('文章が長すぎます。必要な部分だけを貼り付けてください');

  const input: AiInputPart[] = [];
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return badRequest('ファイルは 4MB までです');
    const data = new Uint8Array(await file.arrayBuffer());
    const mimeType = detectFileMimeType(data);
    if (!mimeType) return badRequest('PDF または PNG・JPEG・WebP の画像を選んでください');
    input.push({ type: mimeType === 'application/pdf' ? 'pdf' : 'image', data });
  }
  if (text) input.push({ type: 'text', text });
  if (input.length === 0) return badRequest('文章を貼り付けるか、ファイルを選んでください');

  // 参照の項目は、自組織の登録済みの行を候補として AI に見せ、その中からだけ選ばせる
  const refs: Record<string, RefCandidate[]> = {};
  for (const field of def.fields) {
    if (field.type !== 'ref' || !field.ref || field.aiSkip || field.hidden) continue;
    const target = RESOURCES[field.ref as ResourceName];
    const rows = await listResource(field.ref as ResourceName, check.profile.organizationId);
    refs[field.key] = rows.slice(0, MAX_REF_CANDIDATES).map((row) => ({ id: row.id, label: target.labelOf(row) }));
  }

  const result = await generateStructured({
    purpose: 'form_assist',
    profile: check.profile,
    instructions: buildFormAssistInstructions(def, refs),
    input,
    schema: buildFormAssistSchema(def, refs),
    validate: validateFormAssist(def, refs),
    signal: request.signal,
  });
  if (!result.ok) {
    const status = result.code === 'limit_exceeded' || result.code === 'rate_limited' ? 429 : result.code === 'invalid_input' ? 400 : 502;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }
  return NextResponse.json({ ...result.value, provider: result.provider, modelId: result.modelId });
};
