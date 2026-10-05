export const type = "papers";

const BASE_URL =
  "https://api.firecrawl.dev/v2/search/research/papers";
const DEFAULT_LIMIT = 20;
const MAX_SNIPPET_LENGTH = 600;

export default class FirecrawlResearchEngine {
  isClientExposed = false;
  name = "Firecrawl Research";
  bangShortcut = "firecrawl-research";

  settingsSchema = [];

  _error(context, type, message) {
    console.error(
      `[firecrawl-research] ERROR (${type}): ${message}`,
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
    const primaryId =
      typeof paper?.primaryId === "string" ? paper.primaryId.trim() : "";
    if (primaryId) {
      if (primaryId.startsWith("arxiv:")) {
        return `https://arxiv.org/abs/${primaryId.slice(6)}`;
      }
      if (primaryId.startsWith("doi:")) {
        return `https://doi.org/${primaryId.slice(4)}`;
      }
      if (primaryId.startsWith("pmid:")) {
        return `https://pubmed.ncbi.nlm.nih.gov/${primaryId.slice(5)}/`;
      }
      if (primaryId.startsWith("pmcid:")) {
        return `https://pmc.ncbi.nlm.nih.gov/articles/${primaryId.slice(6)}/`;
      }
    }
    const url = typeof paper?.url === "string" ? paper.url.trim() : "";
    return /^https?:\/\//i.test(url) ? url : "";
  }

  _getCanonicalId(paper) {
    const doi =
      typeof paper?.doi === "string"
        ? paper.doi.trim().toLowerCase()
        : typeof paper?.primaryId === "string" &&
          paper.primaryId.trim().toLowerCase().startsWith("doi:")
          ? paper.primaryId.trim().toLowerCase().slice(4)
          : "";
    if (doi) return `doi:${doi}`;

    const primaryId =
      typeof paper?.primaryId === "string"
        ? paper.primaryId.trim().toLowerCase()
        : "";
    if (primaryId) return `primary:${primaryId}`;

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
    const candidates = [
      paper?.publishedDate,
      paper?.publicationDate,
      paper?.published,
      paper?.date,
    ];
    for (const value of candidates) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    if (
      typeof paper?.year === "number" ||
      typeof paper?.year === "string"
    ) {
      return String(paper.year);
    }
    return "";
  }

  _extractCitationCount(paper) {
    const candidates = [
      paper?.citationCount,
      paper?.citedByCount,
      paper?.cited_by_count,
      paper?.citations,
    ];
    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  }

  _buildMetadata(paper) {
    const metadata = [];
    const authors = this._extractAuthors(paper);
    if (authors.length) metadata.push(`Authors: ${authors.join(", ")}`);
    const publicationDate = this._extractPublicationDate(paper);
    if (publicationDate) metadata.push(`Published: ${publicationDate}`);
    const citationCount = this._extractCitationCount(paper);
    if (citationCount !== null) metadata.push(`Citations: ${citationCount}`);
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

      // Individual term matches
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

      // Proximity scoring for pairs of query terms
      for (let i = 0; i < uniqueTerms.length; i++) {
        for (let j = i + 1; j < uniqueTerms.length; j++) {
          const termA = uniqueTerms[i];
          const termB = uniqueTerms[j];

          const titleDist = this._minDistance(
            titleTokens,
            termA,
            termB,
          );
          if (titleDist <= 4) {
            score += 40;
          } else if (titleDist <= 8) {
            score += 20;
          }

          const abstractDist = this._minDistance(
            abstractTokens,
            termA,
            termB,
          );
          if (abstractDist <= 6) {
            score += 15;
          } else if (abstractDist <= 12) {
            score += 8;
          }
        }
      }

      // Bonus when multiple title terms are present
      if (titleMatches >= 3) score += 30;
      else if (titleMatches >= 2) score += 15;

      if (abstractMatches >= 3) score += 12;

      // Original API rank
      score += Math.max(0, 20 - index);

      // Citation bonus
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
      `[firecrawl-research] START page=${page} time="${timeFilter || "any"}"`,
    );
    if (page > 1) {
      console.log(
        `[firecrawl-research] page=${page} unsupported; returning empty`,
      );
      return [];
    }
    if (typeof query !== "string" || !query.trim()) return [];

    const parsed = this._parseQuery(query);
    const { from, to } = this._resolveDateRange(
      timeFilter,
      context,
      parsed,
    );

    const params = new URLSearchParams();
    params.set("query", parsed.query);
    params.set("k", String(DEFAULT_LIMIT));

    for (const author of parsed.authors) params.append("authors", author);
    for (const category of parsed.categories) params.append("categories", category);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    const url = `${BASE_URL}?${params.toString()}`;
    console.log(`[firecrawl-research] request=${BASE_URL}`);

    const doFetch = context?.fetch ?? fetch;
    let response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw this._error(
        context,
        "request_error",
        `Firecrawl Research request failed: ${message}`,
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
        `Firecrawl Research returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (data?.warning) console.warn(`[firecrawl-research] warning: ${data.warning}`);

    if (!response.ok || data?.success === false) {
      const message =
        data?.error ||
        data?.message ||
        `Firecrawl Research returned HTTP ${response.status}`;
      throw this._error(context, "request_error", message);
    }

    let papers = null;
    if (Array.isArray(data?.results)) papers = data.results;
    else if (Array.isArray(data?.data)) papers = data.data;
    else if (Array.isArray(data?.papers)) papers = data.papers;
    if (papers === null) {
      throw this._error(
        context,
        "parse_error",
        "Firecrawl Research response contained no papers array",
      );
    }

    console.log(`[firecrawl-research] received ${papers.length} papers`);

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
      if (typeof paper?.primaryId === "string" && paper.primaryId.trim()) {
        result.primaryId = paper.primaryId.trim();
      }
      const citationCount = this._extractCitationCount(paper);
      if (citationCount !== null) result.citationCount = citationCount;

      results.push(result);
    }

    const ranked = this._rankResults(results, parsed.query);
    console.log(`[firecrawl-research] DONE results=${ranked.length}`);
    return ranked;
  }
}