const _REACT_HYDRATION = /<!--\$\??!?-->|<!--\/\$\??!?-->/g;
const _SHADOW_TEMPLATE =
  /<template\s+shadowroot(?:mode)?="[^"]*"[^>]*>([\s\S]*?)<\/template>/gi;

const _WAIT_UNTIL_MAP = {
  load: "load",
  domcontentloaded: "domContentLoaded",
  networkidle: "networkIdle",
};

const _normalizeHtml = (html) => {
  if (!html) return html;
  return html
    .replace(_REACT_HYDRATION, "")
    .replace(_SHADOW_TEMPLATE, "$1");
};

const _safeError = (error) => {
  if (!error) return "unknown error";
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try { return JSON.stringify(error); } catch { return String(error); }
};

const _safeUrl = (value) => {
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "[invalid-url]";
  }
};

const _toBool = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
};

// The Browserless endpoint is an admin-supplied setting that this transport then
// fetches. TransportContext.fetch applies no host allowlist, so an unvalidated
// value would let anyone holding the settings password aim the server at
// internal services, including link-local metadata at 169.254.169.254.
const _BLOCKED_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "::1",
  "::",
  "metadata.google.internal",
  "instance-data",
]);

const _isPrivateHost = (hostname) => {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, "");

  if (_BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;

  return false;
};

const _assertSafeEndpoint = (raw) => {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Browserless URL is not a valid absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Browserless URL must use http or https");
  }

  if (!parsed.hostname || _isPrivateHost(parsed.hostname)) {
    throw new Error(
      "Browserless URL must be a public host, not localhost or a private address",
    );
  }

  return parsed;
};

export default class BrowserlessBQLTransport {
  isClientExposed = false;
  name = "browserless-ql";
  displayName = "Browserless QL";

  description =
    "Fetches pages through Browserless Stealth BrowserQL and returns rendered HTML.";

  _token = "";
  settingsSchema = [
    {
      key: "token",
      label: "API Token",
      type: "password",
      secret: true,
      placeholder: "BROWSERLESS_TOKEN",
      description:
        "Leave empty to use the BROWSERLESS_TOKEN environment variable.",
    },
    {
      key: "url",
      label: "Browserless URL",
      type: "url",
      required: true,
      placeholder: "https://production-sfo.browserless.io",
      description: "Base Browserless Cloud URL. Do not include /stealth/bql.",
    },
    {
      key: "solveCaptchas",
      label: "Solve CAPTCHAs",
      type: "toggle",
      default: "false",
      description: "Run BrowserQL CAPTCHA detection and solving.",
    },
    {
      key: "humanlike",
      label: "Human-like behavior",
      type: "toggle",
      default: "false",
      description: "Enable BrowserQL human-like behavior.",
    },
    {
      key: "blockAds",
      label: "Block ads",
      type: "toggle",
      default: "false",
      description: "Enable Browserless ad blocking.",
    },
    {
      key: "blockConsentModals",
      label: "Block consent modals",
      type: "toggle",
      default: "false",
      description: "Automatically block or dismiss cookie/GDPR consent banners.",
    },
    {
      key: "proxy",
      label: "Proxy",
      type: "select",
      options: ["none", "datacenter", "residential"],
      default: "none",
      description: "Optional Browserless built-in proxy.",
    },
    {
      key: "proxySticky",
      label: "Sticky proxy",
      type: "toggle",
      default: "true",
      description: "Keep the same built-in proxy IP during the BrowserQL session.",
    },
    {
      key: "proxyCountry",
      label: "Proxy country",
      type: "text",
      placeholder: "us",
      description: "Optional ISO 3166 country code for the built-in proxy.",
    },
    {
      key: "proxyLocaleMatch",
      label: "Match proxy locale",
      type: "toggle",
      default: "false",
      description: "Match browser locale settings to the selected proxy location.",
    },
    {
      key: "timeout",
      label: "Timeout (ms)",
      type: "number",
      placeholder: "60000",
      description: "Maximum BrowserQL session duration.",
    },
    {
      key: "waitUntil",
      label: "Wait until",
      type: "select",
      options: ["load", "domcontentloaded", "networkidle"],
      default: "networkidle",
      description: "When navigation is considered complete.",
    },
    {
      key: "waitAfterSolveMs",
      label: "Wait after solve (ms)",
      type: "number",
      placeholder: "5000",
      description: "How long to wait after CAPTCHA solving before extracting HTML.",
    },
  ];

  _url = "";
  _solveCaptchas = false;
  _humanlike = false;
  _blockAds = false;
  _blockConsentModals = false;
  _proxy = "none";
  _proxySticky = true;
  _proxyCountry = "";
  _proxyLocaleMatch = false;
  _timeoutMs = 60000;
  _waitUntil = "networkidle";
  _waitAfterSolveMs = 5000;

