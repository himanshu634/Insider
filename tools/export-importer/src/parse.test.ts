import { describe, expect, it } from 'vitest';
import { ExportParseError, parseExport } from './parse.js';
import { ANDROID_EXPORT, IOS_EXPORT } from './fixtures.js';

describe('parseExport: Android', () => {
  const result = parseExport(ANDROID_EXPORT);
  const msgs = result.messages;

  it('keeps chat messages and skips system lines and deleted placeholders', () => {
    expect(msgs.map((m) => m.sender)).toEqual([
      'Ramesh Patel',
      '+91 98765 43210',
      'Suresh Bhai',
      'Mahesh',
      'Mahesh',
      'Suresh Bhai',
      'Ramesh Patel',
    ]);
    // encryption notice, "created group", "added", subject change with ": " inside quotes
    expect(result.skippedSystem).toBe(4);
    expect(result.skippedDeleted).toBe(1);
    expect(msgs.every((m) => m.format === 'android')).toBe(true);
  });

  it('joins multi-line messages and trims trailing blank lines', () => {
    expect(msgs[0]!.body).toBe('એરંડા ભાવ આજે\nઊંઝા 1250-1290\nડીસા 1240-1280');
    expect(msgs[0]!.type).toBe('text');
    expect(msgs[0]!.text).toBe(msgs[0]!.body);
  });

  it('reads 12-hour times with a narrow no-break space, including 12 am / 12 pm', () => {
    expect(msgs[0]!.local).toEqual({ year: 2026, month: 10, day: 19, hour: 9, minute: 41, second: 0 });
    expect(msgs[3]!.local.hour).toBe(14); // 2:30 pm
    expect(msgs[4]!.local.hour).toBe(12); // 12:10 pm
    expect(msgs[5]!.local).toMatchObject({ day: 20, hour: 0, minute: 5 }); // 12:05 am
  });

  it('strips the bidi marks Android wraps around phone-number senders', () => {
    expect(msgs[1]!.sender).toBe('+91 98765 43210');
  });

  it('classifies media lines', () => {
    expect(msgs[2]).toMatchObject({ type: 'other', text: null, attachment: null, body: '<Media omitted>' });
    expect(msgs[3]).toMatchObject({
      type: 'image',
      attachment: 'IMG-20261019-WA0007.jpg',
      text: 'જીરું rate sheet',
    });
  });

  it('drops the "<This message was edited>" suffix', () => {
    expect(msgs[4]!.body).toBe('Cotton 7200 Gondal');
  });
});

describe('parseExport: iOS', () => {
  const result = parseExport(IOS_EXPORT);
  const msgs = result.messages;

  it('skips system lines credited to the group name', () => {
    expect(result.skippedSystem).toBe(2);
    expect(msgs).toHaveLength(5);
    expect(msgs.every((m) => m.format === 'ios')).toBe(true);
  });

  it('reads seconds, multi-line bodies and AM/PM', () => {
    expect(msgs[0]).toMatchObject({
      sender: 'Ramesh Patel',
      body: 'એરંડા 1250-1290\nઊંઝા',
      local: { year: 2026, month: 10, day: 19, hour: 9, minute: 41, second: 12 },
    });
    expect(msgs[3]!.local).toMatchObject({ hour: 21, minute: 41, second: 12 });
    expect(msgs[4]!.sender).toBe('+91 98765 43210');
  });

  it('classifies "omitted" and "<attached: ...>" media', () => {
    expect(msgs[1]).toMatchObject({ type: 'image', text: null, attachment: null });
    expect(msgs[2]).toMatchObject({ type: 'document', text: null, attachment: '00000012-Bhav-patrak.pdf' });
  });
});

describe('parseExport: formats and edge cases', () => {
  it('handles CRLF, a BOM and preamble lines', () => {
    const input = '﻿some header text\r\n19/10/2026, 21:41 - Ramesh: Castor 1290\r\nsecond line\r\n';
    const { messages, skippedPreamble } = parseExport(input);
    expect(skippedPreamble).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ body: 'Castor 1290\nsecond line', local: { year: 2026, hour: 21, minute: 41 } });
  });

  it('supports month-first dates with --date-format mdy', () => {
    const { messages } = parseExport('10/19/26, 9:41 AM - Ramesh: hi', { dateFormat: 'mdy' });
    expect(messages[0]!.local).toMatchObject({ year: 2026, month: 10, day: 19, hour: 9 });
  });

  it('accepts "a.m." / "p.m." markers', () => {
    const { messages } = parseExport('19/10/26, 9:41 p.m. - Ramesh: hi');
    expect(messages[0]!.local.hour).toBe(21);
  });

  it('throws a helpful error when the date order is wrong', () => {
    expect(() => parseExport('10/19/26, 9:41 AM - Ramesh: hi')).toThrow(ExportParseError);
    expect(() => parseExport('10/19/26, 9:41 AM - Ramesh: hi')).toThrow(/--date-format mdy/);
  });

  it('drops continuation lines that follow a system line', () => {
    const input = ['19/10/26, 9:00 am - Ramesh changed the group description', 'Bhav only, no forwards', '19/10/26, 9:01 am - Ramesh: ok'].join('\n');
    const { messages, skippedSystem } = parseExport(input);
    expect(skippedSystem).toBe(1);
    expect(messages.map((m) => m.body)).toEqual(['ok']);
  });
});
