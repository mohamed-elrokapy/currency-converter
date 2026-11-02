const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAmount, convert, formatMoney, formatMoneyLong, formatRate, describeApiError } = require("../convert.js");

test("empty input defaults to 1", () => {
  assert.deepEqual(parseAmount("  "), { ok: true, value: 1, isDefault: true });
});

test("parses plain, grouped and decimal-comma numbers", () => {
  assert.equal(parseAmount("1250.5").value, 1250.5);
  assert.equal(parseAmount("1,234.56").value, 1234.56);
  assert.equal(parseAmount("1.234,56").value, 1234.56);
  assert.equal(parseAmount("12,5").value, 12.5);
  assert.equal(parseAmount("1,500").value, 1500);
  assert.equal(parseAmount("1 000 000").value, 1000000);
});

test("rejects negatives, letters and nonsense with a reason", () => {
  for (const bad of ["-5", "abc", "12abc", "1.2.3,4", "1e5", "$5"]) {
    const result = parseAmount(bad);
    assert.equal(result.ok, false, bad);
    assert.ok(result.reason.length > 0);
  }
});

test("rejects absurdly large amounts", () => {
  assert.equal(parseAmount("9".repeat(20)).ok, false);
});

test("convert multiplies by the rate", () => {
  assert.equal(convert(250, 0.5), 125);
});

test("formatMoney uses the currency's own decimals", () => {
  assert.equal(formatMoney(1234.5, "USD", "en-US"), "$1,234.50");
  assert.equal(formatMoney(1234.5, "JPY", "en-US"), "¥1,235");
  assert.equal(formatMoney(1.5, "KWD", "en-US"), "KWD 1.500");
});

test("formatMoney keeps tiny amounts visible instead of 0.00", () => {
  assert.match(formatMoney(0.0000627, "USD", "en-US"), /0\.0000627/);
});

test("formatMoney falls back for invalid currency codes", () => {
  assert.equal(formatMoney(10, "??", "en-US"), "10 ??");
});

test("formatRate reads naturally", () => {
  assert.equal(formatRate(0.92145678, "USD", "EUR", "en-US"), "1 USD = 0.921457 EUR");
});

test("describeApiError maps known error types", () => {
  assert.match(describeApiError("invalid-key"), /API key/);
  assert.match(describeApiError("quota-reached"), /limit/);
  assert.match(describeApiError("something-new"), /try again/i);
});

test("formatMoneyLong spells the currency out and falls back for bad codes", () => {
  assert.equal(formatMoneyLong(1250.5, "USD", "en-US"), "1,250.50 US dollars");
  assert.equal(formatMoneyLong(1, "USD", "en-US"), "1.00 US dollars");
  assert.equal(formatMoneyLong(3, "??", "en-US"), "3 ??");
});
