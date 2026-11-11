// Route Handler の共通の返し方（サーバ専用）。
import 'server-only';
import { NextResponse } from 'next/server';
import type { AuthzCheck } from '@/lib/authz';
import type { WriteResult } from '@/lib/resources/server';

export const denied = (check: Extract<AuthzCheck, { ok: false }>): NextResponse =>
  NextResponse.json({ error: check.error }, { status: check.status });

export const badRequest = (error: string, status = 400): NextResponse => NextResponse.json({ error }, { status });

export const fromWriteResult = <T>(result: WriteResult<T>, key: string, successStatus = 200): NextResponse =>
  result.ok
    ? NextResponse.json({ [key]: result.data }, { status: successStatus })
    : NextResponse.json({ error: result.error, fieldErrors: result.fieldErrors ?? {} }, { status: result.status });

export const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};
