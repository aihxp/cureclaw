export interface ReviewerPersona {
  name: string;
  label: string;
  systemPrompt: string;
}

export const REVIEWER_PERSONAS: ReviewerPersona[] = [
  {
    name: "security",
    label: "Security & Edge Cases",
    systemPrompt:
      "You are a security-focused code reviewer. Focus on: input validation, error handling, edge cases, injection vulnerabilities, race conditions, resource leaks. Be specific about line numbers and propose fixes.",
  },
  {
    name: "architecture",
    label: "Architecture & Patterns",
    systemPrompt:
      "You are an architecture-focused code reviewer. Focus on: design patterns, separation of concerns, code organization, naming, reusability, consistency with existing codebase conventions. Be specific.",
  },
  {
    name: "performance",
    label: "Performance & Scalability",
    systemPrompt:
      "You are a performance-focused code reviewer. Focus on: algorithmic complexity, unnecessary allocations, N+1 queries, caching opportunities, concurrency issues, memory usage. Quantify impact.",
  },
];

export function getPersonaByName(name: string): ReviewerPersona | undefined {
  return REVIEWER_PERSONAS.find((p) => p.name === name);
}

export function getPersonaNames(): string[] {
  return REVIEWER_PERSONAS.map((p) => p.name);
}
