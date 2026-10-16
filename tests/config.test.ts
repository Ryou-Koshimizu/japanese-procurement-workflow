import { describe, expect, it } from 'vitest';
import {
  readConfig as read,
  publicOrigin as origin,
  addDays,
} from '../src/server/config';

const readConfig = (e: Record<string, string>) => read(e as NodeJS.ProcessEnv);
const publicOrigin = (e: Record<string, string>) =>
  origin(e as NodeJS.ProcessEnv);

describe('configuration', () => {
  it('defaults to the demo', () => {
    expect(readConfig({})).toEqual({ mode: 'demo' });
  });
  it('keeps certificate checks on the shared demo database', () => {
    const c = readConfig({
      DEMO_DATABASE_URL: 'postgresql://u:p@h/db?sslmode=require',
    });
    expect(c.mode === 'demo' && c.sharedDatabase?.url).toBe(
      'postgresql://u:p@h/db?sslmode=verify-full',
    );
  });
  it('needs a database and the public origin in live mode', () => {
    expect(() => readConfig({ APP_MODE: 'live' })).toThrow('APP_ORIGIN');
    const c = readConfig({
      APP_MODE: 'live',
      DATABASE_URL: 'postgresql://a@b/c',
      APP_ORIGIN: 'https://orders.example.com',
    });
    expect(c.mode).toBe('live');
    expect(
      publicOrigin({
        APP_MODE: 'live',
        APP_ORIGIN: 'https://orders.example.com/x',
      }),
    ).toBe('https://orders.example.com');
  });
  it('needs a sender address with SMTP', () => {
    expect(() =>
      readConfig({
        APP_MODE: 'live',
        DATABASE_URL: 'postgresql://a@b/c',
        APP_ORIGIN: 'https://orders.example.com',
        SMTP_URL: 'smtps://u:p@smtp.example.com:465',
      }),
    ).toThrow('MAIL_FROM');
    expect(() =>
      readConfig({
        APP_MODE: 'live',
        DATABASE_URL: 'postgresql://a@b/c',
        APP_ORIGIN: 'https://orders.example.com',
        SMTP_URL: 'http://not-smtp',
      }),
    ).toThrow();
  });
  it('adds days across months', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
  });
});
