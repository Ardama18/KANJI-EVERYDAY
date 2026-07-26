# Repository agent instructions

## Project guidance

- Start with `.claude/steering/rules-index.yaml` and load the steering documents matching the files and risks being changed.
- Treat `.claude/steering/project-context.md`, Accepted ADRs, and the target Story artifacts as project-specific sources of truth.
- Use `frontend/package.json` to determine available scripts and dependency versions. Do not assume npm workspaces, NestJS, Prisma, Jest, Playwright, or AWS CDK exist.
- Keep `.claude/rules/` as concise entry points; detailed project conventions belong in `.claude/steering/`.

## GitHub access from the Codex sandbox

- Prefer the GitHub Connector/MCP tools for issue, pull request, and comment API operations.
- When the GitHub CLI is required, do not invoke a bare `gh` command from the Codex sandbox. Prefix it with the non-interactive pager setting: `GH_PAGER=cat gh ...`.
- If a bare `gh` call reports `error connecting to api.github.com` or a DNS resolution error, do not retry it three times. Switch immediately to the Connector or the prefixed command.
- This workaround applies to Codex sandbox commands only; developers can continue using normal `gh` commands in their local terminal.
