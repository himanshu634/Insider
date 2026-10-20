import { describe, expect, test } from 'vitest';

import { extractNumbers, uncheckedNumbers } from './number-check.js';

describe('extractNumbers', () => {
  test('ranges are two numbers', () => expect(extractNumbers('1250-1290')).toEqual([1250, 1290]));
  test('keeps decimals and drops a trailing full stop', () =>
    expect(extractNumbers('6250.5 and 6300.')).toEqual([6250.5, 6300]));
});

describe('uncheckedNumbers', () => {
  test('formatted answer matches raw evidence', () =>
    expect(uncheckedNumbers('Castor ₹6,250–6,450/q', ['{"min":6250,"max":6450}'])).toEqual([]));
  test('Gujarati digits match', () => expect(uncheckedNumbers('ભાવ ૬૨૫૦', ['6250'])).toEqual([]));
  test('rounded evidence matches', () => expect(uncheckedNumbers('about 6250', ['6250.4'])).toEqual([]));
  test('a number in any evidence item matches', () =>
    expect(uncheckedNumbers('6250 and 6450', ['min 6250', 'max 6450'])).toEqual([]));
  test('small numbers are not checked', () =>
    expect(uncheckedNumbers('over 7 days in 3 groups', [])).toEqual([]));
  test('the threshold number itself is checked', () =>
    expect(uncheckedNumbers('99 and 100', [])).toEqual([100]));
  test('invented number is caught', () =>
    expect(uncheckedNumbers('₹9,999 in Gondal', ['6250'])).toEqual([9999]));
  test('only the invented number of several is returned', () =>
    expect(uncheckedNumbers('6250 to 9999', ['6250'])).toEqual([9999]));
  test('a list of numbers in compact JSON evidence matches', () =>
    expect(uncheckedNumbers('Castor 6250 to 6450', ['[6250,6450]'])).toEqual([]));
  test('a number repeated in the answer is returned once', () =>
    expect(uncheckedNumbers('₹9,999 and ₹9,999', ['6250'])).toEqual([9999]));
  test('unchecked numbers come in the order first seen', () =>
    expect(uncheckedNumbers('9999, 7000, 9999, 8000', [])).toEqual([9999, 7000, 8000]));
});
