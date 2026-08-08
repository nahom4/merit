import { NextResponse, type NextRequest } from 'next/server';
import { loadConfig } from '@merit/infrastructure';
import { syncGmailOutreach } from '../../../../composition/container.js';

export const dynamic = 'force-dynamic';

interface PubSubMessage {
  readonly message?: {
    readonly data?: string;
  };
}

export async function POST(request: NextRequest) {
  const config = loadConfig();
  if (config.GOOGLE_OAUTH_CLIENT_ID === undefined || config.GOOGLE_OAUTH_CLIENT_SECRET === undefined) {
    return NextResponse.json({ error: 'Gmail sync is not configured.' }, { status: 503 });
  }

  const body = (await request.json()) as PubSubMessage;
  const data = body.message?.data;
  if (typeof data !== 'string') {
    return NextResponse.json({ error: 'Missing Pub/Sub data.' }, { status: 400 });
  }

  const decoded = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
    readonly emailAddress?: string;
    readonly historyId?: string;
  };
  if (typeof decoded.emailAddress !== 'string' || typeof decoded.historyId !== 'string') {
    return NextResponse.json({ error: 'Invalid Gmail notification.' }, { status: 400 });
  }

  const service = syncGmailOutreach();
  if (service === null) {
    return NextResponse.json({ error: 'Gmail sync is not configured.' }, { status: 503 });
  }

  const result = await service.execute({
    emailAddress: decoded.emailAddress,
    historyId: decoded.historyId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: 502 });
  }

  return NextResponse.json(result.value);
}
