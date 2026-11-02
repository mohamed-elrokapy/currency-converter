/*
 * Pure helpers for the currency converter (no DOM, no network).
 * Usable from the browser (global CurrencyCore) and from Node (require).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CurrencyCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_AMOUNT = 1e15;

  /**
   * Parse what a person typed into a number.
   * Returns { ok: true, value } or { ok: false, reason }.
   * Empty input means 1 (the field placeholder says "1").
   * Accepts "1234.5", "1,234.50", "1.234,50" and "12,5".
   */
  function parseAmount(input) {
    let text = String(input ?? "").trim().replace(/[\s ']/g, "");
    if (text === "") return { ok: true, value: 1, isDefault: true };
    if (text.startsWith("-")) return { ok: false, reason: "Enter an amount greater than or equal to zero." };
    if (!/^[\d.,]+$/.test(text)) return { ok: false, reason: "Use digits only, for example 1250.50." };

    const lastDot = text.lastIndexOf(".");
    const lastComma = text.lastIndexOf(",");
    if (lastDot !== -1 && lastComma !== -1) {
      // The separator that appears last is the decimal one.
      const decimal = lastDot > lastComma ? "." : ",";
      const thousands = decimal === "." ? "," : ".";
      const intPart = text.slice(0, text.lastIndexOf(decimal));
      const grouped = new RegExp("^\\d{1,3}(\\" + thousands + "\\d{3})+$");
      if (!grouped.test(intPart)) return { ok: false, reason: "That does not look like a number." };
      text = text.split(thousands).join("").replace(decimal, ".");
    } else if (lastComma !== -1) {
      const thousandsOnly = /^\d{1,3}(,\d{3})+$/.test(text);
      text = thousandsOnly ? text.replace(/,/g, "") : text.replace(",", ".");
    } else if ((text.match(/\./g) || []).length > 1) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(text)) return { ok: false, reason: "That does not look like a number." };
      text = text.replace(/\./g, "");
    }

    if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return { ok: false, reason: "That does not look like a number." };
    const value = Number(text);
    if (!Number.isFinite(value) || value > MAX_AMOUNT) return { ok: false, reason: "That amount is too large." };
    return { ok: true, value, isDefault: false };
  }

  function convert(amount, rate) {
    return amount * rate;
  }

  // Format a money amount in a currency. Tiny results get significant digits
  // instead of rounding to 0.00. Unknown codes fall back to "123.45 XYZ".
  function formatMoney(value, code, locale) {
    try {
      const small = value !== 0 && Math.abs(value) < 0.01;
      const options = small
        ? { style: "currency", currency: code, maximumSignificantDigits: 4 }
        : { style: "currency", currency: code };
      return new Intl.NumberFormat(locale, options).format(value);
    } catch (err) {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) + " " + code;
    }
  }

  // "1,250.50 US dollars" (the currency spelled out; used for the source amount)
  function formatMoneyLong(value, code, locale) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "name" }).format(value);
    } catch (err) {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) + " " + code;
    }
  }

  // "1 USD = 0.9214 EUR"
  function formatRate(rate, from, to, locale) {
    const number = new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(rate);
    return `1 ${from} = ${number} ${to}`;
  }

  // Turn an exchange-rate API failure into a sentence for people.
  function describeApiError(errorType) {
    switch (errorType) {
      case "invalid-key":
      case "inactive-account":
        return "The exchange rate API key was rejected. Check EXCHANGE_RATE_API_KEY in config.js.";
      case "quota-reached":
        return "The exchange rate API request limit has been reached. Try again later.";
      case "unsupported-code":
        return "That currency is not supported by the rates service.";
      case "malformed-request":
        return "The rates request was malformed.";
      default:
        return "The rates service returned an error. Please try again.";
    }
  }

  return { parseAmount, convert, formatMoney, formatMoneyLong, formatRate, describeApiError, MAX_AMOUNT };
});
