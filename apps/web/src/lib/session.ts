import 'server-only';
import { cookies } from 'next/headers';
import type { MeritUser } from '@merit/infrastructure';
import { users } from '../composition/container.js';

export const SESSION_COOKIE = 'merit_session';

/** The signed-in user, or null. Reads one cookie and one row; safe to call per render. */
export const currentUser = async (): Promise<MeritUser | null> => {
  const sessionId = cookies().get(SESSION_COOKIE)?.value;
  if (sessionId === undefined) return null;
  return users().findBySession(sessionId);
};
