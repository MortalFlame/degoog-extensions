const BASE_URL = "https://api.firecrawl.dev/v2/search";

const TIME_MAP = {
  hour: "qdr:h",
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

export default class FirecrawlEngine {
  isClientExposed = false;
  name = "Firecrawl";
  bangShortcut = "firecrawl";

  safeSearch = false;

  settingsSchema = [
    {
      key: "safeSearch",
      label: "Safe Search",
      type: "toggle",
      default: "false",
      description: "Filter explicit content from search results.",
    },
  ];

  configure(settings = {}) {
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

  async executeSearch(
    query,
    page = 1,
    timeFilter,
    context,
  ) {
    /*
     * Firecrawl Search does not expose the same
     * page/offset model as Brave or Startpage.
     *
     * We intentionally only return the first 10
     * results to keep usage at 2 credits/search.
     */
    if (page > 1) {
      return [];
    }

    const apiKey =
      process.env.FIRECRAWL_API_KEY?.trim() || "";

    const doFetch =
      context?.fetch ?? fetch;

    const body = {
      query,
      limit: 10,
      sources: ["web"],
      highlights: false,
      timeout: 8000,
    };

    /*
     * Firecrawl Search SafeSearch:
     * omitted = unfiltered
     * true   = filtered
     */
    if (this.safeSearch) {
      body.safe = true;
    }

    /*
     * Firecrawl documents tbs for web searches.
     */
    if (
      timeFilter &&
      timeFilter !== "any" &&
      timeFilter !== "custom" &&
      TIME_MAP[timeFilter]
    ) {
      body.tbs = TIME_MAP[timeFilter];
    }

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    /*
     * Firecrawl currently supports keyless use.
     * If a key is configured, use it for the
     * authenticated/higher-limit path.
     */
    if (apiKey) {
      headers.Authorization =
        `Bearer ${apiKey}`;
    }

    let response;

    try {
      response = await doFetch(
        BASE_URL,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      throw this._error(
        context,
        "request_error",
        `Firecrawl request failed: ${message}`,
      );
    }

    context?.sentinel?.(
      response,
      this.name,
    );

    let data;

    try {
      data = await response.json();
    } catch {
      throw this._error(
        context,
        "parse_error",
        `Firecrawl returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (data?.warning) {
      console.warn(
        `[firecrawl] warning: ${data.warning}`,
      );
    }

    if (
      !response.ok ||
      data?.success === false
    ) {
      const message =
        data?.error ||
        data?.message ||
        `Firecrawl returned HTTP ${response.status}`;

      throw this._error(
        context,
        "request_error",
        message,
      );
    }

    if (!Array.isArray(data?.data?.web)) {
      throw this._error(
        context,
        "parse_error",
        "Firecrawl response contained no web results array",
      );
    }
    const webResults = data.data.web;

    const results = [];

    for (const item of webResults) {
      const url =
        typeof item?.url === "string"
          ? item.url.trim()
          : "";

      const title =
        typeof item?.title === "string"
          ? item.title.trim()
          : "";

      const snippet =
        typeof item?.description === "string"
          ? item.description.trim()
          : "";

      if (!url || !title) {
        continue;
      }

      if (!/^https?:\/\//i.test(url)) {
        continue;
      }

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
