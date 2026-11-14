import * as Crypto from "expo-crypto";
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

/** The organization every request is in: the API addresses an install's only one as `default`. */
export const ORGANIZATION = "/api/v2/organizations/default";

/**
 * A key for one write, so a retry of the same write is recognised as the same one. Every write to
 * the API carries one in an `Idempotency-Key` header. From expo-crypto's random bytes, which every
 * device has, as the web app makes its keys from `getRandomValues` rather than `randomUUID`.
 */
export function idempotencyKey(): string {
  return Array.from(Crypto.getRandomBytes(16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function api<T>(
  path: string,
  input?: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
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
/** A Bot as the API's `listBots` and `getBot` return it, in the fields this app reads. */
export type Bot = {
  id: string;
  name: string;
  title?: string;
  roleDescription?: string;
  mine: boolean;
  canManage: boolean;
};
/** The person's own state with a Bot, as the API's `getBotLifecycle` returns it. */
export type BotLifecycle = {
  botId: string;
  paused: boolean;
  pausedAt: string | null;
};

/**
 * Every Bot this person can reach, read page by page to the end. A repeated cursor ends the list
 * too, so a server that hands back the cursor it was given can't loop it.
 */
export async function everyBot(): Promise<Bot[]> {
  const bots: Bot[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page: { bots: Bot[]; nextCursor: string | null } = await api(
      `${ORGANIZATION}/bots?limit=100${query}`,
    );
    bots.push(...page.bots);
    if (cursor) seen.add(cursor);
    cursor = page.nextCursor;
  } while (cursor && !seen.has(cursor));
  return bots;
}

/** One Bot's address in the API. */
export function botPath(botId: string): string {
  return `${ORGANIZATION}/bots/${encodeURIComponent(botId)}`;
}
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
