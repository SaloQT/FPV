import { describe, expect, it } from 'vitest';
import { describeFailure } from './errorMessages';
import { loopbackOrigin, withLoopbackPort } from './errorScreen';

const insecure = { userAgent: 'Mozilla/5.0 Chrome/126.0', secureContext: false, hostname: '192.168.1.20' };
const hint = (steps: string[]): string => steps[0];

describe('the secure-page hint names the port the page is served on', () => {
  const m = describeFailure('no-webgpu', '', insecure);

  it('the wording of errorMessages still carries the dev address this module rewrites', () => {
    expect(hint(m.steps)).toContain('http://localhost:5173');
  });

  it('npm run preview (4173) and a default-port deployment get their own loopback address', () => {
    expect(hint(withLoopbackPort(m, '4173').steps)).toContain('http://localhost:4173 ');
    expect(hint(withLoopbackPort(m, '4173').steps)).not.toContain('5173');
    expect(hint(withLoopbackPort(m, '').steps)).toContain('http://localhost (not a network address');
  });

  it('the dev server port leaves the message untouched, and other fields are kept', () => {
    expect(withLoopbackPort(m, '5173')).toBe(m);
    const r = withLoopbackPort(m, '8080');
    expect(r.title).toBe(m.title);
    expect(r.steps).toHaveLength(m.steps.length);
  });

  it('loopbackOrigin', () => {
    expect(loopbackOrigin('4173')).toBe('http://localhost:4173');
    expect(loopbackOrigin('')).toBe('http://localhost');
  });
});
