import { describe, expect, it } from 'vitest';
import { serviceFailureMessage, serviceMessage } from './service-message';
import { capabilityTitle, dimensionLabel, dimensionNote, gateDetail, gateLabel } from './gh-presentation';
import { DIMENSIONS, registryStatus } from './gh-registry-fixtures';

describe('serviceFailureMessage (CR-129)', () => {
  const id = '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8';

  it('adds the correlation ID to server errors so the user can report it', () => {
    const body = { error: { code: 'INTERNAL_ERROR', message: '예상하지 못한 오류' }, correlation_id: id };
    expect(serviceFailureMessage(body, 'Unable to load search results.', 500))
      .toBe(`Unable to load search results. (INTERNAL_ERROR) Reference ID: ${id}`);
  });

  it('keeps client errors as they were', () => {
    const body = { error: { code: 'QUERY_SYNTAX_ERROR', message: '질의 오류' }, correlation_id: id };
    expect(serviceFailureMessage(body, 'Unable to load search results.', 400)).toBe('Unable to load search results. (QUERY_SYNTAX_ERROR)');
  });

  it('does not print a value that is not a correlation ID', () => {
    expect(serviceFailureMessage({ correlation_id: '<script>' }, 'Unable to load.', 500)).toBe('Unable to load.');
    expect(serviceFailureMessage(null, 'Unable to load.', 502)).toBe('Unable to load.');
  });
});

describe('English service presentation preserves source payloads', () => {
  it('keeps English diagnostics and uses an actionable fallback with the service code for Korean diagnostics', () => {
    const error = { code: 'SEQUENCE_EPOCH_STALE', message: '시퀀스가 바뀌었습니다' };
    const original = JSON.stringify(error);
    expect(serviceMessage(error.message, 'Reload the range using the current epoch.', error.code))
      .toBe('Reload the range using the current epoch. (SEQUENCE_EPOCH_STALE)');
    expect(serviceMessage('Try again in 30 seconds.', 'Unable to load.', error.code)).toBe('Try again in 30 seconds.');
    expect(serviceMessage('', 'Unable to load.')).toBe('Unable to load.');
    expect(serviceMessage(null, 'Unable to load.', '<untrusted code>')).toBe('Unable to load.');
    expect(JSON.stringify(error)).toBe(original);
  });

  it('presents registry labels and notes without mutating the source report or its hash', () => {
    const status = registryStatus();
    const before = JSON.stringify(status);
    for (const dimension of DIMENSIONS) {
      expect(dimensionLabel(dimension)).not.toMatch(/\p{Script=Hangul}/u);
      expect(dimensionNote(dimension)).not.toMatch(/\p{Script=Hangul}/u);
    }
    for (const gate of status.gates) {
      expect(gateLabel(gate)).not.toMatch(/\p{Script=Hangul}/u);
      expect(gateDetail(gate)).not.toMatch(/\p{Script=Hangul}/u);
    }
    expect(capabilityTitle({ id: 'pr.list', title: 'PR 목록 조회' })).toBe('List pull requests');
    expect(JSON.stringify(status)).toBe(before);
  });
});
