import type {
  CloudAgent,
  CloudApiError,
  CloudPrompt,
  DeleteAgentResponse,
  FollowupResponse,
  GetAgentResponse,
  GetConversationResponse,
  LaunchAgentRequest,
  LaunchAgentResponse,
  ListAgentsResponse,
  ListModelsResponse,
  MeResponse,
  StopAgentResponse,
} from "./types.js";

const BASE_URL = "https://api.cursor.com";

export class CloudClient {
  private authHeader: string;

  constructor(apiKey: string) {
    this.authHeader = `Basic ${btoa(apiKey + ":")}`;
  }

  async launchAgent(req: LaunchAgentRequest): Promise<LaunchAgentResponse> {
    return this.request<LaunchAgentResponse>("POST", "/v1/agents", req);
  }

  async getAgent(id: string): Promise<GetAgentResponse> {
    return this.request<GetAgentResponse>("GET", `/v1/agents/${encodeURIComponent(id)}`);
  }

  async listAgents(params?: { limit?: number; cursor?: string }): Promise<ListAgentsResponse> {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.cursor) search.set("cursor", params.cursor);
    const qs = search.toString();
    return this.request<ListAgentsResponse>("GET", `/v1/agents${qs ? `?${qs}` : ""}`);
  }

  async getConversation(id: string): Promise<GetConversationResponse> {
    return this.request<GetConversationResponse>(
      "GET",
      `/v1/agents/${encodeURIComponent(id)}/conversation`,
    );
  }

  async followup(id: string, prompt: CloudPrompt): Promise<FollowupResponse> {
    return this.request<FollowupResponse>(
      "POST",
      `/v1/agents/${encodeURIComponent(id)}/followup`,
      prompt,
    );
  }

  async stopAgent(id: string): Promise<StopAgentResponse> {
    return this.request<StopAgentResponse>(
      "POST",
      `/v1/agents/${encodeURIComponent(id)}/stop`,
    );
  }

  async deleteAgent(id: string): Promise<DeleteAgentResponse> {
    return this.request<DeleteAgentResponse>(
      "DELETE",
      `/v1/agents/${encodeURIComponent(id)}`,
    );
  }

  async listModels(): Promise<ListModelsResponse> {
    return this.request<ListModelsResponse>("GET", "/v1/models");
  }

  async me(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/v1/me");
  }

  /** Launch multiple cloud agents in parallel. Returns results with errors captured per-agent. */
  async launchAgents(
    requests: LaunchAgentRequest[],
  ): Promise<Array<{ request: LaunchAgentRequest; agent?: CloudAgent; error?: string }>> {
    const results = await Promise.allSettled(
      requests.map((req) => this.launchAgent(req)),
    );

    return results.map((result, i) => {
      if (result.status === "fulfilled") {
        return { request: requests[i], agent: result.value };
      }
      return {
        request: requests[i],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    });
  }

  async pollUntilDone(
    id: string,
    intervalMs = 5000,
    signal?: AbortSignal,
  ): Promise<GetAgentResponse> {
    while (true) {
      if (signal?.aborted) {
        throw new Error("Polling aborted");
      }
      const agent = await this.getAgent(id);
      if (agent.status === "FINISHED" || agent.status === "ERROR" || agent.status === "EXPIRED") {
        return agent;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("Polling aborted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let message = res.statusText;
      try {
        const errBody = await res.json() as { message?: string };
        if (errBody.message) message = errBody.message;
      } catch { /* use statusText */ }
      const err: CloudApiError = { status: res.status, message };
      throw Object.assign(new Error(`Cloud API error: ${res.status} ${message}`), { apiError: err });
    }

    return (await res.json()) as T;
  }
}

/**
 * Returns a CloudClient if CURSOR_API_KEY env var is set, null otherwise.
 */
export function getCloudClient(): CloudClient | null {
  const key = process.env.CURSOR_API_KEY;
  if (!key) return null;
  return new CloudClient(key);
}
