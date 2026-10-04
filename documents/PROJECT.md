# agent-timeline

An X-like timeline, served on localhost, of what Claude Code and Codex sessions on this machine are doing. Each session's conversation shows up as posts, a post opens into a thread, and replying in a thread sends an instruction to that session.

Why it is being built, how success is judged and the MVP feature list live in [DIRECTION.md](DIRECTION.md) (Japanese). This file holds the requirements and constraints that the implementation must keep.

## Inputs

agent-timeline only reads files that the agents already write. It does not wrap or launch the agents.

| Agent | Where the session logs are | Notes |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<project slug>/<session id>.jsonl` | One JSON object per line. Lines with `type` `user` / `assistant` carry `message`, `cwd`, `gitBranch`, `timestamp`, `sessionId`; `message.content` is a string or a list of blocks (`text`, `thinking`, `tool_use`, `tool_result`). Other line types (`attachment`, `mode`, `file-history-snapshot`, …) exist. Observed with Claude Code 2.1.289 on 2026-10-04 |
| Codex CLI | `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<timestamp>-<id>.jsonl` | One JSON object per line with `type` and `payload`. `session_meta` carries `cwd` and `git`; `response_item` carries `payload.type` `message` (`role`, `content`), `reasoning`, `custom_tool_call`, `custom_tool_call_output`; `event_msg` carries `task_started` / `task_complete`. Observed on a 2026-10-02 session file |

Both formats are internal to the tools and undocumented, so they can change with any release. The readers must skip lines they do not understand instead of failing, and the format knowledge must stay in one module per agent.

The two root directories must be overridable (environment variables), because the machines that run the tests have no real logs.

## Constraints

- **Localhost only.** The server listens on `127.0.0.1`. There is no login, so anything reachable from another machine would expose every conversation.
- **The reply endpoint types into an agent.** A reply is delivered by sending keys to the tmux pane that runs the session, which makes the endpoint equivalent to running commands on this machine. It must reject requests whose `Origin` / `Host` is not the app's own, so a web page open in the same browser cannot instruct an agent.
- **No server-side storage.** No database and no copy of the logs. The only file the app writes is the usage log `~/.agent-timeline/usage.jsonl` (launch and reply timestamps, never conversation content), which is the measurement source in DIRECTION.md.
- **Nothing leaves the machine.** No analytics, no telemetry, no external requests at runtime.
- **Real session logs never enter the repository.** They contain private code, personal information and secrets. Fixtures and screenshots are made from hand-written synthetic sessions (see `.claude/rules/synthetic-fixtures.md`).

## Infrastructure decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Database / storage | None | The agents' log files are the data |
| Hosting | None; runs from a clone on the user's machine | The data is local and private |
| Authentication | None; bound to `127.0.0.1` with `Origin` / `Host` checks | Single user on their own machine |
| Analytics | The local usage log, plus GitHub stars | No external service fits a tool that must not send data out |
| Alerts (GCP, Crashlytics), billing, store distribution | Not applicable | No cloud project, no mobile app, no payments |

## Verification

How to build, test and check the UI is in [AGENTS.md](../AGENTS.md). The short version: nothing is built or opened in a browser on the development machine; GitHub Actions does it, with synthetic fixtures.
