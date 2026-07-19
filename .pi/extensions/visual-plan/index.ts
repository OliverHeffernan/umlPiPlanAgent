import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { countUmlDiagrams, type PlanPhase, validatePlan } from "./plan-format.ts";
import { startPlanServer, type PlanServer } from "./server.ts";
import { genInstructions } from "./instructions.ts";

const TOOL_NAME = "visual_plan_write";
const BLOCKED_TOOLS = new Set(["edit", "write", "bash"]);
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

interface PersistedState { enabled?: boolean; phase?: PlanPhase }
interface PlanWriteDetails { path: string; phase: PlanPhase; diagrams: number; url?: string }

const planWriteSchema = Type.Object({
	phase: StringEnum(["idea", "implementation"] as const, { description: "Current maturity of the plan" }),
	markdown: Type.String({ description: "Complete replacement Markdown document" }),
});

export default function visualPlanExtension(pi: ExtensionAPI): void {
	let enabled = false;
	let phase: PlanPhase = "idea";
	let toolsBeforePlanning: string[] | undefined;
	let viewer: PlanServer | undefined;
	let planPath = "";

	pi.registerFlag("visual-plan", {
		description: "Start in UML-first visual planning mode",
		type: "boolean",
		default: false,
	});

	function persist(): void {
		pi.appendEntry("visual-plan-state", { enabled, phase } satisfies PersistedState);
	}

	function setUi(ctx: ExtensionContext): void {
		if (!enabled) {
			ctx.ui.setStatus("visual-plan", undefined);
			ctx.ui.setWidget("visual-plan", undefined);
			return;
		}
		const label = phase === "idea" ? "idea discovery" : "UML implementation plan";
		ctx.ui.setStatus("visual-plan", ctx.ui.theme.fg("accent", `◇ plan · ${label}`));
		ctx.ui.setWidget("visual-plan", [
			ctx.ui.theme.fg("accent", `Visual planning: ${label}`),
			ctx.ui.theme.fg("muted", `${planPath}${viewer ? ` · ${viewer.url}` : ""}`),
		], { placement: "belowEditor" });
	}

	function applyToolMode(): void {
		if (enabled) {
			if (!toolsBeforePlanning) toolsBeforePlanning = pi.getActiveTools().filter((name) => name !== TOOL_NAME);
			const safe = toolsBeforePlanning.filter((name) => !BLOCKED_TOOLS.has(name));
			pi.setActiveTools([...new Set([...safe, TOOL_NAME, "read", "grep", "find", "ls"])]);
		} else {
			pi.setActiveTools(toolsBeforePlanning ?? pi.getActiveTools().filter((name) => name !== TOOL_NAME));
			toolsBeforePlanning = undefined;
		}
	}

	function setEnabled(next: boolean, ctx: ExtensionContext): void {
		enabled = next;
		applyToolMode();
		setUi(ctx);
		persist();
		ctx.ui.notify(next
			? `Visual planning enabled. Code mutation tools are disabled. Viewer: ${viewer?.url ?? "starting…"}`
			: "Visual planning disabled. Previous tools restored.", "info");
	}

	async function openViewer(ctx: ExtensionContext): Promise<void> {
		if (!viewer) { ctx.ui.notify("Plan viewer is not running.", "error"); return; }
		const command = process.platform === "darwin" ? ["open", [viewer.url]] as const
			: process.platform === "win32" ? ["cmd", ["/c", "start", "", viewer.url]] as const
				: ["xdg-open", [viewer.url]] as const;
		const result = await pi.exec(command[0], [...command[1]], { timeout: 5_000 });
		if (result.code !== 0) ctx.ui.notify(`Open ${viewer.url} manually.`, "warning");
	}

	pi.registerTool<typeof planWriteSchema, PlanWriteDetails>({
		name: TOOL_NAME,
		label: "Visual Plan",
		description: "Replace the project visual-plan Markdown file. Idea phase forbids diagrams; implementation phase requires Mermaid UML classDiagram or stateDiagram-v2. Output is limited to 200 KB.",
		promptSnippet: "Write the staged Markdown plan rendered by the localhost UML viewer",
		promptGuidelines: [
			"Use visual_plan_write only while visual planning mode is active.",
			"Use visual_plan_write with phase idea while requirements are still being explored, without diagrams.",
			"Once implementation design begins, use visual_plan_write with phase implementation and include Mermaid classDiagram and/or stateDiagram-v2 UML blocks.",
		],
		parameters: planWriteSchema,
		async execute(_id, params, signal, onUpdate, ctx) {
			if (!enabled) throw new Error("Visual planning mode is not active. Run /visual-plan on first.");
			if (signal?.aborted) throw new Error("Plan update cancelled.");
			const errors = validatePlan(params.markdown, params.phase);
			if (errors.length) throw new Error(errors.join(" "));
			onUpdate?.({ content: [{ type: "text", text: "Updating the visual plan…" }], details: { path: planPath, phase: params.phase, diagrams: 0, url: viewer?.url } });

			await withFileMutationQueue(planPath, async () => {
				await mkdir(dirname(planPath), { recursive: true });
				const temporary = `${planPath}.${process.pid}.tmp`;
				await writeFile(temporary, params.markdown.endsWith("\n") ? params.markdown : `${params.markdown}\n`, "utf8");
				await rename(temporary, planPath);
			});
			phase = params.phase;
			persist();
			setUi(ctx);
			viewer?.notifyChanged();
			return {
				content: [{ type: "text", text: `Saved ${planPath} (${countUmlDiagrams(params.markdown)} UML diagram(s)). Viewer: ${viewer?.url ?? "unavailable"}` }],
				details: { path: planPath, phase, diagrams: countUmlDiagrams(params.markdown), url: viewer?.url },
			};
		},
	});

	pi.registerCommand("visual-plan", {
		description: "UML-first plan mode: on, off, open, status, or execute",
		getArgumentCompletions: (prefix) => ["on", "off", "open", "status", "execute"]
			.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase() || (enabled ? "off" : "on");
			if (action === "on") setEnabled(true, ctx);
			else if (action === "off") setEnabled(false, ctx);
			else if (action === "open") await openViewer(ctx);
			else if (action === "status") ctx.ui.notify(`${enabled ? "Active" : "Inactive"} · ${phase} · ${planPath} · ${viewer?.url ?? "viewer stopped"}`, "info");
			else if (action === "execute") {
				let markdown = "";
				try { markdown = await readFile(planPath, "utf8"); } catch { /* handled by validation */ }
				const errors = validatePlan(markdown, "implementation");
				if (errors.length) { ctx.ui.notify(`Cannot execute: ${errors.join(" ")}`, "error"); return; }
				setEnabled(false, ctx);
				pi.sendUserMessage(`Execute the approved implementation plan in ${planPath}. Follow its UML design and implementation steps. Keep the plan file as the source of truth.`);
			} else ctx.ui.notify("Usage: /visual-plan [on|off|open|status|execute]", "warning");
		},
	});

	pi.on("tool_call", (event) => {
		if (enabled && BLOCKED_TOOLS.has(event.toolName)) {
			return { block: true, reason: `Visual planning mode blocks ${event.toolName}. Use ${TOOL_NAME} for the plan, or /visual-plan off.` };
		}
	});

	pi.on("before_agent_start", (event) => {
		if (!enabled) return;
		const instructions = genInstructions(TOOL_NAME, planPath, viewer, phase);
		return { systemPrompt: `${event.systemPrompt}\n\n${instructions}` };
	});

	pi.on("session_start", async (_event, ctx) => {
		planPath = join(ctx.cwd, CONFIG_DIR_NAME, "plans", "plan.md");
		enabled = pi.getFlag("visual-plan") === true;
		const saved = ctx.sessionManager.getEntries()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === "visual-plan-state")
			.pop() as { data?: PersistedState } | undefined;
		if (saved?.data) { enabled = saved.data.enabled ?? enabled; phase = saved.data.phase ?? phase; }

		const configuredPort = Number.parseInt(process.env.PI_VISUAL_PLAN_PORT ?? "4317", 10);
		try {
			viewer = await startPlanServer({ planPath, extensionDir: EXTENSION_DIR, port: Number.isFinite(configuredPort) ? configuredPort : 4317 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EADDRINUSE" && !process.env.PI_VISUAL_PLAN_PORT) {
				viewer = await startPlanServer({ planPath, extensionDir: EXTENSION_DIR, port: 0 });
			} else ctx.ui.notify(`Visual plan viewer failed: ${String(error)}`, "error");
		}
		applyToolMode();
		setUi(ctx);
	});

	pi.on("session_shutdown", async () => {
		const current = viewer; viewer = undefined;
		if (current) await current.close();
	});
}
