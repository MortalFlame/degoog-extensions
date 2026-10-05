const VALID_WAIT_UNTIL = ["load", "domcontentloaded", "networkidle"];

const WORKER_URL = process.env.CLOAKBROWSER_VERCEL_URL?.trim().replace(/\/+$/, "") || "";
const WORKER_TOKEN = process.env.CLOAKBROWSER_VERCEL_TOKEN?.trim() || "";
const BYPASS_SECRET = process.env.VERCEL_BYPASS_SECRET?.trim() || "";

export default class CloakBrowserVercelTransport {
  isClientExposed = false;
  name = "cloakbrowser-vercel";
  displayName = "CloakBrowser Vercel";
  description =
    "Fetches pages through a Vercel-hosted CloakBrowser worker. Configure CLOAKBROWSER_VERCEL_URL and CLOAKBROWSER_VERCEL_TOKEN in environment variables.";

  settingsSchema = [
    {
      key: "bypassProxy",
      label: "Bypass DeGoog proxy",
      type: "toggle",
      default: "true",
      description:
        "Connect directly to the Vercel worker using the global fetch, bypassing any DeGoog outgoing proxy. Enable this if your firewall rules are IP-based and you don't want the proxy IP to be used.",
    },
    {
      key: "waitUntil",
      label: "Wait Until",
      type: "select",
      options: ["load", "domcontentloaded", "networkidle"],
      default: "domcontentloaded",
      description: "Navigation completion strategy. Use domcontentloaded for most engines.",
    },
    {
      key: "timeout",
      label: "Timeout (ms)",
      type: "number",
      placeholder: "30000",
      description: "Maximum time to wait for the worker response (3000–60000 ms).",
    },
    {
      key: "extraWaitMs",
      label: "Extra Wait (ms)",
      type: "number",
      placeholder: "1500",
      description:
        "Additional wait after navigation, useful for challenge pages. Set 8000–15000 for Startpage.",
    },
  ];

  _bypassProxy = true;
  _waitUntil = "domcontentloaded";
  _timeoutMs = 30000;
  _extraWaitMs = 1500;

  configure(settings = {}) {
    this._bypassProxy = settings.bypassProxy !== "false";
    this._waitUntil = VALID_WAIT_UNTIL.includes(settings.waitUntil)
      ? settings.waitUntil
      : "domcontentloaded";
    this._timeoutMs = Math.max(3000, Math.min(60000, Number(settings.timeout) || 30000));
    this._extraWaitMs = Math.max(0, Math.min(15000, Number(settings.extraWaitMs) || 1500));
  }

  available() {
    return WORKER_URL.length > 0 && WORKER_TOKEN.length > 0;
  }

  async fetch(url, options, context) {
    if (!WORKER_URL || !WORKER_TOKEN) {
      return new Response("CloakBrowser Vercel transport not configured", { status: 503 });
    }

    // Bypass DeGoog proxy if enabled – use global fetch directly
    const doFetch = this._bypassProxy ? fetch : (context?.fetch ?? fetch);

    let response;
    try {
      response = await doFetch(WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-browser-token": WORKER_TOKEN,
          ...(BYPASS_SECRET ? { "x-vercel-protection-bypass": BYPASS_SECRET } : {}),
        },
        body: JSON.stringify({
          url,
          timeout: this._timeoutMs,
          waitUntil: this._waitUntil,
          extraWaitMs: this._extraWaitMs,
          includeHtml: true,
        }),
        signal: options?.signal,
      });
    } catch (error) {
      console.error(`[cloakbrowser-vercel] request error: ${error.message}`);
      return new Response("", { status: 503 });
    }

    if (!response.ok) {
      return new Response("", { status: response.status });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return new Response("", { status: 502 });
    }

    if (!data || !data.ok || typeof data.html !== "string") {
      return new Response("", { status: 502 });
    }

    if (data.challenge) {
      console.warn(`[cloakbrowser-vercel] challenge: ${data.challenge}`);
    }

    return new Response(data.html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
