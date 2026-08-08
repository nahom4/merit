import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { users } from '../../../../composition/container.js';
import { SESSION_COOKIE } from '../../../../lib/session.js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessionId = cookies().get(SESSION_COOKIE)?.value;
  if (sessionId !== undefined) await users().deleteSession(sessionId);

  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
