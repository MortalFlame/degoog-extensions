export const type = "papers";

const BASE_URL =
  "https://api.semanticscholar.org/graph/v1/paper/search/bulk";
const DEFAULT_LIMIT = 20;
const MAX_SNIPPET_LENGTH = 600;

export default class SemanticScholarEngine {
  isClientExposed = false;
  name = "Semantic Scholar";
  bangShortcut = "semantic-scholar";

  _apiKey = "";
  configure(settings = {}) {
    this._apiKey = (settings.apiKey || "").trim();
  }

  settingsSchema = [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      secret: true,
      placeholder: "SEMANTIC_SCHOLAR_API_KEY",
      description:
        "Leave empty to use the SEMANTIC_SCHOLAR_API_KEY environment variable.",
    },
  ];

  _error(context, type, message) {
    console.error(
      `[semantic-scholar] ERROR (${type}): ${message}`,
    );
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

  _resolvePaperUrl(paper) {
    const openAccessPdf =
      typeof paper?.openAccessPdf?.url === "string"
        ? paper.openAccessPdf.url.trim()
        : "";
    if (/^https?:\/\//i.test(openAccessPdf)) return openAccessPdf;

    const url = typeof paper?.url === "string" ? paper.url.trim() : "";
    if (/^https?:\/\//i.test(url)) return url;

    const doi =
      typeof paper?.externalIds?.DOI === "string"
        ? paper.externalIds.DOI.trim()
        : "";
    if (doi) return `https://doi.org/${doi}`;

    const paperId =
      typeof paper?.paperId === "string" ? paper.paperId.trim() : "";
    if (paperId) return `https://www.semanticscholar.org/paper/${paperId}`;

    return "";
  }

  _getCanonicalId(paper) {
    const doi =
      typeof paper?.externalIds?.DOI === "string"
        ? paper.externalIds.DOI.trim().toLowerCase()
        : "";
    if (doi) return `doi:${doi}`;

    const paperId =
      typeof paper?.paperId === "string"
        ? paper.paperId.trim().toLowerCase()
        : "";
    if (paperId) return `paper:${paperId}`;

    const title =
      typeof paper?.title === "string"
        ? paper.title.trim().toLowerCase()
        : "";
    if (title) {
      const normalized = title.replace(/[^a-z0-9]+/g, " ").trim();
      if (normalized) return `title:${normalized}`;
    }
    return "";
  }

  _extractAuthors(paper) {
    if (!Array.isArray(paper?.authors)) return [];
    return paper.authors
      .map((author) => {
        if (typeof author === "string") return author.trim();
        if (typeof author?.name === "string") return author.name.trim();
        return "";
      })
      .filter(Boolean);
  }

  _extractPublicationDate(paper) {
    if (
      typeof paper?.publicationDate === "string" &&
      paper.publicationDate.trim()
    ) {
      return paper.publicationDate.trim();
    }
    if (typeof paper?.year === "number" || typeof paper?.year === "string") {
      return String(paper.year);
    }
    return "";
  }

  _buildMetadata(paper) {
    const metadata = [];
    const authors = this._extractAuthors(paper);
    if (authors.length) metadata.push(`Authors: ${authors.join(", ")}`);
    const publicationDate = this._extractPublicationDate(paper);
    if (publicationDate) metadata.push(`Published: ${publicationDate}`);
    if (typeof paper?.citationCount === "number") {
      metadata.push(`Citations: ${paper.citationCount}`);
    }
    return metadata.join(" · ");
  }

  _buildSnippet(paper) {
    const abstract =
      typeof paper?.abstract === "string" ? paper.abstract.trim() : "";
    const metadata = this._buildMetadata(paper);
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
      `[semantic-scholar] START page=${page} time="${timeFilter || "any"}"`,
    );
    if (typeof query !== "string" || !query.trim()) return [];
    if (page > 1) {
      console.log(
        `[semantic-scholar] page=${page} unsupported without persistent token; returning empty`,
      );
      return [];
    }

    const parsed = this._parseQuery(query);
    const { from, to } = this._resolveDateRange(
      timeFilter,
      context,
      parsed,
    );

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

    const params = new URLSearchParams();
    params.set("query", searchQuery);
    params.set(
      "fields",
      [
        "paperId",
        "externalIds",
        "url",
        "title",
        "abstract",
        "authors",
        "year",
        "publicationDate",
        "publicationTypes",
        "venue",
        "citationCount",
        "openAccessPdf",
      ].join(","),
    );
    params.set("limit", String(DEFAULT_LIMIT));

    if (from || to) {
      params.set("publicationDateOrYear", `${from || ""},${to || ""}`);
    }

    const apiKey =
      this._apiKey ||
      (typeof process !== "undefined" && process?.env
        ? process.env.SEMANTIC_SCHOLAR_API_KEY
        : "");
    const headers = { Accept: "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    const url = `${BASE_URL}?${params.toString()}`;
    console.log(`[semantic-scholar] request=${url.replace(/query=[^&]+/, "query=REDACTED")}`);

    const doFetch = context?.fetch ?? fetch;
    let response;
    try {
      response = await doFetch(url, { method: "GET", headers });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw this._error(
        context,
        "request_error",
        `Semantic Scholar request failed: ${message}`,
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
        `Semantic Scholar returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      const message =
        data?.message ||
        data?.error ||
        `Semantic Scholar returned HTTP ${response.status}`;
      throw this._error(context, "request_error", message);
    }

    if (!Array.isArray(data?.data)) {
      throw this._error(
        context,
        "parse_error",
        "Semantic Scholar response contained no data array",
      );
    }
    const papers = data.data;
    console.log(`[semantic-scholar] received ${papers.length} papers`);

    const results = [];
    const seenIds = new Set();
    const seenNormalizedTitles = new Set();

    for (const paper of papers) {
      const title =
        typeof paper?.title === "string" ? paper.title.trim() : "";
      if (!title) continue;

      const canonicalId = this._getCanonicalId(paper);
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

      const url = this._resolvePaperUrl(paper);
      if (!url) continue;

      const result = {
        title,
        url,
        snippet: this._buildSnippet(paper),
        source: this.name,
      };

      if (typeof paper?.paperId === "string" && paper.paperId.trim()) {
        result.paperId = paper.paperId.trim();
      }
      if (typeof paper?.citationCount === "number") {
        result.citationCount = paper.citationCount;
      }
      if (typeof paper?.year === "number") {
        result.year = paper.year;
      }
      if (
        typeof paper?.publicationDate === "string" &&
        paper.publicationDate.trim()
      ) {
        result.publicationDate = paper.publicationDate.trim();
      }
      if (
        typeof paper?.externalIds?.DOI === "string" &&
        paper.externalIds.DOI.trim()
      ) {
        result.doi = paper.externalIds.DOI.trim();
      }
      if (
        typeof paper?.openAccessPdf?.url === "string" &&
        paper.openAccessPdf.url.trim()
      ) {
        result.pdfUrl = paper.openAccessPdf.url.trim();
      }

      results.push(result);
    }

    const ranked = this._rankResults(results, parsed.query);
    console.log(`[semantic-scholar] DONE results=${ranked.length}`);
    return ranked;
  }
}