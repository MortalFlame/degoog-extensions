const _safeError = (error) => {
  if (!error) return "unknown error";
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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

export default class ScrapeDoTransport {
  isClientExposed = false;
  name = "scrape-do";
  displayName = "Scrape.do";
  description =
    "Fetches pages through Scrape.do using a datacenter proxy, headless browser, residential/mobile proxy, or both.";

  settingsSchema = [
    {
      key: "mode",
      label: "Mode",
      type: "select",
      options: ["normal", "render", "super", "super_render"],
      default: "render",
      description:
        "Normal = datacenter proxy (1 credit). Render = datacenter + headless browser (5 credits). Super = residential/mobile proxy (10 credits). Super + Render = residential/mobile + headless browser (25 credits).",
    },
    {
      key: "waitUntil",
      label: "Wait Until",
      type: "select",
      options: ["load", "domcontentloaded", "networkidle0"],
      default: "networkidle0",
      description:
        "Controls when a rendered page is considered ready. Network idle is recommended for search engines.",
    },
    {
      key: "timeout",
      label: "Timeout (ms)",
      type: "number",
      placeholder: "60000",
      description:
        "Maximum time Scrape.do should spend processing the request.",
    },
  ];

  _mode = "render";
  _waitUntil = "networkidle0";
  _timeoutMs = 60000;

  configure(settings = {}) {
    const validModes = ["normal", "render", "super", "super_render"];
    this._mode = validModes.includes(settings.mode)
      ? settings.mode
      : "render";

    const validWaitUntil = ["load", "domcontentloaded", "networkidle0"];
    this._waitUntil = validWaitUntil.includes(settings.waitUntil)
      ? settings.waitUntil
      : "networkidle0";

    this._timeoutMs = Math.max(
      3000,
      Math.min(120000, Number(settings.timeout) || 60000),
    );

    console.log(
      `[scrape-do] configure mode=${this._mode} waitUntil=${this._waitUntil} timeout=${this._timeoutMs}`,
    );
  }

  available() {
    const token = process.env.SCRAPE_DO_TOKEN?.trim() || "";
    return token.length > 0;
  }

  _buildEndpoint(url) {
    const token = process.env.SCRAPE_DO_TOKEN?.trim() || "";
    const endpoint = new URL("https://api.scrape.do/");

    endpoint.searchParams.set("token", token);
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("timeout", String(this._timeoutMs));

    // Always send transparentResponse=true
    endpoint.searchParams.set("transparentResponse", "true");

    if (this._mode === "render" || this._mode === "super_render") {
      endpoint.searchParams.set("render", "true");
      endpoint.searchParams.set("waitUntil", this._waitUntil);
    }

    if (this._mode === "super" || this._mode === "super_render") {
      endpoint.searchParams.set("super", "true");
    }

    return endpoint;
  }

  async fetch(url, options, context) {
    const token = process.env.SCRAPE_DO_TOKEN?.trim() || "";
    if (!token) {
      return new Response("SCRAPE_DO_TOKEN not configured", { status: 401 });
    }

    let endpoint;
    try {
      endpoint = this._buildEndpoint(url);
    } catch (error) {
      console.error(`[scrape-do] URL error: ${_safeError(error)}`);
      return new Response("", { status: 400 });
    }

    console.log(`[scrape-do] start ${_safeUrl(url)} mode=${this._mode}`);

    const doFetch = context?.fetch ?? fetch;
    if (typeof doFetch !== "function") {
      return new Response("Scrape.do transport: fetch unavailable", { status: 503 });
    }

    let response;
    try {
      response = await doFetch(endpoint.toString(), {
        method: "GET",
        headers: {
          Accept: "*/*",
        },
        signal: options?.signal,
      });
    } catch (error) {
      console.error(`[scrape-do] request error: ${_safeError(error)}`);
      return new Response("", { status: 503 });
    }

    console.log(`[scrape-do] status=${response.status}`);

    if (!response.ok) {
      return new Response("", { status: response.status });
    }

    let html;
    try {
      html = await response.text();
    } catch (error) {
      console.error(`[scrape-do] read error: ${_safeError(error)}`);
      return new Response("", { status: 502 });
    }

    if (!html) {
      return new Response("", { status: 502 });
    }

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "text/html; charset=utf-8",
      },
    });
  }
}