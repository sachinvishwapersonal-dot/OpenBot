import { authClient, serverUrl } from "./auth";
/** A refusal from the server, with its status and the API's problem code when it gave one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  input?: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    /**
     * A write to the API (`/api/v2`): sent with an Idempotency-Key made for it, which every write
     * there takes, so a retry of the same write is recognised as the same one.
     */
    once?: boolean;
  },
): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error("Use an OpenBot API path.");
  const cookie = await authClient.getCookie();
  const response = await fetch(`${serverUrl}${path}`, {
    method: input?.method,
    credentials: "omit",
    headers: {
      ...input?.headers,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(input?.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(input?.once ? { "Idempotency-Key": idempotencyKey() } : {}),
    },
    ...(input?.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    signal: input?.signal,
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json();
  if (!response.ok) {
    // Today's routes say why in `error`; the API's problems in `detail`.
    const said =
      body && typeof body === "object"
        ? (("detail" in body && typeof body.detail === "string"
            ? body.detail
            : undefined) ??
          ("error" in body && typeof body.error === "string"
            ? body.error
            : undefined))
        : undefined;
    const code =
      body &&
      typeof body === "object" &&
      "code" in body &&
      typeof body.code === "string"
        ? body.code
        : undefined;
    throw new ApiError(
      said ?? `Request failed (${response.status}).`,
      response.status,
      code,
    );
  }
  return body as T;
}
/** A key for one write. Only ever compared with itself, so it need not be unguessable. */
function idempotencyKey(): string {
  const part = () => Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${part()}${part()}`;
}
/** The organization every request is in, and the person asking, as the API addresses them. */
const ORGANIZATION = "/api/v2/organizations/default";
const ME = `${ORGANIZATION}/people/me`;
/** Where one of the person's approvals is decided. */
export const approvalDecisionPath = (id: string) =>
  `${ME}/approvals/${encodeURIComponent(id)}/decide`;
/** Where one of the questions a Bot asked the person is answered. */
export const questionResponsePath = (id: string) =>
  `${ME}/questions/${encodeURIComponent(id)}/respond`;
export const APPROVAL_PREFERENCES_PATH = `${ME}/approval-preferences`;
export const APPROVAL_RULES_PATH = `${ME}/approval-rules`;
export const approvalRulePath = (id: string) =>
  `${APPROVAL_RULES_PATH}/${encodeURIComponent(id)}`;
/** Every page of one of the API's lists, which answers its items under `name`. */
async function everyPage<T>(path: string, name: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page: Record<string, unknown> & { nextCursor: string | null } =
      await api(
        `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
    items.push(...((page[name] as T[] | undefined) ?? []));
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}
/** What waits on the person: the actions their Bots asked about, and the questions they asked. */
export async function loadApprovalInbox(): Promise<ApprovalInbox> {
  const [requests, questions] = await Promise.all([
    everyPage<ApprovalInbox["requests"][number]>(
      `${ME}/approvals`,
      "approvals",
    ),
    everyPage<NonNullable<ApprovalInbox["questions"]>[number]>(
      `${ME}/questions`,
      "questions",
    ),
  ]);
  return { requests, questions };
}
/** The person's own approval preferences and rules, with what the organization set for everybody. */
export async function loadApprovalSettings(): Promise<ApprovalSettings> {
  const [preferences, rules, team, teamRules] = await Promise.all([
    api<{ enabled: boolean; autoReview: boolean }>(APPROVAL_PREFERENCES_PATH),
    everyPage<ApprovalRule>(APPROVAL_RULES_PATH, "approvalRules"),
    api<{ enforceAutoReview: boolean; customRulesEnabled: boolean }>(
      `${ORGANIZATION}/approval-settings`,
    ),
    everyPage<ApprovalRule>(`${ORGANIZATION}/approval-rules`, "approvalRules"),
  ]);
  return {
    enabled: preferences.enabled,
    rules,
    teamRules,
    preferences: {
      enabled: preferences.enabled,
      autoReview: preferences.autoReview,
    },
    team: {
      enforceAutoReview: team.enforceAutoReview,
      customRulesEnabled: team.customRulesEnabled,
    },
  };
}
export type Conversation = {
  id: string;
  name: string;
  agentIds: string[];
  active: boolean;
};
export type TranscriptMessage = {
  id: string;
  role: string;
  content?: string | unknown[];
  toolCalls?: unknown[];
};
export type ApprovalInbox = {
  requests: {
    id: string;
    botId?: string;
    toolRef?: string;
    status: string;
    effect?: string;
    scope?: string;
    preview?: unknown;
    action?: {
      botId: string;
      toolRef: string;
      effect: string;
      scope: string;
      args: unknown;
      target?: unknown;
      /** Why it asked. A check-in task's approval (`source` "task") offers no standing rule. */
      policy?: { source: string; reason: string };
    };
  }[];
  questions?: {
    id: string;
    question: string;
    why?: string;
    botId: string;
    channelId?: string;
  }[];
};
/** A Bot as `GET /api/agents` returns it. */
export type Bot = {
  id: string;
  name: string;
  title?: string;
  roleDescription?: string;
  mine: boolean;
  canManage: boolean;
};
export type BotLifecycle = { paused: boolean; pausedAt: string | null };
/**
 * Something a Bot's check-in found that needs the person, as `GET /api/proactive/suggestions` lists
 * it (open ones only). `detail` says why it was raised; `sourceApp` is the app it was read in.
 */
export type CheckInItem = {
  id: string;
  agentId: string;
  title: string;
  detail: string;
  sourceApp: string | null;
  sourceLink: string | null;
  createdAt: string;
};
/** What `POST /api/proactive/suggestions/:id/start` made of an item: a task in its own conversation. */
export type StartedItem = { task: { id: string; channelId: string } };
export type TaskStatus =
  | "needs_input"
  | "working"
  | "resolved"
  | "failed"
  | "ready_for_review";
/** A task started from an item, as `GET /api/tasks` lists it. */
export type BotTask = {
  id: string;
  agentId: string;
  channelId: string;
  title: string;
  status: TaskStatus;
  /** Why its turn couldn't finish, while failed. */
  failure: string | null;
  /** The last thing said in its conversation. */
  next: string | null;
  updatedAt: string;
};
export type RoutineStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "waiting";
export type Routine = {
  id: string;
  agentId: string;
  /** Display text from the server; never parsed here. */
  schedule: string;
  timezone: string;
  instruction: string;
  channel: { id: string; name: string | null; gone: boolean };
  enabled: boolean;
  nextRunAt: string;
  lastRun: { status: RoutineStatus | null; at: string | null } | null;
};
export type RoutineRun = {
  id: string;
  status: RoutineStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};
export type Memory = {
  id: string;
  content: string;
  provenance: string;
  enabled: boolean;
  reviewState: "unreviewed" | "confirmed" | "edited";
  formedBy: "person" | "import" | "bot";
  updatedAt: string;
};
export type RuleBehaviour = "allow" | "pre_approved" | "ask" | "hand_off";
export const BEHAVIOUR_LABELS: Record<RuleBehaviour, string> = {
  allow: "Take action without asking",
  pre_approved: "Take action if pre-approved",
  ask: "Ask before taking action",
  hand_off: "Hand off to you",
};
export type ApprovalRule = {
  id: string;
  botId: string;
  toolRef: string;
  effect: string;
  scope: string;
  behaviour: RuleBehaviour;
};
export type ApprovalSettings = {
  enabled: boolean;
  rules: ApprovalRule[];
  teamRules: ApprovalRule[];
  preferences?: { enabled: boolean; autoReview: boolean };
  team?: { enforceAutoReview: boolean; customRulesEnabled: boolean };
};
export type GrantedPlugins = {
  tools: { ref: string; description: string }[];
  skills: { slug: string; title: string; summary: string }[];
};
export type SkillSummary = { slug: string; title: string; summary: string };
/** Who drives a Bot's computer, as `GET /api/computers/:botId/control` answers. */
export type ControlState = {
  holder: "bot" | "human";
  requested: boolean;
  reason?: string;
  transitioning: boolean;
  request?: { id: string; status: string; reason: string };
  secretWanted?: string;
};
export type Screenshot = {
  base64: string;
  width: number;
  height: number;
  url?: string;
};
