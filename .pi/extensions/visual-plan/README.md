# Pi Visual Plan

A project-local pi extension that separates idea discovery from implementation design, writes the plan to Markdown, and renders Mermaid UML on a live localhost site.

## Install

Install for your user account:

```bash
pi install npm:pi-visual-plan
```

Or try it for one run without installing:

```bash
pi -e npm:pi-visual-plan
```

To share it through project settings, install it locally with `pi install -l npm:pi-visual-plan`. Pi installs the package after collaborators trust the project.

Update or remove it with:

```bash
pi update npm:pi-visual-plan
pi remove npm:pi-visual-plan
```

For local development, clone the repository, run `npm install` in `.pi/extensions/visual-plan/`, and use `/reload` after changing extension code.

## Commands

- `/visual-plan on` — enter read-only planning mode
- `/visual-plan off` — leave planning mode and restore tools
- `/visual-plan open` — open the localhost viewer
- `/visual-plan status` — show phase, file, and URL
- `/visual-plan execute` — validate and begin an approved implementation plan
- `/visual-plan` — toggle the mode

Start directly with `pi --visual-plan`. The default viewer is `http://127.0.0.1:4317`; set `PI_VISUAL_PLAN_PORT` to choose another port. If the default is occupied, the extension chooses a free port.

## Workflow

1. Enable the mode and discuss the product idea. The agent records prose only.
2. Once goals and constraints are understood, the agent moves to implementation design.
3. The implementation plan must contain Mermaid `classDiagram` and/or `stateDiagram-v2` fenced blocks.
4. Open the live viewer. It refreshes when `.pi/plans/plan.md` changes.
5. Review the plan and run `/visual-plan execute` when approved.

Planning mode disables pi's `edit`, `write`, and `bash` tools. Its dedicated `visual_plan_write` tool can only replace the plan file and validates stage rules before writing.

## Mermaid example

````markdown
```mermaid
classDiagram
  PlanMode --> PlanRepository
  PlanRepository --> ViewerServer
```

```mermaid
stateDiagram-v2
  [*] --> Idea
  Idea --> Implementation: requirements understood
  Implementation --> Approved
  Approved --> Executing
```
````

The viewer serves only on `127.0.0.1`, uses local npm assets (no CDN), disables raw HTML in Markdown, and configures Mermaid's strict security mode.
