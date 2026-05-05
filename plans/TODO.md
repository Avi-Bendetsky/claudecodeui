# TODO — CloudCLI Integration Master List

**Last updated:** 2026-05-05 (session 3)  
**Plan reference:** [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md)

Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked

---

## IMMEDIATE BUG FIXES (do before phases)

- [x] **BUG-01** Remove `console.log('SERVER_PORT from env:...')` from `server/index.js:81`
- [x] **BUG-02** Create `.env.example` with all required variables documented
- [x] **BUG-03** Add code comment in `groq-mcp.provider.ts` explaining why Groq excluded from global MCP
- [x] **BUG-04** Add `permission_warning` WS event at T-10s via `onWarning` callback in `waitForToolApproval()` in `claude-sdk.js`

---

## PHASE 1 — 9Router Wiring
*Goal: All LLM calls route through 9Router. Est. 1 day.*

- [x] **P1-01** Create `.env` with `OPENAI_API_BASE=http://localhost:20128/v1` commented (ready to enable)
- [x] **P1-02** Create `.env.example` documenting all required env vars
- [x] **P1-03** Verified `server/load-env.js` loads env before provider modules initialize
- [x] **P1-04** Pass `baseUrl` from `OPENAI_API_BASE` env to Codex in `server/openai-codex.js`
- [x] **P1-05** `sdkOptions.env = { ...process.env }` in `claude-sdk.js` forwards all env to SDK subprocess
- [x] **P1-06** Updated `CrewAI-Studio/.env` with `OPENAI_API_BASE` commented
- [ ] **P1-07** Smoke test: 9Router → uncomment env → Codex query → verify proxied
- [ ] **P1-08** Smoke test: Claude OAuth still works (not proxied)
- [x] **P1-09** Fix BUG-01: removed stray console.log

---

## PHASE 2 — CrewAI FastAPI Bridge
*Goal: CrewAI has a REST/SSE API callable from Node.js. Est. 1 day.*

- [x] **P2-02** Created `crewai-bridge/` directory
- [x] **P2-03** Created `bridge/api.py` with `GET /health`, `/crew/list`, `/agent/list`, `/crew/run`
- [x] **P2-06** `POST /crew/run` with SSE streaming via ThreadPoolExecutor
- [x] **P2-07** CORS middleware added
- [ ] **P2-01** Add `fastapi`, `uvicorn`, `sse-starlette` to `CrewAI-Studio/requirements.txt`
- [ ] **P2-08** Test `GET /health` with curl
- [ ] **P2-09** Test `GET /crew/list` with curl
- [ ] **P2-10** Test `POST /crew/run` with curl
- [x] **P2-11** Create `bridge/README.md` with startup instructions

---

## PHASE 3 — OpenClaude Provider in CloudCLI
*Goal: OCC is a selectable provider in CloudCLI chat. Est. 2 days.*

- [x] **P3-01** Created `server/openclaude-cli.js` — spawn `occ`, parse 13 event types
- [x] **P3-02** Map OCC event types to `createNormalizedMessage()` (stream_event, tool_use, tool_result, thinking, error, stop, result, permission_request, agent_spawn, stream_request_start, compaction, system, assistant)
- [x] **P3-03** Handle `--agents` flag from `OCC_AGENTS_PATH` env
- [x] **P3-04** Handle `--agent <name>` flag from UI
- [x] **P3-05** Set `ANTHROPIC_BASE_URL` in OCC spawn env from `OPENAI_API_BASE`
- [x] **P3-06** Created `openclaude.provider.ts`
- [x] **P3-07** Created `openclaude-auth.provider.ts`
- [x] **P3-08** Created `openclaude-sessions.provider.ts`
- [x] **P3-09** Created `openclaude-mcp.provider.ts`
- [x] **P3-10** Created `openclaude-session-synchronizer.provider.ts`
- [x] **P3-11** Registered OpenClaude in `provider.registry.ts`
- [x] **P3-12** Added `openclaude-command` message type to `chat-websocket.service.ts`
- [x] **P3-13** Added `openclaude` to `LLMProvider` type in `server/shared/types.ts`
- [x] **P3-14** Added OCC tool configs to `toolConfigs.ts` (Spawn, Dispatch, SendMessage, MultiEdit, LS, WebFetch, WebSearch, MCPTool, Agent)
- [x] **P3-15** Created `ProviderSelector.tsx` with agent dropdown (fetches `/api/openclaude/agents`)
- [x] **P3-16** Added `OPENCLAUDE_MODELS` to `shared/modelConstants.js`
- [x] **P3-17** Created `OpenClaudeLogo.tsx` and wired into `SessionProviderLogo`
- [x] **P3-XX** Wired `spawnOpenClaude` + abort/status in `server/index.js` WS dependencies
- [x] **P3-XX** Added `/api/openclaude/agents` endpoint in `server/index.js`
- [ ] **P3-18** Smoke test: select OpenClaude, send "hello", confirm streaming
- [ ] **P3-19** Test: abort session mid-run
- [ ] **P3-20** Test: session appears in sidebar
- [ ] **P3-21** Test: session is resumable after reload

---

## PHASE 4 — CrewAI Provider in CloudCLI
*Goal: Crews can be triggered and streamed in CloudCLI chat. Est. 1 day.*

