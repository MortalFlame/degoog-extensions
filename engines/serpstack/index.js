const BASE_URL = "https://api.serpstack.com/search";

const REGIONS = {
  UAE: {
    label: "United Arab Emirates",
    gl: "ae",
    google_domain: "google.ae",
  },
  UK: {
    label: "United Kingdom",
    gl: "gb",
    google_domain: "google.co.uk",
  },
  KSA: {
    label: "Saudi Arabia",
    gl: "sa",
    google_domain: "google.com.sa",
  },
  US: {
    label: "United States",
    gl: "us",
    google_domain: "google.com",
  },
  CAN: {
    label: "Canada",
    gl: "ca",
    google_domain: "google.ca",
  },
  AUS: {
    label: "Australia",
    gl: "au",
    google_domain: "google.com.au",
  },
};

const TIME_MAP = {
  hour: "last_hour",
  day: "last_day",
  week: "last_week",
  month: "last_month",
  year: "last_year",
};

export default class SerpstackEngine {
  isClientExposed = false;
  name = "Serpstack";
  bangShortcut = "serpstack";

  region = "UAE";
  safeSearch = false;

  _apiKey = "";
  settingsSchema = [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      secret: true,
      placeholder: "SERPSTACK_API_KEY",
      description:
        "Leave empty to use the SERPSTACK_API_KEY environment variable.",
    },
    {
      key: "region",
      label: "Region",
      type: "select",
      default: "UAE",
      options: ["UAE", "UK", "KSA", "US", "CAN", "AUS"],
      description: "Country used for Google search results.",
    },
    {
      key: "safeSearch",
      label: "Safe Search",
      type: "toggle",
      default: "false",
      description: "Filter explicit content from Google search results.",
    },
  ];

  configure(settings = {}) {
    this._apiKey = (settings.apiKey || "").trim();
    if (
      typeof settings.region === "string" &&
      REGIONS[settings.region]
    ) {
      this.region = settings.region;
    }
    this.safeSearch =
      settings.safeSearch === true ||
      settings.safeSearch === "true";
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

  async executeSearch(query, page = 1, timeFilter, context) {
    const apiKey =
      (this._apiKey || process.env.SERPSTACK_API_KEY?.trim() || "");
    if (!apiKey) {
      throw this._error(
        context,
        "configuration_error",
        "SERPSTACK_API_KEY is not configured.",
      );
    }

    const region = REGIONS[this.region] || REGIONS.UAE;

    const params = new URLSearchParams({
      access_key: apiKey,
      query,
      auto_location: "0",
      device: "desktop",
      engine: "google",
      type: "web",
      gl: region.gl,
      google_domain: region.google_domain,
      hl: "en",
      page: String(Math.max(1, page)),
      output: "json",
    });

    if (this.safeSearch) {
      params.set("safe", "1");
    }

    if (
      timeFilter &&
      timeFilter !== "any" &&
      timeFilter !== "custom"
    ) {
      const period = TIME_MAP[timeFilter];
      if (!period) {
        throw this._error(
          context,
          "configuration_error",
          `SerpStack cannot honour the "${timeFilter}" time filter`,
        );
      }
      params.set("period", period);
    }

    const url = `${BASE_URL}?${params.toString()}`;
    const doFetch = context?.fetch ?? fetch;

    let response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw this._error(
        context,
        "request_error",
        `Serpstack request failed: ${message}`,
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
        `Serpstack returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (
      data?.request?.success === false ||
      data?.success === false
    ) {
      const message =
        data?.error?.info ||
        data?.error?.message ||
        data?.error?.type ||
        "Serpstack returned an API error.";
      throw this._error(context, "request_error", message);
    }

    if (!response.ok) {
      const message =
        data?.error?.info ||
        data?.error?.message ||
        data?.message ||
        `Serpstack returned HTTP ${response.status}`;
      throw this._error(context, "request_error", message);
    }

    if (!Array.isArray(data?.organic_results)) {
      throw this._error(
        context,
        "parse_error",
        "SerpStack response contained no organic_results array",
      );
    }
    const organicResults = data.organic_results;

    const results = [];

    for (const item of organicResults) {
      const url =
        typeof item?.url === "string" ? item.url.trim() : "";
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

    console.log(
      `[serpstack] ${results.length} organic results (page ${page}, region ${this.region})`,
    );

    return results;
  }
}
