export const type = "papers";

const BASE_URL = "https://api.openalex.org/works";
const DEFAULT_LIMIT = 20;
const MAX_SNIPPET_LENGTH = 600;

export default class OpenAlexEngine {
  isClientExposed = false;
  name = "OpenAlex";
  bangShortcut = "openalex";

  settingsSchema = [];

  _error(context, type, message) {
    console.error(`[openalex] ERROR (${type}): ${message}`);
    if (context?.engineError) {
      return context.engineError(type, message, {
        engine: this.name,
      });
    }
    return new Error(message);
  }

  _normaliseDate(value) {
    if (typeof value !== "string") return "";
    const date = value.trim();
    if (!date) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const match = date.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] || "";
  }

  _truncateText(value) {
    if (typeof value !== "string") return "";
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (text.length <= MAX_SNIPPET_LENGTH) return text;
    return text.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd() + "…";
  }

  _parseQuery(query) {
    let remaining = query.trim();
    const authors = [];
    const categories = [];
    let from = "";
    let to = "";

    remaining = remaining.replace(
      /(?:^|\s)author\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/gi,
      (_match, doubleQuoted, singleQuoted, unquoted) => {
        const author = (
          doubleQuoted || singleQuoted || unquoted || ""
        ).trim();
        if (author) authors.push(author);
        return " ";
      },
    );

    remaining = remaining.replace(
      /(?:^|\s)category\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/gi,
      (_match, doubleQuoted, singleQuoted, unquoted) => {
        const category = (
          doubleQuoted || singleQuoted || unquoted || ""
        ).trim();
        if (category) categories.push(category);
        return " ";
      },
    );

    const yearRangeMatch = remaining.match(
      /(?:^|\s)year\s*:\s*(19\d{2}|20\d{2})\s*-\s*(19\d{2}|20\d{2})(?=\s|$)/i,
    );
    if (yearRangeMatch) {
      const startYear = Number(yearRangeMatch[1]);
      const endYear = Number(yearRangeMatch[2]);
      if (startYear <= endYear) {
        from = `${startYear}-01-01`;
        to = `${endYear}-12-31`;
        remaining = remaining.replace(yearRangeMatch[0], " ");
      }
    } else {
      const yearMatch = remaining.match(
        /(?:^|\s)year\s*:\s*(19\d{2}|20\d{2})(?=\s|$)/i,
      );
      if (yearMatch) {
        const year = Number(yearMatch[1]);
        from = `${year}-01-01`;
        to = `${year}-12-31`;
        remaining = remaining.replace(yearMatch[0], " ");
      }
    }

    const cleanQuery = remaining.replace(/\s+/g, " ").trim();
    return {
      query: cleanQuery || query.trim(),
      authors,
      categories,
      from,
      to,
    };
  }

  _resolveDateRange(timeFilter, context, parsed) {
    if (timeFilter === "custom") {
      return {
        from: this._normaliseDate(context?.dateFrom),
        to: this._normaliseDate(context?.dateTo),
      };
    }
    return { from: parsed.from, to: parsed.to };
  }

  _resolvePaperUrl(work) {
    const bestOaUrl =
      typeof work?.best_oa_location?.landing_page_url === "string"
        ? work.best_oa_location.landing_page_url.trim()
        : "";
    if (/^https?:\/\//i.test(bestOaUrl)) return bestOaUrl;

    const primaryUrl =
      typeof work?.primary_location?.landing_page_url === "string"
        ? work.primary_location.landing_page_url.trim()
        : "";
    if (/^https?:\/\//i.test(primaryUrl)) return primaryUrl;

    const doi =
      typeof work?.doi === "string" ? work.doi.trim() : "";
    if (doi) {
      if (/^https?:\/\//i.test(doi)) return doi;
      return `https://doi.org/${doi.replace(/^doi:/i, "")}`;
    }

    const openAlexId =
      typeof work?.id === "string" ? work.id.trim() : "";
    if (/^https?:\/\//i.test(openAlexId)) return openAlexId;

    return "";
  }

  _getCanonicalId(work) {
    const doi =
      typeof work?.doi === "string"
        ? work.doi.trim().toLowerCase().replace(/^doi:/i, "")
        : "";
    if (doi) return `doi:${doi}`;

    const openAlexId =
      typeof work?.id === "string"
        ? work.id.trim().toLowerCase()
        : "";
    if (openAlexId) return `openalex:${openAlexId}`;

    const title =
      typeof work?.title === "string"
        ? work.title.trim().toLowerCase()
        : "";
    if (title) {
      const normalized = title.replace(/[^a-z0-9]+/g, " ").trim();
      if (normalized) return `title:${normalized}`;
    }
    return "";
  }

  _extractAuthors(work) {
    if (!Array.isArray(work?.authorships)) return [];
    return work.authorships
      .map((authorship) => {
        const name =
          typeof authorship?.author?.display_name === "string"
            ? authorship.author.display_name.trim()
            : "";
        return name;
      })
      .filter(Boolean);
  }

  _extractPublicationDate(work) {
    if (
      typeof work?.publication_date === "string" &&
      work.publication_date.trim()
    ) {
      return work.publication_date.trim();
    }
    if (typeof work?.publication_year === "number") {
      return String(work.publication_year);
    }
    return "";
  }

  _reconstructAbstract(invertedIndex) {
    if (!invertedIndex || typeof invertedIndex !== "object") {
      return "";
    }
    const words = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      if (!Array.isArray(positions)) continue;
      for (const position of positions) {
        if (typeof position !== "number") continue;
        words[position] = word;
      }
    }
    return words
      .filter((word) => typeof word === "string" && word.length > 0)
      .join(" ")
      .trim();
  }

  _buildMetadata(work) {
    const metadata = [];
    const authors = this._extractAuthors(work);
    if (authors.length) metadata.push(`Authors: ${authors.join(", ")}`);
    const publicationDate = this._extractPublicationDate(work);
    if (publicationDate) metadata.push(`Published: ${publicationDate}`);
    if (typeof work?.cited_by_count === "number") {
      metadata.push(`Citations: ${work.cited_by_count}`);
    }
    return metadata.join(" · ");
  }

  _buildSnippet(work) {
    const abstract = this._reconstructAbstract(
      work?.abstract_inverted_index,
    );
    const metadata = this._buildMetadata(work);
    const parts = [];
    if (metadata) parts.push(metadata);
    if (abstract) parts.push(this._truncateText(abstract));
    return parts.join("\n\n");
  }

  _getTokens(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  _minDistance(tokens, termA, termB) {
    const indicesA = [];
    const indicesB = [];

    tokens.forEach((token, idx) => {
      if (token === termA) indicesA.push(idx);
      if (token === termB) indicesB.push(idx);
    });

    if (!indicesA.length || !indicesB.length) return Infinity;

    let min = Infinity;
    for (const a of indicesA) {
      for (const b of indicesB) {
        const dist = Math.abs(a - b);
        if (dist < min) min = dist;
      }
    }
    return min;
  }

  _rankResults(results, query) {
    const stopWords = new Set([
      "a", "an", "and", "are", "as", "at", "be",
      "by", "for", "from", "in", "into", "is",
      "of", "on", "or", "the", "to", "with",
      "effect", "effects", "study", "analysis",
      "investigation", "review"
    ]);

    const terms = query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !stopWords.has(term));

    const uniqueTerms = [...new Set(terms)];
    if (!uniqueTerms.length) return results;

    const scored = results.map((result, index) => {
      const title =
        typeof result.title === "string" ? result.title.toLowerCase() : "";
      const snippet =
        typeof result.snippet === "string" ? result.snippet.toLowerCase() : "";
      const abstract = snippet.split("\n\n").slice(1).join(" ");

      const titleTokens = this._getTokens(title);
      const abstractTokens = this._getTokens(abstract);

      let score = 0;
      let titleMatches = 0;
      let abstractMatches = 0;

      for (const term of uniqueTerms) {
        if (titleTokens.includes(term)) {
          titleMatches++;
          score += 12;
        }
        if (abstractTokens.includes(term)) {
          abstractMatches++;
          score += 5;
        }
      }

      for (let i = 0; i < uniqueTerms.length; i++) {
        for (let j = i + 1; j < uniqueTerms.length; j++) {
          const termA = uniqueTerms[i];
          const termB = uniqueTerms[j];

          const titleDist = this._minDistance(titleTokens, termA, termB);
          if (titleDist <= 4) score += 40;
          else if (titleDist <= 8) score += 20;

          const abstractDist = this._minDistance(abstractTokens, termA, termB);
          if (abstractDist <= 6) score += 15;
          else if (abstractDist <= 12) score += 8;
        }
      }

      if (titleMatches >= 3) score += 30;
      else if (titleMatches >= 2) score += 15;

      if (abstractMatches >= 3) score += 12;

      score += Math.max(0, 20 - index);

      const citations =
        typeof result.citationCount === "number"
          ? result.citationCount
          : 0;
      score += Math.min(5, Math.log10(citations + 1));

      return { ...result, score };
    });

    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    return scored;
  }

  async executeSearch(query, page = 1, timeFilter, context) {
    console.log(
      `[openalex] START page=${page} time="${timeFilter || "any"}"`,
    );
    if (typeof query !== "string" || !query.trim()) return [];

    const parsed = this._parseQuery(query);
    const { from, to } = this._resolveDateRange(
      timeFilter,
      context,
      parsed,
    );

    const params = new URLSearchParams();
    let searchQuery = parsed.query;

    if (parsed.categories.length) {
      searchQuery = [searchQuery, ...parsed.categories]
        .filter(Boolean)
        .join(" ");
    }
    if (parsed.authors.length) {
      searchQuery = [searchQuery, ...parsed.authors]
        .filter(Boolean)
        .join(" ");
    }

    params.set("search", searchQuery);
    params.set("per-page", String(DEFAULT_LIMIT));
    params.set("page", String(page));

    const filters = [];
    if (from) filters.push(`from_publication_date:${from}`);
    if (to) filters.push(`to_publication_date:${to}`);
    if (filters.length) params.set("filter", filters.join(","));

    const apiKey =
      typeof process !== "undefined" && process?.env
        ? process.env.OPENALEX_API_KEY
        : "";

    const url = `${BASE_URL}?${params.toString()}`;
    console.log(`[openalex] request=${BASE_URL}`);

    const headers = { Accept: "application/json" };
    // Sent as a bearer token, never as an api_key query parameter: a key in the
    // URL leaks through referrers, proxy access logs, and the curl transports,
    // which pass the URL as a command-line argument.
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const doFetch = context?.fetch ?? fetch;
    let response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw this._error(
        context,
        "request_error",
        `OpenAlex request failed: ${message}`,
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
        `OpenAlex returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      const message =
        data?.error ||
        data?.message ||
        `OpenAlex returned HTTP ${response.status}`;
      throw this._error(context, "request_error", message);
    }

    if (!Array.isArray(data?.results)) {
      throw this._error(
        context,
        "parse_error",
        "OpenAlex response contained no results array",
      );
    }
    const works = data.results;
    console.log(`[openalex] received ${works.length} works`);

    const results = [];
    const seenIds = new Set();
    const seenNormalizedTitles = new Set();

    for (const work of works) {
      const title =
        typeof work?.title === "string" ? work.title.trim() : "";
      if (!title) continue;

      const canonicalId = this._getCanonicalId(work);
      const normalizedTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

      let isDuplicate = false;
      if (canonicalId) {
        if (seenIds.has(canonicalId)) isDuplicate = true;
        seenIds.add(canonicalId);
      }
      if (normalizedTitle) {
        if (seenNormalizedTitles.has(normalizedTitle)) isDuplicate = true;
        seenNormalizedTitles.add(normalizedTitle);
      }

      if (isDuplicate) continue;

      const url = this._resolvePaperUrl(work);
      if (!url) continue;

      const result = {
        title,
        url,
        snippet: this._buildSnippet(work),
        source: this.name,
      };

      if (typeof work?.id === "string" && work.id.trim()) {
        result.openAlexId = work.id.trim();
      }
      if (typeof work?.doi === "string" && work.doi.trim()) {
        result.doi = work.doi.trim();
      }
      if (typeof work?.publication_year === "number") {
        result.year = work.publication_year;
      }
      if (
        typeof work?.publication_date === "string" &&
        work.publication_date.trim()
      ) {
        result.publicationDate = work.publication_date.trim();
      }
      if (typeof work?.cited_by_count === "number") {
        result.citationCount = work.cited_by_count;
      }
      if (
        typeof work?.best_oa_location?.pdf_url === "string" &&
        work.best_oa_location.pdf_url.trim()
      ) {
        result.pdfUrl = work.best_oa_location.pdf_url.trim();
      }
      if (typeof work?.type === "string" && work.type.trim()) {
        result.type = work.type.trim();
      }

      results.push(result);
    }

    const ranked = this._rankResults(results, parsed.query);
    console.log(`[openalex] DONE results=${ranked.length}`);
    return ranked;
  }
}