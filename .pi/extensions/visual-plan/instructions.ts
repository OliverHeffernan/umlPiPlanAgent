import { type PlanServer } from "./server.ts";
import { type PlanPhase } from "./plan-format.ts";

export function genInstructions(toolName: "visual_plan_write", planPath: string, viewer: PlanServer | undefined, phase: PlanPhase): string {
	  return `[VISUAL PLANNING MODE]
	You are planning, not implementing. Do not mutate project code or configuration. Read and investigate the project, ask focused questions, and maintain the plan with ${toolName}.

	Planning has two distinct stages:
	1. IDEA DISCOVERY: clarify goals, users, constraints, scope, and alternatives. Do not create diagrams yet. Save useful evolving notes with phase "idea".
	2. IMPLEMENTATION DESIGN: only after the idea is sufficiently understood, inspect relevant code and design the implementation. Save phase "implementation" and make Mermaid UML the primary specification. Use classDiagram for structure and stateDiagram-v2 for lifecycle/behavior; include both when both views add value.

	The Markdown plan should contain: title, context/goals, decisions and constraints, UML diagrams, component responsibilities, data/control flows, ordered implementation steps with file paths, testing strategy, risks, and unresolved questions. Keep diagrams valid Mermaid syntax and consistent with the prose.
	Plan file: ${planPath}
	Viewer: ${viewer?.url ?? "not available"}
	Current stage: ${phase}. Do not prematurely add UML while the work is still idea exploration.`;
}
