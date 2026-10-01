import { describe, expect, it } from 'vitest';
import { browserFamily, classifyStartupError, describeFailure, errorText, isIgnorableError, type Environment, type FailureKind } from './errorMessages';

const CHROME_124 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CHROME_100 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const env = (userAgent: string, secureContext = true, hostname = 'localhost'): Environment => ({ userAgent, secureContext, hostname });
const KINDS: FailureKind[] = ['no-webgpu', 'no-adapter', 'device-request', 'device-lost', 'init-failed', 'loop-failed', 'uncaught'];

describe('browserFamily', () => {
  it('tells the browsers apart, Edge before Chrome', () => {
    expect(browserFamily(CHROME_124)).toEqual({ family: 'chrome', major: 124 });
    expect(browserFamily(EDGE)).toEqual({ family: 'edge', major: 124 });
    expect(browserFamily(FIREFOX)).toEqual({ family: 'firefox', major: 125 });
    expect(browserFamily(SAFARI)).toEqual({ family: 'safari', major: 17 });
    expect(browserFamily('curl/8')).toEqual({ family: 'other', major: 0 });
  });
});

describe('describeFailure', () => {
  it('every kind has a title, a summary, steps and the technical detail', () => {
    for (const kind of KINDS) {
      const m = describeFailure(kind, 'boom', env(CHROME_124));
      expect(m.kind).toBe(kind);
      expect(m.title.length, kind).toBeGreaterThan(5);
      expect(m.summary.length, kind).toBeGreaterThan(20);
      expect(m.steps.length, kind).toBeGreaterThanOrEqual(2);
      expect(m.detail).toBe('boom');
    }
  });

  it('no WebGPU in Chrome 124: hardware acceleration, chrome://gpu and the flag', () => {
    const text = describeFailure('no-webgpu', '', env(CHROME_124)).steps.join('\n');
    expect(text).toContain('chrome://settings/system');
    expect(text).toContain('chrome://gpu');
    expect(text).toContain('#enable-unsafe-webgpu');
    expect(text).toContain('driver');
  });

  it('uses edge:// links for Edge', () => {
    const text = describeFailure('no-webgpu', '', env(EDGE)).steps.join('\n');
    expect(text).toContain('edge://gpu');
    expect(text).not.toContain('chrome://');
  });

  it('an old Chrome is told to update to 113', () => {
    const steps = describeFailure('no-webgpu', '', env(CHROME_100)).steps;
    expect(steps[0]).toMatch(/Chrome 100.*113 or newer/);
  });

  it('an insecure page gets the secure-context hint first, naming the host', () => {
    const steps = describeFailure('no-webgpu', '', env(CHROME_124, false, '192.168.1.20')).steps;
    expect(steps[0]).toContain('secure');
    expect(steps[0]).toContain('192.168.1.20');
    expect(steps[0]).toContain('http://localhost:5173');
    expect(describeFailure('no-webgpu', '', env(CHROME_124, true)).steps[0]).not.toContain('secure pages');
  });

  it('Firefox and Safari get their own advice', () => {
    expect(describeFailure('no-webgpu', '', env(FIREFOX)).steps.join(' ')).toContain('dom.webgpu.enabled');
    expect(describeFailure('no-webgpu', '', env(SAFARI)).steps.join(' ')).toContain('Safari 26');
  });

  it('only a lost device offers Recover, only an uncaught error offers Keep going', () => {
    for (const kind of KINDS) {
      const m = describeFailure(kind, '', env(CHROME_124));
      expect(m.recover, kind).toBe(kind === 'device-lost');
      expect(m.dismiss, kind).toBe(kind === 'uncaught');
    }
  });
});

describe('error helpers', () => {
  it('classifies GPU init errors by their kind, everything else is an init failure', () => {
    expect(classifyStartupError({ kind: 'no-adapter' })).toBe('no-adapter');
    expect(classifyStartupError({ kind: 'device-request' })).toBe('device-request');
    expect(classifyStartupError(new Error('x'))).toBe('init-failed');
    expect(classifyStartupError(null)).toBe('init-failed');
    expect(classifyStartupError({ kind: 'bogus' })).toBe('init-failed');
  });

  it('turns any thrown value into text', () => {
    expect(errorText(new Error('bad'))).toBe('bad');
    expect(errorText('plain')).toBe('plain');
    expect(errorText({ a: 1 })).toBe('{"a":1}');
    expect(errorText(undefined)).toBe('undefined');
  });

  it('ignores browser noise that is not a failure', () => {
    expect(isIgnorableError('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isIgnorableError('Script error.')).toBe(true);
    expect(isIgnorableError('TypeError: x is undefined')).toBe(false);
  });
});
