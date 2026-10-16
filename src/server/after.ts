import { after } from 'next/server';
import { flushOutbox } from './runtime';

/** Deliver the notifications a change queued, once the response is sent. */
export function deliverAfterResponse() {
  after(flushOutbox);
}
