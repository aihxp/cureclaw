// ============================================================================
// Cloud Agent API types (api.cursor.com)
// ============================================================================

export type CloudAgentStatus = "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "EXPIRED";

export interface CloudPrompt {
  text: string;
  images?: Array<{ data: string; dimensions?: { width: number; height: number } }>;
}

export interface CloudSource {
  repository?: string;
  ref?: string;
  prUrl?: string;
}

export interface CloudTarget {
  autoCreatePr?: boolean;
  openAsCursorGithubApp?: boolean;
  autoBranch?: boolean;
  branchName?: string;
}

export interface CloudWebhook {
  url: string;
  secret?: string;
}

export interface LaunchAgentRequest {
  prompt: CloudPrompt;
  model?: string;
  source: CloudSource;
  target?: CloudTarget;
  webhook?: CloudWebhook;
}

export interface CloudAgent {
  id: string;
  name: string;
  status: CloudAgentStatus;
  source: CloudSource;
  target?: CloudTarget;
  summary?: string;
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  type: "user_message" | "assistant_message";
  text: string;
}

export type LaunchAgentResponse = CloudAgent;
export type GetAgentResponse = CloudAgent;
export interface ListAgentsResponse { agents: CloudAgent[]; nextCursor?: string; }
export interface GetConversationResponse { messages: ConversationMessage[]; }
export interface FollowupResponse { id: string; }
export interface StopAgentResponse { id: string; }
export interface DeleteAgentResponse { id: string; }
export interface ListModelsResponse { models: string[]; }
export interface MeResponse { apiKeyName: string; createdAt: string; userEmail: string; }
export interface CloudApiError { status: number; message: string; }
