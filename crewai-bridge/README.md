# CrewAI FastAPI Bridge

REST/SSE API bridge between CrewAI Studio and CloudCLI UI.

## Setup

```bash
cd crewai-bridge
pip install fastapi uvicorn sse-starlette
```

## Running

```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```

Or via the stack startup script:

```bash
# Windows
./start-stack.ps1

# Linux/Mac
./start-stack.sh
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/crew/list` | List all crews |
| GET | `/agent/list` | List all agents |
| POST | `/crew/run` | Run a crew (SSE streaming) |

## POST /crew/run

Request body:
```json
{
  "crew_id": "my-crew",
  "inputs": { "topic": "AI agents" }
}
```

Response: Server-Sent Events stream with JSON payloads:
```
data: {"type": "task_start", "task": "Research", "agent": "Researcher"}
data: {"type": "task_output", "content": "Found 5 relevant papers..."}
data: {"type": "crew_complete", "result": "Final crew output here"}
data: [DONE]
```

## Environment

Set `CREWAI_BRIDGE_URL` in CloudCLI's `.env` to override the default `http://localhost:8000`.
