(function () {
  const { parseAmount, convert, formatMoney, formatMoneyLong, formatRate, describeApiError } = CurrencyCore;

  const form = document.getElementById("form");
  const amountInput = document.getElementById("amount");
  const amountError = document.getElementById("amount-error");
  const fromSelect = document.getElementById("from");
  const toSelect = document.getElementById("to");
  const swapBtn = document.getElementById("swap");
  const resultEl = document.getElementById("result");
  const resultBody = document.getElementById("result-body");
  const updatedEl = document.getElementById("updated");

  const API_KEY =
    typeof EXCHANGE_RATE_API_KEY === "string" ? EXCHANGE_RATE_API_KEY.trim() : "";
  const CACHE_MS = 10 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 10000;
  const STORAGE_KEY = "currency-converter:pair";

  const displayNames = (() => {
    try {
      return new Intl.DisplayNames(["en"], { type: "currency" });
    } catch (e) {
      return null;
    }
  })();
  const nameOf = (code) => {
    let name;
    try {
      name = displayNames && displayNames.of(code);
    } catch (e) {
      /* invalid code, use fallback */
    }
    return name && name !== code ? name : CURRENCY_NAMES[code] || code;
  };

  // ---- Dropdowns -----------------------------------------------------------
  const codes = Object.keys(CURRENCY_NAMES);
  function fillSelect(select) {
    const frag = document.createDocumentFragment();
    for (const code of codes) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = `${code} · ${nameOf(code)}`;
      frag.appendChild(option);
    }
    select.appendChild(frag);
  }
  fillSelect(fromSelect);
  fillSelect(toSelect);

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    /* ignore corrupt or blocked storage */
  }
  fromSelect.value = saved && codes.includes(saved.from) ? saved.from : "USD";
  toSelect.value = saved && codes.includes(saved.to) ? saved.to : "EUR";

  function savePair() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ from: fromSelect.value, to: toSelect.value }));
    } catch (e) {
      /* ignore */
    }
  }

  // ---- Rates ---------------------------------------------------------------
  class RatesError extends Error {}

  const cache = new Map(); // base code -> { rates, updated, fetchedAt }

  function ratesUrl(base) {
    return API_KEY
      ? `https://v6.exchangerate-api.com/v6/${encodeURIComponent(API_KEY)}/latest/${base}`
      : `https://open.er-api.com/v6/latest/${base}`;
  }

  async function loadRates(base, signal) {
    const hit = cache.get(base);
    if (hit && Date.now() - hit.fetchedAt < CACHE_MS) return hit;

    let response;
    try {
      response = await fetch(ratesUrl(base), { signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new RatesError("Could not reach the exchange rate service. Check your connection and try again.");
    }

    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      /* handled below */
    }
    if (!response.ok || !data || data.result !== "success") {
      const type = data && data["error-type"];
      if (!data && response.status >= 500) throw new RatesError("The rates service is unavailable right now. Please try again shortly.");
      throw new RatesError(describeApiError(type));
    }
    const rates = data.conversion_rates || data.rates;
    if (!rates || typeof rates !== "object") throw new RatesError("The rates service sent an unexpected response.");

    const entry = { rates, updated: data.time_last_update_utc || null, fetchedAt: Date.now() };
    cache.set(base, entry);
    return entry;
  }

  // ---- Rendering -----------------------------------------------------------
  function setState(state) {
    resultEl.dataset.state = state;
    resultEl.setAttribute("aria-busy", String(state === "loading"));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showLoading(from) {
    setState("loading");
    resultBody.replaceChildren(el("p", "status", `Fetching the latest ${from} rates...`));
  }

  function showError(message, canRetry = true) {
    setState("error");
    const nodes = [el("p", "error-title", "Could not get a rate"), el("p", "error-text", message)];
    if (canRetry) {
      const retry = el("button", "retry", "Try again");
      retry.type = "button";
      retry.addEventListener("click", () => run());
      nodes.push(retry);
    }
    resultBody.replaceChildren(...nodes);
    updatedEl.textContent = "";
  }

  function showResult({ amount, from, to, rate, updated }) {
    setState("ready");
    const total = convert(amount, rate);
    const locale = undefined; // use the visitor's locale for number formatting
    const line = el("p", "result-from", `${formatMoneyLong(amount, from, locale)} =`);
    const big = el("p", "result-to", formatMoney(total, to, locale));
    const name = el("p", "result-name", `${nameOf(to)} (${to})`);
    const rateLine = el("p", "result-rate", formatRate(rate, from, to, locale));
    resultBody.replaceChildren(line, big, name, rateLine);
    updatedEl.textContent = updated ? `Rates last updated ${formatUpdated(updated)}.` : "";
  }

  function formatUpdated(utcString) {
    const date = new Date(utcString);
    if (Number.isNaN(date.getTime())) return utcString;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function setAmountError(message) {
    amountError.textContent = message || "";
    if (message) amountInput.setAttribute("aria-invalid", "true");
    else amountInput.removeAttribute("aria-invalid");
  }

  // ---- Conversion flow -----------------------------------------------------
  let controller = null;
  let runId = 0;

  async function run() {
    const parsed = parseAmount(amountInput.value);
    if (!parsed.ok) {
      setAmountError(parsed.reason);
      if (controller) controller.abort();
      setState("invalid");
      resultBody.replaceChildren(el("p", "status", "Fix the amount above to see a result."));
      return;
    }
    setAmountError("");

    const from = fromSelect.value;
    const to = toSelect.value;
    if (controller) controller.abort();
    controller = new AbortController();
    const myRun = ++runId;
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let timedOut = false;
    controller.signal.addEventListener("abort", () => {
      if (myRun === runId) timedOut = true;
    });

    const cached = cache.get(from);
    if (!cached || Date.now() - cached.fetchedAt >= CACHE_MS) showLoading(from);

    try {
      const { rates, updated } = await loadRates(from, controller.signal);
      if (myRun !== runId) return;
      const rate = rates[to];
      if (typeof rate !== "number") {
        showError(`The rates service has no rate for ${to}. Choose another currency.`, false);
        return;
      }
      showResult({ amount: parsed.value, from, to, rate, updated });
    } catch (err) {
      if (myRun !== runId) return;
      if (err.name === "AbortError") {
        showError(timedOut ? "The rates service took too long to answer. Please try again." : "The request was cancelled.");
      } else if (err instanceof RatesError) {
        showError(err.message);
      } else {
        showError("Something went wrong. Please try again.");
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  let debounce = null;
  amountInput.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(run, 300);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(debounce);
    run();
  });
  for (const select of [fromSelect, toSelect]) {
    select.addEventListener("change", () => {
      savePair();
      run();
    });
  }
  swapBtn.addEventListener("click", () => {
    [fromSelect.value, toSelect.value] = [toSelect.value, fromSelect.value];
    savePair();
    run();
  });

  run();
})();
