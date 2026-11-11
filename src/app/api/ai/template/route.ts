// 文書テンプレートの作成を AI に手伝わせる（POST）。管理者・メンバーだけ。
//
// 本文（JSON）:
//   { mode: 'write', kind, request?, reference? }
//     … 種類ごとのひな形を AI に書かせる。会社の機関設計（取締役会の有無など）はサーバが DB から読んで渡す
//       （会社名・株主・金額などの台帳の値は送らない。ひな形には差し込み項目として書かせる）。
//   { mode: 'convert', kind, source }
//     … 貼り付けた文面（手元のひな形）の空欄を、差し込み項目に置き換える。AI は置き換える場所の案を返すだけで、
//       文面はサーバが機械的に置き換える（src/features/templates/services/convert.ts）。
//
// どちらも、返すのは「候補」。保存は、利用者が画面で確かめてから行う（/api/resources/document-templates）。

import { NextResponse } from 'next/server';
import { generateStructured } from '@/lib/ai/generate';
import { requireEditor } from '@/lib/authz';
import { badRequest, denied, readJson } from '@/lib/api/respond';
import { COMPANY_COLUMNS, governanceOf } from '@/lib/resources/company';
import type { ResourceValues } from '@/lib/resources/fields';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyBlankReplacements } from '@/features/templates/services/convert';
import { getTemplateKind, isTemplateKindId, scopesOfKind } from '@/features/templates/services/kinds';
import {
  buildConvertInstructions,
  buildWriteInput,
  buildWriteInstructions,
  CONVERT_SCHEMA,
  MAX_REFERENCE_LENGTH,
  MAX_REQUEST_LENGTH,
  MAX_SOURCE_LENGTH,
  validateConvertProposal,
  validateWrittenTemplate,
  WRITE_SCHEMA,
} from '@/features/templates/services/prompts';

export const runtime = 'nodejs';
export const maxDuration = 120;

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const failed = (result: { code: string; message: string }) =>
  NextResponse.json(
    { error: result.message, code: result.code },
    { status: result.code === 'limit_exceeded' || result.code === 'rate_limited' ? 429 : 502 },
  );

export const POST = async (request: Request) => {
  const check = await requireEditor();
  if (!check.ok) return denied(check);

  const body = (await readJson(request)) as Record<string, unknown> | null;
  const mode = body?.mode;
  if (!isTemplateKindId(body?.kind)) return badRequest('テンプレートの種類が正しくありません');
  const kind = getTemplateKind(body.kind);

  if (mode === 'write') {
    if (!kind.instruction) return badRequest('この種類のひな形は、AI では書きません。お手元の文面を貼り付けて取り込んでください');
    const userRequest = textOf(body?.request);
    const reference = textOf(body?.reference);
    if (userRequest.length > MAX_REQUEST_LENGTH) return badRequest('要望が長すぎます');
    if (reference.length > MAX_REFERENCE_LENGTH) return badRequest('参考にする文面が長すぎます');

    const { data: company, error } = await createAdminClient()
      .from('organizations')
      .select(COMPANY_COLUMNS)
      .eq('id', check.profile.organizationId)
      .single();
    if (error || !company) return badRequest('会社情報の取得に失敗しました', 500);

    const result = await generateStructured({
      purpose: 'template_writing',
      profile: check.profile,
      instructions: buildWriteInstructions(kind),
      input: [
        {
          type: 'text',
          text: buildWriteInput({ kind, governance: governanceOf(company as unknown as ResourceValues), request: userRequest, reference }),
        },
      ],
      schema: WRITE_SCHEMA,
      validate: (raw) => validateWrittenTemplate(raw, kind),
      signal: request.signal,
    });
    if (!result.ok) return failed(result);
    return NextResponse.json({ ...result.value, provider: result.provider, modelId: result.modelId });
  }

  if (mode === 'convert') {
    const source = typeof body?.source === 'string' ? body.source.replace(/\r\n?/g, '\n').trim() : '';
    if (!source) return badRequest('文面がありません');
    if (source.length > MAX_SOURCE_LENGTH) return badRequest('文面が長すぎます');

    const result = await generateStructured({
      purpose: 'template_writing',
      profile: check.profile,
      instructions: buildConvertInstructions(kind),
      input: [{ type: 'text', text: `【文面】\n${source}` }],
      schema: CONVERT_SCHEMA,
      validate: validateConvertProposal,
      signal: request.signal,
    });
    if (!result.ok) return failed(result);
    const converted = applyBlankReplacements(source, result.value.replacements, scopesOfKind(kind));
    return NextResponse.json({ ...converted, notes: result.value.notes, provider: result.provider, modelId: result.modelId });
  }

  return badRequest('操作の種類が正しくありません');
};
