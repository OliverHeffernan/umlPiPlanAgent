import assert from "node:assert/strict";
import test from "node:test";
import { countUmlDiagrams, validatePlan } from "../plan-format.ts";

test("idea plans reject premature diagrams", () => {
  const plan = "# Product idea\n\n```mermaid\nclassDiagram\nA --> B\n```\n";
  assert.match(validatePlan(plan, "idea").join(" "), /must not contain diagrams/);
});

test("implementation plans require class or state UML", () => {
  assert.match(validatePlan("# Plan\n\nNo diagram yet.", "implementation").join(" "), /require/);
  assert.deepEqual(validatePlan("# Plan\n\n```mermaid\nstateDiagram-v2\n[*] --> Ready\n```", "implementation"), []);
});

test("counts supported UML diagrams", () => {
  const plan = "# Plan\n```mermaid\nclassDiagram\nclass A\n```\n```mermaid\nstateDiagram-v2\n[*] --> A\n```";
  assert.equal(countUmlDiagrams(plan), 2);
});