- [x] **P4-01** Created `server/crewai-bridge-client.js` — HTTP client, SSE → WS, 8 event types
- [x] **P4-02** Created provider module files (crewai.provider, auth, sessions, mcp, sync)
- [x] **P4-03** Registered CrewAI in provider registry
- [x] **P4-04** Added `crewai-command` message type to chat WebSocket service
- [x] **P4-05** Created `ProviderSelector.tsx` crew dropdown (fetches `/api/crewai/crews`)
- [x] **P4-06** Agent listing via `/api/crewai/agents` endpoint
- [x] **P4-07** Map CrewAI SSE events to normalized messages (status, result, task_start, task_output, agent_output, tool_use, crew_complete, error)
- [x] **P4-08** Handle bridge offline gracefully (ECONNREFUSED → helpful error message)
- [x] **P4-XX** Wired `queryCrewAI` + abort/status in `server/index.js` WS dependencies
- [x] **P4-XX** Added `/api/crewai/crews`, `/api/crewai/agents`, `/api/crewai/health` endpoints
- [ ] **P4-09** Smoke test: select CrewAI, pick crew, send task, confirm streaming
- [ ] **P4-10** Test: crew result saved to session DB

---

## PHASE 5 — CLI Look & Feel
*Goal: CloudCLI chat tab visually matches Claude Code CLI. Est. 2–3 days.*

- [x] **P5-01** Added `cliTheme` toggle to `AppearanceSettingsTab.tsx`
- [x] **P5-02** Added `cli-theme` CSS class to app root when toggle enabled
- [x] **P5-03** Added monospace font override and dark terminal palette to `src/index.css`
- [x] **P5-04** Replaced tool cards with `● ToolName(args)` in `OneLineDisplay.tsx` when `cli-theme` active
- [x] **P5-05** ChatComposer detects `cli-theme` class
- [x] **P5-06** CSS hides token pie, mermaid, image attachment in CLI theme (`display: none`)
- [x] **P5-07** Added `Ctrl+C` keyboard shortcut to abort active session
- [x] **P5-08** Added `Ctrl+L` keyboard shortcut to clear chat
- [x] **P5-09** Added `↑` arrow key history navigation in ChatComposer
- [x] **P5-10** Slash command palette wired via `onToggleCommandMenu`
- [x] **P5-11** Regression test: card theme border-l-2 styling preserved
- [x] **P5-12** Regression test: CLI theme CSS doesn't break base layout
- [ ] **P5-13** Visual comparison: screenshot vs Claude Code CLI

---

## PHASE 6 — Startup Orchestration
*Goal: One command starts all 4 services. Est. 0.5 days.*

- [x] **P6-01** Created `start-stack.ps1` for Windows with health-check waits
- [x] **P6-02** Created `start-stack.sh` for Linux/Mac
- [x] **P6-03** Added `GET /api/stack-health` endpoint with real service checks
- [x] **P6-04** Stack health checks: 9Router (:20128), CrewAI bridge (:8000), CloudCLI (:3001)
- [x] **P6-05** Added `StackHealthIndicator` to sidebar footer
- [ ] **P6-06** Test: run `start-stack.ps1` from cold, all 4 services up within 30s

---

## PHASE 7 — Session Unification
*Goal: All sessions from all providers in one CloudCLI sidebar. Est. 2 days.*

- [x] **P7-01** `LLMProvider` type accepts `"openclaude" | "crewai"`, `getSessionsByProvider()` exists
- [x] **P7-02** OCC session synchronizer reads checkpoint files
- [x] **P7-03** CrewAI session synchronizer posts crew run results
- [x] **P7-04** Sessions DB supports provider-based filtering via `getSessionsByProvider()`
- [x] **P7-05** Cross-context: resume CrewAI result as OCC follow-up task
- [ ] **P7-06** Test: complete run in each provider, all sessions appear in sidebar
- [ ] **P7-07** Test: reload page, sessions still present and resumable

---

## STANDING REMEDIATION LOOPS

Run after completing each phase:

```
[x] npm run build        → exits 0
[x] npm run typecheck    → exits 0
[ ] Start full stack     → all 4 services up
[ ] Send "hello" to each active provider → response streams
[ ] Check 9Router dashboard → requests proxied
[ ] Check sidebar → sessions saved
[ ] Provider health: abort, status check, resume all work
```

---

## COMPLETION SUMMARY

| Phase | Total | Done | Remaining | % |
|-------|-------|------|-----------|---|
| Bugs  | 4     | 4    | 0         | 100% |
| P1    | 9     | 7    | 2 (smoke tests) | 78% |
| P2    | 11    | 5    | 6 (deps + manual tests) | 45% |
| P3    | 21    | 17   | 4 (smoke tests) | 81% |
| P4    | 12    | 10   | 2 (smoke tests) | 83% |
| P5    | 13    | 12   | 1 (visual comparison) | 92% |
| P6    | 6     | 5    | 1 (cold start test) | 83% |
| P7    | 7     | 5    | 2 (E2E tests) | 71% |
| **Total** | **83** | **65** | **18** | **78%** |

All code implementation is complete. Remaining 18 items are smoke/E2E tests requiring running services, the P2 Python dependency setup, and manual curl tests.

---

## DEFERRED (post v1.0)

- Migrate `server/claude-sdk.js` → `.ts`
- Migrate `server/cursor-cli.js` → `.ts`
- Migrate `server/gemini-cli.js` → `.ts`
- Migrate `server/openai-codex.js` → `.ts`
- Split `server/index.js` (1501 LOC) into smaller modules
- Add React component tests (currently zero)
- Add E2E tests for provider smoke tests
- Docker compose file for all 4 services
