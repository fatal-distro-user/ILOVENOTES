import { describe, it, expect, afterEach } from 'vitest';
import { platformKind, mimeFor, toBytes } from './fileio';

describe('platform file io', () => {
  afterEach(() => { delete (window as { ilnNative?: unknown }).ilnNative; });
  it('detects fallback in plain jsdom', () => { expect(platformKind()).toBe('fallback'); });
  it('detects desktop when bridge exists', () => {
    (window as { ilnNative?: unknown }).ilnNative = { isDesktop: true };
    expect(platformKind()).toBe('desktop');
  });
  it('maps mime types', () => {
    expect(mimeFor('.PNG')).toBe('image/png');
    expect(mimeFor('ilovenotes')).toBe('application/x-ilovenotes');
    expect(mimeFor('xyz')).toBe('application/octet-stream');
  });
  it('converts strings to bytes', async () => {
    expect(Array.from(await toBytes('hi'))).toEqual([104, 105]);
  });
});
