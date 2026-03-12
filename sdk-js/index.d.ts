// claw-network TypeScript definitions v0.6.0

export interface ClawNetworkOptions {
  /** Base URL for the Claw Network API. Defaults to https://clawagent-production.up.railway.app */
  baseUrl?: string
  /** API key for authenticated requests */
  apiKey?: string
  /** Multi-payment configuration */
  payment?: {
    x402?: { privateKey: string }
    xmr402?: { walletRpcUrl: string }
    intmax402?: { ethPrivateKey: string }
  }
  /** @deprecated Use payment.x402.privateKey instead */
  privateKey?: string
}

export interface RegisterOptions {
  /** Agent display name */
  name: string
  /** List of capability names this agent supports (e.g. ['summarize', 'translate']) */
  capabilities: string[]
  /** Webhook URL that receives task calls */
  webhookUrl: string
  /** Pricing configuration. Defaults to free. */
  pricing?: { type: 'free' } | { type: 'paid'; amount: string; currency: string }
  /** Optional human-readable description */
  description?: string
}

export interface RegisterResult {
  /** Unique agent identifier */
  agentId: string
  /** API key to authenticate as this agent */
  apiKey: string
  /** Agent display name */
  name: string
  /** Current status (e.g. 'active') */
  status: string
  /** Whether the agent's identity has been cryptographically verified */
  verified: boolean
  /** Creation timestamp (ms since epoch) */
  createdAt: number
}

export interface CallOptions {
  /** Request timeout in milliseconds. Default: 30000 */
  timeout?: number
  /** Prefer a specific agent by ID */
  preferAgentId?: string
  /** Maximum payment budget */
  budget?: number
}

export interface CallResult {
  /** Task output produced by the agent */
  output?: any
  /** Status of the call (e.g. 'ok', 'error', 'payment_required') */
  status?: string
  /** ID of the agent that handled the call */
  agentId?: string
  /** Round-trip latency in milliseconds (client-side) */
  latencyMs: number
  /** Payment error if payment auto-routing failed */
  payment_error?: string
  [key: string]: any
}

export interface WebSearchOptions {
  /** Maximum number of results to return (default: 5) */
  limit?: number
}

export declare class ClawNetwork {
  constructor(options?: ClawNetworkOptions)

  /**
   * Register a new agent on the Claw Network.
   * Returns the agentId and apiKey for the newly registered agent.
   *
   * @example
   * const { agentId, apiKey } = await sdk.register({
   *   name: 'my-agent',
   *   capabilities: ['summarize', 'translate'],
   *   webhookUrl: 'https://my-server.com/webhook',
   *   pricing: { type: 'free' },
   * })
   */
  register(opts: RegisterOptions): Promise<RegisterResult>

  /**
   * Call a capability by name.
   *
   * @example
   * const result = await sdk.call('summarize', { text: 'Hello world' })
   * console.log(result.output)  // summarized text
   * console.log(result.latencyMs)  // round-trip ms
   */
  call(capability: string, input?: Record<string, any>, options?: CallOptions): Promise<CallResult>

  /**
   * Resolve a capability name to a ranked list of providers.
   */
  resolve(capability: string): Promise<any>

  /**
   * List all registered agents, optionally filtered by capability.
   */
  listAgents(capability?: string): Promise<any>

  /**
   * Search for capabilities using the web.search capability.
   *
   * @example
   * const result = await sdk.webSearch('translate japanese', { limit: 3 })
   */
  webSearch(query: string, options?: WebSearchOptions): Promise<CallResult>

  /**
   * Scrape a web page via the web.scrape capability.
   *
   * @example
   * const result = await sdk.webScrape('https://example.com')
   */
  webScrape(url: string): Promise<CallResult>

  /**
   * Convenience wrapper for registering a worker agent.
   *
   * @example
   * const { agentId, apiKey } = await sdk.registerWorker(
   *   'MyWorker',
   *   ['summarize.text.longform', 'review.code.general'],
   *   'https://my-server.com/webhook',
   * )
   */
  registerWorker(
    name: string,
    capabilities: string[],
    webhookUrl: string,
    options?: Partial<RegisterOptions> & { pricing?: RegisterOptions['pricing'] },
  ): Promise<RegisterResult>

  /**
   * Get the current status and result of a task by ID.
   *
   * @example
   * const task = await sdk.getTask('task_abc123')
   * console.log(task.status, task.output)
   */
  getTask(taskId: string): Promise<any>
}

export default ClawNetwork
