import { ChatService } from '$lib/services/chat.service';
import { getApiProvider } from '$lib/services/providers';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { chatStore } from '$lib/stores/chat.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { config } from '$lib/stores/settings.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import type { McpServerOverride } from '$lib/types';
import { connectionProtocol } from '$lib/services/providers/provider-capabilities';

export interface ProviderSource {
	providerId: string;
	serverBaseUrl: string;
	apiKey: string;
	protocol?: import('$lib/types/provider').ProviderProtocol;
}

class SourceLifecycleService {
	private generation = 0;

	private isCurrent(source: ProviderSource, generation: number): boolean {
		if (generation !== this.generation) return false;
		const currentConfig = config();

		return (
			getApiProvider(String(currentConfig.apiProvider ?? '')).id === source.providerId &&
			String(currentConfig.serverBaseUrl ?? '') === source.serverBaseUrl &&
			String(currentConfig.apiKey ?? '') === source.apiKey &&
			(source.protocol ?? 'chat-completions') ===
				connectionProtocol(source.providerId, currentConfig)
		);
	}

	async switchSource(source: ProviderSource, mcpOverrides: McpServerOverride[]): Promise<void> {
		const generation = ++this.generation;
		agenticStore.abortActiveSourceOperations();
		chatStore.handleProviderSourceSwitch();
		toolsStore.clear();

		const shutdown = mcpStore.shutdown();
		const proxyProbe = this.isCurrent(source, generation)
			? mcpStore.probeProxy()
			: Promise.resolve();
		const builtinTools = this.isCurrent(source, generation)
			? toolsStore.fetchBuiltinTools(ChatService.createProviderRequestContext())
			: Promise.resolve();

		await shutdown;
		await proxyProbe;
		if (this.isCurrent(source, generation)) {
			await mcpStore.ensureInitialized(mcpOverrides);
		}
		await builtinTools;
	}
}

export const sourceLifecycleService = new SourceLifecycleService();
