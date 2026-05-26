/** EN strings used by the surviving (non-UI) code paths. */

export const EN = {
  errors: {
    contextOverflow:
      "Context overflow (400): session history is {requested}, past the model's prompt limit. Usually a single tool result grew too big. The harness caps new tool results at 8k tokens and auto-heals oversized history on session load — restart often clears it. If it still overflows, start a fresh session.",
    contextOverflowTooMany: "too many tokens",
    auth401:
      "Authentication failed (401): {inner}. Your API key is rejected. Set `OPENROUTER_API_KEY=sk-or-...` (https://openrouter.ai/keys) or `DEEPSEEK_API_KEY=sk-...` (https://platform.deepseek.com/api_keys).",
    balance402:
      "Out of credits (402): {inner}. Top up at https://openrouter.ai/credits or https://platform.deepseek.com/top_up.",
    badparam422: "Invalid parameter (422): {inner}",
    badrequest400: "Bad request (400): {inner}",
    concurrency429:
      "Provider concurrency limit hit (429): {inner}. Too many in-flight requests on the upstream account. Wait a few seconds and retry, reduce parallelism, or request a higher cap from your provider.",
    deepseek5xxHead:
      "DeepSeek service unavailable ({status}) — this is a DeepSeek-side problem. Already retried 4× with backoff.",
    deepseek5xxReachable:
      " DeepSeek's main API answered our health check, but /chat/completions is failing — partial outage on their side.",
    deepseek5xxUnreachable:
      " DeepSeek API is unreachable from your network — could be a wider DS outage or a local network issue.",
    deepseek5xxActionNetwork:
      " Try: (1) check your network, (2) wait 30s and retry, (3) status page: https://status.deepseek.com.",
    deepseek5xxActionRetry:
      " Try: (1) wait 30s and retry, (2) switch model, (3) status page: https://status.deepseek.com.",
    upstream5xxHead:
      "Upstream service unavailable ({status}) at {host} — the configured API endpoint returned a server error. Already retried 4× with backoff.",
    upstream5xxActionRetry:
      " Try: (1) check that the local/proxy model server is up, (2) wait and retry, (3) switch model.",
    innerNoMessage: "(no message)",
    reasonAborted: "[aborted by user — summarizing what was found so far]",
    reasonContextGuard:
      "[context budget running low — summarizing before the next call would overflow]",
    reasonStuck:
      "[stuck on a repeated tool call — explaining what was tried and what's blocking progress]",
    labelAborted: "aborted by user",
    labelContextGuard: "context-guard triggered (prompt > 80% of window)",
    labelStuck: "stuck (repeated tool call suppressed by storm-breaker)",
  },
  loop: {
    budgetExhausted:
      "session budget exhausted — spent ${spent} ≥ cap ${cap}. Bump the cap, clear it, or end the session.",
    budget80Pct: "▲ budget 80% used — ${spent} of ${cap}. Next turn or two likely trips the cap.",
    proArmed: "⇧ pro tier armed — this turn runs on the pro model (one-shot · disarms after turn)",
    toolUploadStatus: "tool result uploaded · model thinking before next response…",
    turnStartFoldStatus: "turn start: context approaching limit, compacting history…",
    turnStartFolded:
      "turn start: request ~{estimate}/{ctxMax} tokens ({pct}%) — compacted {beforeMessages} messages → {afterMessages}. Sending.",
    harvestStatus: "extracting plan state from reasoning…",
    repeatToolCallWarning:
      "Caught a repeated tool call — let the model see the issue and retry with a different approach.",
    stormStuck:
      "Stopped a stuck retry loop — the model kept calling the same tool with identical args after a self-correction nudge.",
    stormSuppressed: "Suppressed {count} repeated tool call(s) — same name + args fired 3+ times.",
    compactingHistoryStatus: "compacting history{aggressiveTag}…",
    aggressiveTag: " (aggressive)",
    foldedHistory:
      "context {before}/{ctxMax} ({pct}%) — folded {beforeMessages} messages → {afterMessages} (summary {summaryChars} chars). Continuing.",
    aggressivelyFoldedHistory:
      "context {before}/{ctxMax} ({pct}%) — aggressively folded {beforeMessages} messages → {afterMessages} (summary {summaryChars} chars). Continuing.",
    forcingSummary: "context {before}/{ctxMax} ({pct}%) — forcing summary from what was gathered.",
  },
  hooks: {
    head: "hook {tag} `{cmd}` {decision}{truncTag}",
    headWithDetail: "hook {tag} `{cmd}` {decision}{truncTag}: {detail}",
    truncated: " (output truncated at 256KB)",
    decisionBlock: "block",
    decisionWarn: "warn",
    decisionTimeout: "timeout",
    decisionError: "error",
  },
  summary: {
    status: "summarizing what was gathered…",
    hallucinatedFallback:
      "(model emitted fake tool-call markup instead of a prose summary — try retrying with a narrower question)",
    failedAfterReason:
      "{label} and the fallback summary call failed: {message}. Retry with a narrower question.",
  },
  doctorErrors: {
    unreadable: "{path} unreadable — {message}",
    cannotList: "cannot list — {message}",
    parseFailed: "couldn't parse settings.json — {message}",
    probeFailed: "probe failed — {message}",
  },
  webErrors: {
    status:
      "web_search {status} — try: the search backend returned an error; rephrase the query, or switch engine",
    rateLimit429:
      "web_search 429 — try: wait 10s before retrying, or rephrase the query; the search backend is rate-limiting this client",
    forbidden403:
      "web_search 403 — try: the search backend is blocking this client; switch engine or wait and retry later",
    serverError5xx:
      "web_search {status} — try: open the search URL in a browser; if it loads this is transient and a retry in 30s may help",
    bingBlocked:
      "web_search: Bing anti-bot page — rate-limited or blocked — wait 30s and retry, or switch engine",
    bingNoResults:
      "web_search: 0 results but response doesn't look like a real empty page ({chars} chars, first 120: {preview}) — rephrase the query with simpler terms, or switch engine",
    invalidEndpoint:
      'web_search: invalid SearXNG endpoint "{endpoint}" — set a valid URL with --search-endpoint http://host:port',
    endpointMustBeHttp:
      "web_search: SearXNG endpoint must be http(s), got {protocol} — set a valid URL with --search-endpoint http://host:port",
    cannotReach:
      "web_search: cannot reach SearXNG server at {endpoint} — install and start SearXNG, or switch engine",
    searxngNoResults:
      "web_search: 0 results but SearXNG response doesn't look like an empty results page ({chars} chars) — rephrase the query with simpler terms, or switch engine",
    metasoMissingKey:
      "web_search: Metaso requires an API key — set METASO_API_KEY. Get one at https://metaso.cn/search-api/playground",
    metasoDailyLimit:
      "web_search: Metaso daily search limit reached — set METASO_API_KEY at https://metaso.cn/search-api/playground",
    metasoUnauthorized:
      "web_search: Metaso API key rejected — check METASO_API_KEY at https://metaso.cn/search-api/playground",
    metasoRateLimit:
      "web_search: Metaso rate-limited — wait and retry, or get your own key at https://metaso.cn/search-api/playground",
    metasoServerError:
      "web_search: Metaso server error ({status}) — try again later, or switch engine",
    metasoParseError:
      "web_search: Metaso returned unparseable response (HTTP {status}) — try again later",
    metasoApiError: "web_search: Metaso API error (code {code}: {message}) — try again later",
    tavilyMissingKey:
      "web_search: Tavily backend requires an API key — set TAVILY_API_KEY env var or tavilyApiKey in config. Free tier at https://tavily.com",
    tavilyUnauthorized:
      "web_search: Tavily API key rejected — check TAVILY_API_KEY at https://tavily.com",
    tavilyRateLimit:
      "web_search: Tavily rate-limited or monthly quota exceeded — wait, switch engine, or upgrade",
    tavilyServerError:
      "web_search: Tavily server error ({status}) — try again later, or switch engine",
    tavilyParseError:
      "web_search: Tavily returned unparseable response (HTTP {status}) — try again later",
    perplexityMissingKey:
      "web_search: Perplexity backend requires an API key — set PERPLEXITY_API_KEY at https://perplexity.ai/settings/api",
    perplexityUnauthorized:
      "web_search: Perplexity API key rejected — check PERPLEXITY_API_KEY at https://perplexity.ai/settings/api",
    perplexityRateLimit: "web_search: Perplexity rate-limited — wait and retry, or switch engine",
    perplexityServerError:
      "web_search: Perplexity server error ({status}) — try again later, or switch engine",
    perplexityParseError:
      "web_search: Perplexity returned unparseable response (HTTP {status}) — try again later",
    exaMissingKey:
      "web_search: Exa backend requires an API key — set EXA_API_KEY. Free tier at https://exa.ai",
    exaUnauthorized: "web_search: Exa API key rejected — check EXA_API_KEY at https://exa.ai",
    exaRateLimit:
      "web_search: Exa API rate-limited or monthly quota exceeded — wait or upgrade at https://exa.ai/pricing",
    exaServerError: "web_search: Exa server error ({status}) — try again later, or switch engine",
    exaParseError:
      "web_search: Exa returned unparseable response (HTTP {status}) — try again later",
    fetchStatus:
      "web_fetch {status} for {url} — try: confirm the URL resolves in a browser; status suggests the host returned an error page",
    fetchRateLimit429:
      "web_fetch 429 for {url} — try: wait 10s before retrying; the host is rate-limiting this client",
    fetchForbidden403:
      "web_fetch 403 for {url} — try: the host is blocking this client; the page may require login or block bots",
    fetchServerError5xx:
      "web_fetch {status} for {url} — try: open the URL in a browser; if it loads this is transient and a retry in 30s may help",
    fetchTimeout:
      "web_fetch: timed out after {ms}ms for {url} — try: a shorter URL or smaller content; this may be a slow CDN",
    fetchTooLarge:
      "web_fetch refused: content-length {len} bytes exceeds {cap}-byte cap ({url}) — try a different URL with smaller content",
    fetchBodyTooLarge:
      "web_fetch refused: response body exceeded {cap}-byte cap ({seen} bytes seen) — try a different URL with smaller content",
    fetchInvalidUrl:
      "web_fetch: url must start with http:// or https:// — pass an absolute http(s) URL",
  },
  mcpLifecycle: {
    handshake: "handshake…",
    connected: "connected",
    failed: "failed",
    disabled: "disabled",
    reconnect: "reconnect…",
    initDetail: "initialise → tools/list → resources/list",
    reconnectDetail: "tearing down · re-handshake · listing tools",
    disabledDetail: "via config for {name}",
    failedSetupHint: "→ fix the underlying issue (missing npm package, network, etc.).",
    failedSetupConfigHint: "→ remove broken entries from your saved config.",
    abortedHint:
      "MCP startup aborted — {count} server(s) skipped. Restart once the underlying issue is fixed.",
    toolsReady: "tools ready",
    warnLabel: "warn",
  },
  mcpHealth: {
    noData: "no inspect data",
    healthy: "healthy · {ms}ms",
    slow: "slow · {ms}ms",
    verySlow: "very slow · {ms}ms",
    slowToast: "⚠ MCP `{name}` slow · {seconds}s p95 over the last {sampleSize} calls",
    emptyHint: "ℹ no MCP servers configured",
  },
} as const;