  configure(settings = {}) {
    this._token = (settings.token || "").trim();
    const rawUrl = (settings.url || "").replace(/\/+$/, "").trim();
    if (rawUrl) {
      try {
        _assertSafeEndpoint(rawUrl);
      } catch (error) {
        console.error(`[browserless-ql] rejected url: ${error.message}`);
        this._url = "";
        return;
      }
    }
    this._url = rawUrl;

    this._solveCaptchas = _toBool(settings.solveCaptchas);
    this._humanlike = _toBool(settings.humanlike);
    this._blockAds = _toBool(settings.blockAds);
    this._blockConsentModals = _toBool(settings.blockConsentModals);

    this._proxy =
      settings.proxy === "datacenter" || settings.proxy === "residential"
        ? settings.proxy
        : "none";

    this._proxySticky = _toBool(settings.proxySticky, true);
    this._proxyCountry = (settings.proxyCountry || "").trim().toLowerCase();
    this._proxyLocaleMatch = _toBool(settings.proxyLocaleMatch);

    this._timeoutMs = Math.max(3000, Math.min(60000, Number(settings.timeout) || 60000));

    if (Object.prototype.hasOwnProperty.call(_WAIT_UNTIL_MAP, settings.waitUntil)) {
      this._waitUntil = settings.waitUntil;
    }

    this._waitAfterSolveMs = Math.max(0, Math.min(30000, Number(settings.waitAfterSolveMs) || 5000));

    console.log(
      `[browserless-ql] configure url=${_safeUrl(this._url)} proxy=${this._proxy} waitUntil=${this._waitUntil}`,
    );
  }

  available() {
    const token = (this._token || process.env.BROWSERLESS_TOKEN?.trim() || "");
    return this._url.length > 0 && token.length > 0;
  }

  _buildEndpoint() {
    let endpoint;
    try {
      endpoint = new URL(`${this._url}/stealth/bql`);
      _assertSafeEndpoint(endpoint.href);
    } catch (error) {
      console.error(`[browserless-ql] blocked unsafe endpoint: ${error.message}`);
      return new Response("", { status: 400 });
    }
    const token = (this._token || process.env.BROWSERLESS_TOKEN?.trim() || "");
    if (token) endpoint.searchParams.set("token", token);

    endpoint.searchParams.set("timeout", String(this._timeoutMs));
    if (this._humanlike) endpoint.searchParams.set("humanlike", "true");
    if (this._blockAds) endpoint.searchParams.set("blockAds", "true");
    if (this._blockConsentModals) endpoint.searchParams.set("blockConsentModals", "true");

    if (this._proxy !== "none") {
      endpoint.searchParams.set("proxy", this._proxy);
      endpoint.searchParams.set("proxySticky", this._proxySticky ? "true" : "false");
      if (this._proxyCountry) endpoint.searchParams.set("proxyCountry", this._proxyCountry);
      if (this._proxyLocaleMatch) endpoint.searchParams.set("proxyLocaleMatch", "true");
    }

    return endpoint;
  }

  _buildQuery(url) {
    const waitUntil = _WAIT_UNTIL_MAP[this._waitUntil] || "networkIdle";

    const solveBlock = this._solveCaptchas
      ? `
  solve {
    found
    solved
    time
  }

  waitForTimeout(time: ${this._waitAfterSolveMs}) {
    time
  }
`
      : "";

    return `
mutation DegoogFetch {
  goto(
    url: ${JSON.stringify(url)}
    waitUntil: ${waitUntil}
  ) {
    status
    time
  }

  ${solveBlock}

  html {
    html
  }
}
`;
  }

  async fetch(url, options, context) {
    if (!this._url) return new Response("Browserless URL not configured", { status: 503 });
    const token = (this._token || process.env.BROWSERLESS_TOKEN?.trim() || "");
    if (!token) return new Response("BROWSERLESS_TOKEN not configured", { status: 401 });

    const endpoint = this._buildEndpoint();
    console.log(`[browserless-ql] start ${_safeUrl(url)}`);

    const query = this._buildQuery(url);
    const doFetch = context?.fetch;

    if (typeof doFetch !== "function") {
      return new Response("Browserless BQL transport: context.fetch unavailable", { status: 503 });
    }

    let response;
    try {
      response = await doFetch(endpoint.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables: {}, operationName: "DegoogFetch" }),
        signal: options?.signal,
      });
    } catch (error) {
      console.error(`[browserless-ql] request error: ${_safeError(error)}`);
      return new Response("", { status: 503 });
    }

    console.log(`[browserless-ql] status=${response.status}`);

    let raw;
    try {
      raw = await response.text();
    } catch (error) {
      console.error(`[browserless-ql] read error: ${_safeError(error)}`);
      return new Response("", { status: 502 });
    }

    if (!response.ok) return new Response("", { status: response.status });

    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      console.error("[browserless-ql] JSON parse error");
      return new Response("", { status: 502 });
    }

    const html = typeof data?.data?.html?.html === "string" ? data.data.html.html : "";
    if (!html) return new Response("", { status: 502 });

    const normalized = _normalizeHtml(html);
    return new Response(normalized, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}