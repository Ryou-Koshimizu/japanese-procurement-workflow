import { z } from 'zod';

const live = z.object({
  DATABASE_URL: z.string().startsWith('postgres'),
  APP_ORIGIN: z.httpUrl(),
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//)
    .optional(),
  MAIL_FROM: z.string().min(3).max(200).optional(),
});

export type Config =
  | {
      mode: 'demo';
      /** Shared demo database for multi-instance hosts (see demo-postgres.ts). */
      sharedDatabase?: { url: string; adminUrl: string };
    }
  | ({ mode: 'live' } & z.infer<typeof live>);

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.APP_MODE ?? 'demo';
  if (mode === 'demo') {
    const url = env.DEMO_DATABASE_URL;
    if (!url) return { mode };
    if (!url.startsWith('postgres'))
      throw new Error('DEMO_DATABASE_URL must be a PostgreSQL URL.');
    // Managed hosts hand out sslmode=require. node-postgres treats it as
    // verify-full today but will weaken it; keep certificate and host checks.
    const strict = (u: string) =>
      u.replace(
        /([?&])sslmode=(prefer|require|verify-ca)\b/,
        '$1sslmode=verify-full',
      );
    return {
      mode,
      sharedDatabase: {
        url: strict(url),
        adminUrl: strict(env.DEMO_DATABASE_URL_UNPOOLED || url),
      },
    };
  }
  if (mode !== 'live') throw new Error('APP_MODE must be demo or live');
  const parsed = live.safeParse({
    ...env,
    SMTP_URL: env.SMTP_URL || undefined,
    MAIL_FROM: env.MAIL_FROM || undefined,
  });
  if (!parsed.success)
    throw new Error(
      '実運用モードには DATABASE_URL と APP_ORIGIN（例：https://orders.example.com）が必要です。SMTP_URL は smtp:// または smtps:// で始めてください。',
    );
  if (parsed.data.SMTP_URL && !parsed.data.MAIL_FROM)
    throw new Error('メールを送るには MAIL_FROM（送信元アドレス）が必要です。');
  return { mode, ...parsed.data };
}

/**
 * Live mode: the exact public origin people use, e.g. https://orders.example.com.
 * Behind a proxy the request URL and Host header can differ from it, so the
 * origin check, the Secure cookie flag and the links in emails use this.
 */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env) {
  return env.APP_MODE === 'live' && env.APP_ORIGIN
    ? new URL(env.APP_ORIGIN).origin
    : null;
}

/** Today's date in Japan, YYYY-MM-DD. */
export function todayInJapan(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(
    now,
  );
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
