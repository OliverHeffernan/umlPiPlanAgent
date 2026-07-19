export type PlanPhase = "idea" | "implementation";

const UML_FENCE =
	/```mermaid\s*\n\s*(classDiagram|stateDiagram(?:-v2)?)(?:\s|\n)/i;
const ANY_MERMAID_FENCE = /```mermaid\b/i;

export function validatePlan(markdown: string, phase: PlanPhase): string[] {
	const errors: string[] = [];
	if (!markdown.trim()) errors.push("The plan cannot be empty.");
	if (Buffer.byteLength(markdown, "utf8") > 200_000)
		errors.push("The plan exceeds 200 KB.");
	if (!/^#\s+\S/m.test(markdown))
		errors.push("The plan needs a level-one title.");

	if (phase === "idea" && ANY_MERMAID_FENCE.test(markdown)) {
		errors.push(
			"Idea exploration must not contain diagrams yet. Move to implementation phase first.",
		);
	}
	if (phase === "implementation" && !UML_FENCE.test(markdown)) {
		errors.push(
			"Implementation plans require a Mermaid classDiagram or stateDiagram-v2 block.",
		);
	}
	return errors;
}

export function countUmlDiagrams(markdown: string): number {
	return [
		...markdown.matchAll(
			/```mermaid\s*\n\s*(?:classDiagram|stateDiagram(?:-v2)?)(?:\s|\n)/gi,
		),
	].length;
}
