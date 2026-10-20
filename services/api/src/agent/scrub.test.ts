import { describe, expect, test } from 'vitest';

import { scrubContacts } from './scrub.js';

describe('scrubContacts masks phone numbers', () => {
  test.each([
    ['call 9876543210', 'call [phone]'],
    ['call 98765 43210', 'call [phone]'],
    ['call 98765-43210', 'call [phone]'],
    ['call 98765 43210', 'call [phone]'],
    ['call +919876543210', 'call [phone]'],
    ['call +91 98765 43210', 'call [phone]'],
    ['call +91-98765-43210', 'call [phone]'],
    ['call 919876543210', 'call [phone]'],
    ['call 0091 9876543210', 'call [phone]'],
    ['call 09876543210', 'call [phone]'],
    ['call 0 98765 43210', 'call [phone]'],
    ['every first digit from 6: 6123456789 7123456789 8123456789', 'every first digit from 6: [phone] [phone] [phone]'],
    ['Patel Traders (9876543210), Rajkot', 'Patel Traders ([phone]), Rajkot'],
    ['castor 6250\ncall 98765 43210', 'castor 6250\ncall [phone]'],
    ['સંપર્ક ૯૮૭૬૫ ૪૩૨૧૦', 'સંપર્ક [phone]'],
    ['संपर्क ९८७६५४३२१०', 'संपर्क [phone]'],
  ])('%j', (text, scrubbed) => expect(scrubContacts(text)).toBe(scrubbed));
});

describe('scrubContacts masks @mentions', () => {
  test.each([
    ['@919876543210 rate?', '@[member] rate?'],
    ['ok @919876543210 and @14155550123', 'ok @[member] and @[member]'],
    // A mention by WhatsApp's linked id, not by phone number.
    ['@123456789012345 see this', '@[member] see this'],
    ['call 98765 43210 @919876543210', 'call [phone] @[member]'],
  ])('%j', (text, scrubbed) => expect(scrubContacts(text)).toBe(scrubbed));
});

describe('scrubContacts leaves prices alone', () => {
  test.each([
    'Gondal arenda 1250-1290',
    'Castor ₹6,250',
    'castor 12550',
    '45000 guni',
    'turnover 1,00,000',
    'ભાવ ૧૨૫૦',
    'date 2026-10-19',
    'rates 6250 6300 6350',
    'castor 7000 7100 50 guni',
    'castor 6250-6450',
    // Traders write "@" for "at" a price.
    'arenda @6250',
    'arenda @ 1250',
    'arenda @1,250',
    'arenda @1250-1290',
    // Not a mobile number: the first digit is not 6 to 9, or the run is too long.
    'id 5123456789',
    'id 98765432101',
  ])('%j', (text) => expect(scrubContacts(text)).toBe(text));

  test('a 5-digit price range from 60000 reads as a phone and is masked: a lost price fails closed in the number check, a leaked phone does not', () =>
    expect(scrubContacts('kapas candy 60500-61500')).toBe('kapas candy [phone]'));
});
