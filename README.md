# planningAgent

This project contains [`Pi Visual Plan`](.pi/extensions/visual-plan/README.md), a pi extension for staged planning with live Mermaid UML diagrams.

## Quick start

```bash
cd .pi/extensions/visual-plan
npm install
cd ../../..
pi
```

In pi, run:

```text
/visual-plan on
```

Discuss the idea first. Once implementation design begins, pi writes Mermaid class/state UML into `.pi/plans/plan.md`. Run `/visual-plan open` for the live localhost view and `/visual-plan execute` after approval.
