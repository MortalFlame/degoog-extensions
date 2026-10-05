const BASE_URL = "https://api.serpingapi.com/v1/search";

const TIME_MAP = {
  hour: "qdr:h",
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

const REGION_GL_MAP = {
  "UAE": "ae",
  "UK": "gb",
  "KSA": "sa",
  "US": "us",
  "CAN": "ca",
  "AUS": "au",
};

export default class SerpingApiEngine {
  isClientExposed = false;
  name = "Serping API";
  bangShortcut = "serping";

  gl = "ae";

  _apiKey = "";
  settingsSchema = [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      secret: true,
      placeholder: "SERPING_API_KEY",
      description:
        "Leave empty to use the SERPING_API_KEY environment variable.",
    },
    {
      key: "region",
      label: "Region",
      type: "select",
      default: "UAE",
      options: ["UAE", "UK", "KSA", "US", "CAN", "AUS"],
      description: "Select the Google country region for search results.",
    }
  ];

  configure(settings = {}) {
    this._apiKey = (settings.apiKey || "").trim();
    const region = settings.region || "UAE";
    this.gl = REGION_GL_MAP[region] || "ae";
  }

  _error(context, status, message) {
    if (context?.engineError) {
      return context.engineError(
        status,
        message,
        { engine: this.name },
      );
    }
    return new Error(message);
  }

  async _request(url, options = {}, context) {
    const apiKey =
      (this._apiKey || process.env.SERPING_API_KEY?.trim() || "");
    if (!apiKey) {
      throw this._error(
        context,
        "configuration_error",
        "SERPING_API_KEY is not configured.",
      );
    }

    const doFetch = context?.fetch ?? fetch;

    let response;
    try {
      response = await doFetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body
            ? { "Content-Type": "application/json" }
            : {}),
          "X-API-Key": apiKey,
          ...(options.headers ?? {}),
        },
        signal: options.signal,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw this._error(
        context,
        "request_error",
        `Serping API request failed: ${message}`,
      );
    }

    context?.sentinel?.(response, this.name);

    let data;
    try {
      data = await response.json();
    } catch {
      throw this._error(
        context,
        "parse_error",
        `Serping API returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      const errorCode =
        typeof data?.error?.code === "string"
          ? data.error.code
          : "";
      const message =
        typeof data?.error?.message === "string"
          ? data.error.message
          : typeof data?.error === "string"
            ? data.error
            : typeof data?.message === "string"
              ? data.message
              : `Serping API returned HTTP ${response.status}`;

      let status = "request_error";
      if (
        response.status === 401 ||
        errorCode === "invalid_api_key" ||
        errorCode === "missing_api_key"
      ) {
        status = "authentication_error";
      } else if (
        response.status === 429 ||
        errorCode === "quota_exceeded"
      ) {
        status = "quota_exceeded";
      } else if (
        response.status === 502 ||
        errorCode === "upstream_error"
      ) {
        status = "upstream_error";
      }

      throw this._error(context, status, message);
    }

    return data;
  }

  async executeSearch(
    query,
    page = 1,
    timeFilter,
    context,
  ) {
    const body = {
      q: query,
      num: 10,
      page: Math.max(1, Number(page) || 1),
      autocorrect: true,
      gl: this.gl,
      hl: "en",
      // Language remains hardcoded to English.
    };

    if (
      timeFilter &&
      timeFilter !== "any" &&
      timeFilter !== "custom" &&
      TIME_MAP[timeFilter]
    ) {
      body.tbs = TIME_MAP[timeFilter];
    }

    const data = await this._request(
      BASE_URL,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      context,
    );

    if (!Array.isArray(data?.organic)) {
      throw this._error(
        context,
        "parse_error",
        "SerpApi response contained no organic array",
      );
    }
    const organic = data.organic;
    const results = [];

    for (const item of organic) {
      const url =
        typeof item?.link === "string" ? item.link.trim() : "";
      const title =
        typeof item?.title === "string" ? item.title.trim() : "";
      const snippet =
        typeof item?.snippet === "string" ? item.snippet.trim() : "";

      if (!url || !title) continue;
      if (!/^https?:\/\//i.test(url)) continue;

      results.push({
        title,
        url,
        snippet,
        source: this.name,
      });
    }

    return results;
  }
}