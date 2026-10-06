const BASE_URL = "https://api.lobstr.io/v1";
const POLL_INTERVAL_MS = 500;
const RUN_TIMEOUT_MS = 20_000; // internal run polling timeout

export default class LobstrEngine {
  isClientExposed = false;
  name = "Lobstr";
  bangShortcut = "lobstr";

  // No custom settings – use DeGoog's built-in timeout field instead.
  _apiKey = "";
  _googleSquid = "";
  configure(settings = {}) {
    this._apiKey = (settings.apiKey || "").trim();
    this._googleSquid = (settings.googleSquid || "").trim();
  }

  settingsSchema = [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      secret: true,
      placeholder: "LOBSTR_API_KEY",
      description:
        "Leave empty to use the LOBSTR_API_KEY environment variable.",
    },
    {
      key: "googleSquid",
      label: "Google Scholar Proxy",
      type: "url",
      secret: true,
      placeholder: "LOBSTR_GOOGLE_SQUID",
      description:
        "Leave empty to use the LOBSTR_GOOGLE_SQUID environment variable.",
    },
  ];

  _error(context, status, message) {
    if (context?.engineError) {
      return context.engineError(status, message, {
        engine: this.name,
      });
    }
    return new Error(message);
  }

  async _request(url, options = {}, context) {
    const apiKey = (this._apiKey || process.env.LOBSTR_API_KEY?.trim() || "");
    if (!apiKey) {
      throw this._error(
        context,
        "configuration_error",
        "LOBSTR_API_KEY is not configured.",
      );
    }

    const doFetch = context?.fetch ?? fetch;

    let response;
    try {
      response = await doFetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Token ${apiKey}`,
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
        `Lobstr request failed: ${message}`,
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
        `Lobstr returned invalid JSON (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      const message =
        data?.errors?.message ||
        data?.error ||
        data?.message ||
        `Lobstr returned HTTP ${response.status}`;
      throw this._error(context, "request_error", message);
    }

    return data;
  }

  /**
   * Delete a task using a separate fetch that is NOT tied to the
   * search request's AbortSignal. This ensures cleanup even when
   * DeGoog aborts due to timeout.
   */
  async _deleteTask(taskId, apiKey, context) {
    const url = `${BASE_URL}/tasks/${encodeURIComponent(taskId)}`;

    // Lobstr refuses to delete a task while its run is still in progress, and
    // reports that as HTTP 400 with code "RunInProgress". That is a *wait* signal,
    // not a failure: _waitForRun returns the moment the run reports "done", but
    // Lobstr keeps finalising the task for a short while afterwards. So back off
    // patiently instead of failing in two seconds and orphaning the task.
    const maxAttempts = 6;
    const backoffMs = [1000, 2000, 4000, 8000, 10000, 10000];
    let lastError;
    let runInProgress = false;

    // Route through context.fetch like every other call in this engine, so the
    // instance's outgoing proxy and per-engine transport selection also apply to
    // the cleanup request. Falls back to global fetch if core supplies none.
    const doFetch = context?.fetch ?? fetch;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await doFetch(url, {
          method: "DELETE",
          headers: {
            Accept: "application/json",
            Authorization: `Token ${apiKey}`,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const text = await response.text();
          runInProgress =
            response.status === 400 && text.includes("RunInProgress");
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        console.log(`[lobstr] task ${taskId} deleted`);
        return;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        console.warn(
          `[lobstr] delete attempt ${attempt + 1}/${maxAttempts} failed for task ${taskId}:`,
          error instanceof Error ? error.message : String(error),
        );

        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, backoffMs[Math.min(attempt, backoffMs.length - 1)]),
          );
        }
      }
    }

    // Cleanup only. The search itself already returned its results, so this must
    // not be reported as a functional failure -- it never was one.
    const reason = runInProgress
      ? "Lobstr was still finalising the run; it may be removed from the Lobstr UI"
      : "the task may need removing from the Lobstr UI";
    console.warn(
      `[lobstr] task ${taskId} not deleted after ${maxAttempts} attempts (${reason}). ` +
        `Search results were unaffected. Last error: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
    );
  }

  async _waitForRun(runId, context) {
    const started = Date.now();
    while (Date.now() - started < RUN_TIMEOUT_MS) {
      // Abort is carried by context.fetch, which rejects when DeGoog's engine
      // timeout fires; the in-flight poll below is unwound that way.
      const data = await this._request(
        `${BASE_URL}/runs/${encodeURIComponent(runId)}`,
        { method: "GET" },
        context,
      );

      if (data?.status === "done" || data?.is_done === true) {
        console.log(`[lobstr] run ${runId} completed`);
        return data;
      }

      if (data?.status === "error" || data?.status === "failed") {
        throw this._error(
          context,
          "request_error",
          data?.done_reason_desc ||
            data?.done_reason ||
            "Lobstr run failed.",
        );
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw this._error(
      context,
      "timeout",
      `Lobstr run timed out after ${RUN_TIMEOUT_MS}ms.`,
    );
  }

  async executeSearch(query, page = 1, timeFilter, context) {
    if (page > 1) return [];

    const squid = (this._googleSquid || process.env.LOBSTR_GOOGLE_SQUID?.trim() || "");
    if (!squid) {
      throw this._error(
        context,
        "configuration_error",
        "LOBSTR_GOOGLE_SQUID is not configured.",
      );
    }

    const apiKey = (this._apiKey || process.env.LOBSTR_API_KEY?.trim() || "");
    if (!apiKey) {
      throw this._error(
        context,
        "configuration_error",
        "LOBSTR_API_KEY is not configured.",
      );
    }

    let taskId = null;

    try {
      const taskData = await this._request(
        `${BASE_URL}/tasks`,
        {
          method: "POST",
          body: JSON.stringify({
            squid,
            tasks: [{ keyword: query }],
          }),
        },
        context,
      );

      const task = Array.isArray(taskData?.tasks) ? taskData.tasks[0] : null;
      taskId = task?.id != null ? String(task.id) : null;

      if (!taskId) {
        throw this._error(
          context,
          "parse_error",
          "Lobstr did not return a task ID.",
        );
      }

      console.log(`[lobstr] task ${taskId} created`);

      const runData = await this._request(
        `${BASE_URL}/runs`,
        {
          method: "POST",
          body: JSON.stringify({ squid }),
        },
        context,
      );

      const runId = runData?.id != null ? String(runData.id) : null;
      if (!runId) {
        throw this._error(
          context,
          "parse_error",
          "Lobstr did not return a run ID.",
        );
      }

      console.log(`[lobstr] run ${runId} started`);

      const run = await this._waitForRun(runId, context);

      const resultData = await this._request(
        `${BASE_URL}/results?run=${encodeURIComponent(runId)}`,
        { method: "GET" },
        context,
      );

      const rawResults = Array.isArray(resultData?.data) ? resultData.data : [];

      const results = [];

      for (const item of rawResults) {
        if (item?.is_organic === false) continue;

        const url = typeof item?.url === "string" ? item.url.trim() : "";
        const title = typeof item?.title === "string" ? item.title.trim() : "";
        const snippet =
          typeof item?.description === "string" ? item.description.trim() : "";

        if (!url || !title) continue;
        if (!/^https?:\/\//i.test(url)) continue;

        results.push({
          title,
          url,
          snippet,
          source: this.name,
        });
      }

      console.log(`[lobstr] returned ${results.length} organic results`);

      return results;
    } finally {
      if (taskId) {
        await this._deleteTask(taskId, apiKey, context);
      }
    }
  }
}