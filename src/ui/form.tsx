'use client';
// Sending a change from a screen: the button stays pressed while the request
// runs and stamps a check when it succeeds; errors come back in words (and per
// field when the server names them).
import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { settle, type PressState } from './press-button';
import { burst, BURST_MS } from './burst';

export class SendError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function send(url: string, body?: unknown, method = 'POST') {
  const r = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new SendError(
      json.error ?? '保存できませんでした。',
      json.fields ?? {},
    );
  return json;
}

/** One action: state for the button, the error, and run() that posts then reloads. */
export function useAction() {
  const [state, setState] = useState<PressState>('idle');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = async (
    url: string,
    body?: unknown,
    opts: {
      method?: string;
      then?: (json: { result?: unknown }) => void;
      /** Throw paper from this element when it succeeds (placing an order). */
      burstFrom?: Element | null;
    } = {},
  ) => {
    setState('busy');
    setError('');
    setFields({});
    try {
      const json = await send(url, body, opts.method);
      setState('done');
      if (opts.burstFrom) burst(opts.burstFrom);
      await settle(opts.burstFrom ? BURST_MS : undefined);
      if (opts.then) opts.then(json);
      else window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setFields(e instanceof SendError ? e.fields : {});
      setState('idle');
    }
  };
  return { state, error, fields, run, setError };
}

export function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="alert" role="alert">
      <TriangleAlert className="icon" aria-hidden="true" />
      {message}
    </div>
  );
}
