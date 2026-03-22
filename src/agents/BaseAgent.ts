import { createAgentLogger } from '../utils/logger.js';
import type { ReasoningEntry, AgentDecision } from './types.js';

/**
 * BaseAgent — abstract base for all AI agents in the syndicate.
 * 
 * Each agent has a name, role description, and maintains a reasoning log.
 * The reasoning log provides transparency into agent decision-making,
 * which is a core requirement for the hackathon.
 */
export abstract class BaseAgent {
    public readonly name: string;
    public readonly role: string;
    protected reasoningLog: ReasoningEntry[] = [];
    protected logger;

    constructor(name: string, role: string) {
        this.name = name;
        this.role = role;
        this.logger = createAgentLogger(name);
    }

    /**
     * Core analysis method — implemented by each agent type.
     */
    abstract analyze(context: Record<string, unknown>): Promise<AgentDecision>;

    /**
     * Add a reasoning entry to the agent's log.
     */
    public addReasoning(message: string, data?: Record<string, unknown>): void {
        const entry: ReasoningEntry = {
            timestamp: new Date().toISOString(),
            agent: this.name,
            message,
            data,
        };
        this.reasoningLog.push(entry);
        this.logger.info(`💭 ${message}`, data || {});
    }

    /**
     * Get all reasoning entries.
     */
    getReasoningLog(): ReasoningEntry[] {
        return [...this.reasoningLog];
    }

    /**
     * Clear reasoning log (for new pipeline run).
     */
    clearReasoningLog(): void {
        this.reasoningLog = [];
    }

    /**
     * Get a formatted reasoning summary.
     */
    getReasoningSummary(): string {
        return this.reasoningLog
            .map(r => `[${r.timestamp}] ${r.agent}: ${r.message}`)
            .join('\n');
    }
}
