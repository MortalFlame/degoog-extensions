const BASE_URL = "https://api.tavily.com/search";
const MAX_SNIPPET_LENGTH = 300;

export default class TavilyEngine {
  isClientExposed = false;
  name = "Tavily";
  bangShortcut = "tavily";

  searchDepth = "basic";

  settingsSchema = [
    {
      key: "searchDepth",
      label: "Search Depth",
      type: "select",
      default: "basic",
      options: ["basic", "advanced"],
      description:
        "Basic is tuned for short, focused lookups and covers less ground for a lower latency budget. Advanced searches more broadly, reaches more sources, and delivers the highest relevance at higher latency – ideal for niche topics, very recent pages, or multi-faceted questions. Both depths return chunks; chunks_per_source controls how many come back per source.",
    }
  ];

  configure(settings = {}) {
    this.searchDepth =
      settings.searchDepth === "advanced"
        ? "advanced"
        : "basic";
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

  /**
   * Light Markdown / formatting cleaner.
   * Removes common symbols while keeping the text readable.
   */
  _cleanSnippet(text) {
    if (typeof text !== "string") return "";

    let cleaned = text;

    // Remove fenced code blocks entirely
    cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");

    // Remove inline code
    cleaned = cleaned.replace(/`([^`]*)`/g, "$1");

    // Remove HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, " ");

    // Remove Markdown images: ![alt](url)
    cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

    // Remove Markdown links: [text](url) – keep the text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

    // Remove headings: #, ##, ###, etc.
    cleaned = cleaned.replace(/^\s{0,3}#{1,6}\s+/gm, "");

    // Remove any remaining # symbols
    cleaned = cleaned.replace(/#/g, " ");

    // Convert table rows: split cells and join with spaces
    cleaned = cleaned.replace(/^\s*\|(.+)\|\s*$/gm, (row) => {
      return row
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(" ");
    });

    // Remove any remaining pipes
    cleaned = cleaned.replace(/\|/g, " ");

    // Remove list markers at line starts
    cleaned = cleaned.replace(/^\s*[-*+]\s+/gm, "");

    // Remove horizontal rules
    cleaned = cleaned.replace(/^\s*[-*_]{3,}\s*$/gm, "");

    // Remove blockquote markers
    cleaned = cleaned.replace(/^\s*>\s?/gm, "");

    // Collapse all whitespace
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    return cleaned;
  }

  _truncateSnippet(text) {
    if (!text) return "";
    if (text.length <= MAX_SNIPPET_LENGTH) return text;

    const shortened = text.slice(0, MAX_SNIPPET_LENGTH);
    const lastSentence = Math.max(
      shortened.lastIndexOf(". "),
      shortened.lastIndexOf("! "),
      shortened.lastIndexOf("? "),
    );

    if (lastSentence >= MAX_SNIPPET_LENGTH * 0.6) {
      return shortened.slice(0, lastSentence + 1);
    }

    return `${shortened.trim()}…`;
  }

  async executeSearch(
    query,
    page = 1,
    timeFilter,
    context,
  ) {
    if (page > 1) {
      return [];
    }

    const apiKey =
      process.env.TAVILY_API_KEY?.trim() || "";

    if (!apiKey) {
      throw this._error(
        context,
        "configuration_error",
        "TAVILY_API_KEY is not configured.",
      );
    }

    const doFetch = context?.fetch ?? fetch;

    const body = {
      query,
      search_depth: this.searchDepth,
      max_results: 10,
      chunks_per_source: this.searchDepth === "advanced" ? 3 : 1,
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

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
        `Tavily request failed: ${message}`,
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
        `Tavily returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      const message =
        data?.detail ||
        data?.error ||
        data?.message ||
        `Tavily returned HTTP ${response.status}`;

      throw this._error(
        context,
        "request_error",
        message,
      );
    }

    if (!Array.isArray(data?.results)) {
      throw this._error(
        context,
        "parse_error",
        "Tavily response contained no results array",
      );
    }
    const webResults = data.results;

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

      // Prefer chunks; fallback to content
      let rawSnippet = "";
      if (Array.isArray(item?.chunks) && item.chunks.length > 0) {
        rawSnippet = item.chunks[0];
      } else if (typeof item?.content === "string") {
        rawSnippet = item.content;
      }

      // Clean and truncate
      const snippet = this._truncateSnippet(
        this._cleanSnippet(rawSnippet),
      );

      if (!url || !title || !snippet) {
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
