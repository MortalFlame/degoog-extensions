const VALID_WAIT_UNTIL = ["load", "domcontentloaded", "networkidle"];

const ENV_WORKER_URL = process.env.CLOAKBROWSER_VERCEL_URL?.trim().replace(/\/+$/, "") || "";
const ENV_WORKER_TOKEN = process.env.CLOAKBROWSER_VERCEL_TOKEN?.trim() || "";
const BYPASS_SECRET = process.env.VERCEL_BYPASS_SECRET?.trim() || "";

export default class CloakBrowserVercelTransport {
  isClientExposed = false;
  name = "cloakbrowser-vercel";
  displayName = "CloakBrowser Vercel";
  description =
    "Fetches pages through a Vercel-hosted CloakBrowser worker. Configure CLOAKBROWSER_VERCEL_URL and CLOAKBROWSER_VERCEL_TOKEN in environment variables.";

  _workerToken = "";
  _workerUrl = "";

  settingsSchema = [
    {
      key: "workerToken",
      label: "Worker Token",
      type: "password",
      secret: true,
      placeholder: "CLOAKBROWSER_VERCEL_TOKEN",
      description:
        "Leave empty to use the CLOAKBROWSER_VERCEL_TOKEN environment variable.",
    },
    {
      key: "workerUrl",
      label: "Worker URL",
      type: "url",
      secret: true,
      placeholder: "CLOAKBROWSER_VERCEL_URL",
      description:
        "Leave empty to use the CLOAKBROWSER_VERCEL_URL environment variable.",
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

  _waitUntil = "domcontentloaded";
  _timeoutMs = 30000;
  _extraWaitMs = 1500;

  configure(settings = {}) {
    this._workerToken = (settings.workerToken || "").trim();
    this._workerUrl = (settings.workerUrl || "").trim().replace(/\/+$/, "");
    this._waitUntil = VALID_WAIT_UNTIL.includes(settings.waitUntil)
      ? settings.waitUntil
      : "domcontentloaded";
    this._timeoutMs = Math.max(3000, Math.min(60000, Number(settings.timeout) || 30000));
    this._extraWaitMs = Math.max(0, Math.min(15000, Number(settings.extraWaitMs) || 1500));
  }

  available() {
    const workerUrl = this._workerUrl || ENV_WORKER_URL;
    const workerToken = this._workerToken || ENV_WORKER_TOKEN;

    return workerUrl.length > 0 && workerToken.length > 0;
  }

  async fetch(url, options, context) {
    const workerUrl = this._workerUrl || ENV_WORKER_URL;
    const workerToken = this._workerToken || ENV_WORKER_TOKEN;

    if (!workerUrl || !workerToken) {
      return new Response("CloakBrowser Vercel transport not configured", { status: 503 });
    }

    // Always go through context.fetch so the instance's outgoing proxy settings
    // apply. With no proxy configured this is an ordinary fetch, so removing the
    // old bypassProxy toggle costs nothing and stops this transport silently
    // ignoring proxy configuration.
    const doFetch = context?.fetch ?? fetch;

    let response;
    try {
      response = await doFetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-browser-token": workerToken,
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
