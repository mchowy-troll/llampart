<script lang="ts">
	import { connectionProtocol } from '$lib/services/providers/provider-capabilities';
	import { ChatService } from '$lib/services/chat.service';
	import '../app.css';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import {
		ChatSidebar,
		DialogConversationTitleUpdate,
		DialogChatSettings,
		DialogAboutLlampart
	} from '$lib/components/app';
	import { chatStore, isLoading } from '$lib/stores/chat.svelte';
	import { conversationsStore, activeMessages } from '$lib/stores/conversations.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { isRouterMode, serverStore } from '$lib/stores/server.svelte';
	import { config, settingsStore, SettingsPersistenceError } from '$lib/stores/settings.svelte';
	import { Toaster, toast } from 'svelte-sonner';
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { getApiProvider } from '$lib/services/providers';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { sourceLifecycleService } from '$lib/services/source-lifecycle.service';
	import { TOOLTIP_DELAY_DURATION } from '$lib/constants';
	import type { SettingsSectionTitle } from '$lib/constants';
	import { KeyboardKey } from '$lib/enums';
	import { setChatSettingsDialogContext } from '$lib/contexts';
	import { getThemeDefinition } from '$lib/themes/registry';
	import { applyTheme } from '$lib/themes/runtime';
	import { applyTypography, normalizeUiScalePreset } from '$lib/utils/typography';
	import {
		providerConnectionStatus,
		providerConnectionStore
	} from '$lib/stores/provider-connection.svelte';

	let { children } = $props();

	let isChatRoute = $derived(page.route.id === '/chat/[id]');
	let isHomeRoute = $derived(page.route.id === '/');
	let isNewChatMode = $derived(page.url.searchParams.get('new_chat') === 'true');
	let showSidebarByDefault = $derived(activeMessages().length > 0 || isLoading());
	let alwaysShowSidebarOnDesktop = $derived(config().alwaysShowSidebarOnDesktop);
	let autoShowSidebarOnNewChat = $derived(config().autoShowSidebarOnNewChat);
	let currentApiProvider = $derived(getApiProvider(String(config().apiProvider ?? '')));
	let currentProviderConnectionStatus = $derived(providerConnectionStatus());
	let sidebarOpen = $state(false);
	let innerHeight = $state<number | undefined>();
	let chatSidebar:
		| { activateSearchMode?: () => void; editActiveConversation?: () => void }
		| undefined = $state();

	// Conversation title update dialog state
	let titleUpdateDialogOpen = $state(false);
	let titleUpdateCurrentTitle = $state('');
	let titleUpdateNewTitle = $state('');
	let titleUpdateResolve: ((value: boolean) => void) | null = null;

	let chatSettingsDialogOpen = $state(false);
	let chatSettingsDialogInitialSection = $state<SettingsSectionTitle | undefined>(undefined);
	let activeTheme = $derived(getThemeDefinition(settingsStore.appearanceConfig.theme));
	let themeRuntimeRevision = $state(0);
	let uiScalePreset = $derived(normalizeUiScalePreset(settingsStore.appearanceConfig.uiScale));

	$effect(() => {
		if (!browser) return;

		const handleThemeRuntimeChange = () => {
			themeRuntimeRevision += 1;
		};
		const runtimeEvents = activeTheme.runtimeRefreshEvents ?? [];

		for (const eventName of runtimeEvents) {
			window.addEventListener(eventName, handleThemeRuntimeChange);
		}
		window.addEventListener('storage', handleThemeRuntimeChange);

		return () => {
			for (const eventName of runtimeEvents) {
				window.removeEventListener(eventName, handleThemeRuntimeChange);
			}
			window.removeEventListener('storage', handleThemeRuntimeChange);
		};
	});

	$effect(() => {
		if (!browser) return;

		document.documentElement.dataset.llampartUiScale = uiScalePreset;
	});

	$effect(() => {
		// Match the same committed language used by t(); changing the draft does
		// not translate the UI until Save, so it must not relabel its text either.
		if (browser) document.documentElement.lang = config().interfaceLanguage;
	});

	$effect(() => {
		if (!browser) return;
		return applyTypography(document.documentElement, settingsStore.appearanceConfig);
	});

	$effect(() => {
		if (!browser) return;

		return applyTheme(
			document.documentElement,
			settingsStore.appearanceConfig,
			themeRuntimeRevision
		);
	});

	setChatSettingsDialogContext({
		open: (initialSection?: SettingsSectionTitle) => {
			chatSettingsDialogInitialSection = initialSection;
			chatSettingsDialogOpen = true;
		}
	});

	// Global keyboard shortcuts
	function handleKeydown(event: KeyboardEvent) {
		const isCtrlOrCmd = event.ctrlKey || event.metaKey;

		if (isCtrlOrCmd && event.key === KeyboardKey.K_LOWER) {
			event.preventDefault();
			if (chatSidebar?.activateSearchMode) {
				chatSidebar.activateSearchMode();
				sidebarOpen = true;
			}
		}

		if (isCtrlOrCmd && event.shiftKey && event.key === KeyboardKey.O_UPPER) {
			event.preventDefault();
			goto('?new_chat=true#/');
		}

		if (event.shiftKey && isCtrlOrCmd && event.key === KeyboardKey.E_UPPER) {
			event.preventDefault();

			if (chatSidebar?.editActiveConversation) {
				chatSidebar.editActiveConversation();
			}
		}
	}

	function handleTitleUpdateCancel() {
		titleUpdateDialogOpen = false;
		if (titleUpdateResolve) {
			titleUpdateResolve(false);
			titleUpdateResolve = null;
		}
	}

	function handleTitleUpdateConfirm() {
		titleUpdateDialogOpen = false;
		if (titleUpdateResolve) {
			titleUpdateResolve(true);
			titleUpdateResolve = null;
		}
	}

	$effect(() => {
		if (alwaysShowSidebarOnDesktop) {
			sidebarOpen = true;
			return;
		}

		if (isHomeRoute && !isNewChatMode) {
			// Auto-collapse sidebar when navigating to home route (but not in new chat mode)
			sidebarOpen = false;
		} else if (isHomeRoute && isNewChatMode) {
			// Keep sidebar open in new chat mode
			sidebarOpen = true;
		} else if (isChatRoute) {
			// On chat routes, only auto-show sidebar if setting is enabled
			if (autoShowSidebarOnNewChat) {
				sidebarOpen = true;
			}
			// If setting is disabled, don't change sidebar state - let user control it manually
		} else {
			// Other routes follow default behavior
			sidebarOpen = showSidebarByDefault;
		}
	});

	// Initialize server properties on app load (run once)
	$effect(() => {
		if (!currentApiProvider.capabilities.supportsServerProps) {
			if (serverStore.props) {
				serverStore.clear();
			}

			return;
		}

		// Only fetch if we don't already have props
		if (currentProviderConnectionStatus === 'connected' && !serverStore.props) {
			untrack(() => {
				serverStore.fetch();
			});
		}
	});

	// Sync settings when server props are loaded
	let propsPersistenceErrorNotified: string | undefined;
	$effect(() => {
		const serverProps = serverStore.props;
		if (!serverProps) {
			propsPersistenceErrorNotified = undefined;
			return;
		}
		try {
			settingsStore.syncWithServerDefaults();
			propsPersistenceErrorNotified = undefined;
		} catch (error) {
			if (!(error instanceof SettingsPersistenceError)) throw error;
			// A failed write publishes no config. Notify once until a successful
			// sync (or a new source), without making notification reads dependencies.
			const messageKey = error.rollbackErrors.length
				? error.messageKey
				: 'settings.propsSyncStorageError';
			if (propsPersistenceErrorNotified !== messageKey) {
				propsPersistenceErrorNotified = messageKey;
				untrack(() => toast.error(t(messageKey), { id: 'settings-props-persistence' }));
			}
		}
	});

	$effect(() => {
		const isRouter = isRouterMode();
		const modelsCount = modelsStore.models.length;
		const hasCurrentMetadata = modelsStore.hasRouterMetadataForCurrentSource;

		if (
			currentApiProvider.capabilities.supportsModelLoadUnload &&
			isRouter &&
			modelsCount > 0 &&
			!hasCurrentMetadata
		) {
			untrack(() => {
				modelsStore.fetchRouterModels().catch((error) => {
					console.error('Unable to load router model metadata:', error);
				});
			});
		}
	});

	// Background MCP server health checks on app load
	// Fetch enabled servers from settings and run health checks in background
	$effect(() => {
		if (!browser) return;

		const mcpServers = mcpStore.getServers();

		// Only run health checks if we have enabled servers with URLs
		const enabledServers = mcpServers.filter((s) => s.enabled && s.url.trim());

		if (enabledServers.length > 0) {
			untrack(() => {
				// Run health checks in background (don't await)
				mcpStore.runHealthChecksForServers(enabledServers, false).catch((error) => {
					console.warn('[layout] MCP health checks failed:', error);
				});
			});
		}
	});

	// Validate provider changes through one provider-neutral state owner.
	let previousConnectionSource = '';

	$effect(() => {
		if (!browser || (page.route.id !== '/' && page.route.id !== '/chat/[id]')) return;

		const source = {
			providerId: String(config().apiProvider ?? ''),
			serverBaseUrl: String(config().serverBaseUrl ?? ''),
			apiKey: String(config().apiKey ?? ''),
			protocol: connectionProtocol(String(config().apiProvider ?? ''), config())
		};
		const nextSource = JSON.stringify([
			source.providerId,
			source.serverBaseUrl,
			source.apiKey,
			source.protocol
		]);

		if (previousConnectionSource && previousConnectionSource !== nextSource) {
			const mcpOverrides = conversationsStore.getAllMcpServerOverrides();
			untrack(() => {
				sourceLifecycleService.switchSource(source, mcpOverrides).catch((error) => {
					console.error('Error switching provider source:', error);
				});
			});
			serverStore.clear();
			modelsStore.clear();
		}
		previousConnectionSource = nextSource;

		untrack(() => {
			providerConnectionStore.check(source).catch((error) => {
				console.error('Error checking provider connection:', error);
			});
		});
	});

	let effectiveCapabilityModel = $derived(
		ChatService.resolveEffectiveModel(
			ChatService.createProviderRequestContext(),
			undefined,
			chatStore.getConversationModel(activeMessages())
		)
	);

	onMount(() => {
		const refresh = () => {
			if (document.visibilityState === 'visible')
				void modelsStore.refreshBackend().catch(() => undefined);
		};
		window.addEventListener('focus', refresh);
		window.addEventListener('online', refresh);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			window.removeEventListener('focus', refresh);
			window.removeEventListener('online', refresh);
			document.removeEventListener('visibilitychange', refresh);
		};
	});

	let lastConnectionStatus: string | undefined;
	$effect(() => {
		const status = currentProviderConnectionStatus;
		if (status === 'connected' && lastConnectionStatus !== 'connected')
			untrack(() => {
				void modelsStore.refreshBackend().catch(() => undefined);
			});
		lastConnectionStatus = status;
	});

	let lastCapabilityOwner = '';
	// Catalog/props updates only rebuild snapshots; actual source/model changes
	// also verify HTTP metadata. No effect feeds a forced refresh back into itself.
	$effect(() => {
		if (!browser) return;
		void modelsStore.models;
		void serverStore.backendSignature;
		const context = ChatService.createProviderRequestContext();
		const model = effectiveCapabilityModel;
		const owner = JSON.stringify([modelsStore.modelListSourceKey, model]);
		const verify = owner !== lastCapabilityOwner;
		lastCapabilityOwner = owner;
		untrack(() => {
			modelsStore.refreshCapabilities(context, model, verify).catch(() => {
				/* Connection validation owns user-facing errors. */
			});
		});
	});

	$effect(() => {
		conversationsStore.setTitleUpdateConfirmationCallback(
			async (currentTitle: string, newTitle: string) => {
				return new Promise<boolean>((resolve) => {
					titleUpdateCurrentTitle = currentTitle;
					titleUpdateNewTitle = newTitle;
					titleUpdateResolve = resolve;
					titleUpdateDialogOpen = true;
				});
			}
		);
	});
</script>

<Tooltip.Provider delayDuration={TOOLTIP_DELAY_DURATION}>
	<Toaster richColors />

	<DialogAboutLlampart />

	<DialogChatSettings
		bind:open={chatSettingsDialogOpen}
		initialSection={chatSettingsDialogInitialSection}
	/>

	<DialogConversationTitleUpdate
		bind:open={titleUpdateDialogOpen}
		currentTitle={titleUpdateCurrentTitle}
		newTitle={titleUpdateNewTitle}
		onConfirm={handleTitleUpdateConfirm}
		onCancel={handleTitleUpdateCancel}
	/>

	<Sidebar.Provider bind:open={sidebarOpen}>
		<div class="relative z-10 flex h-screen w-full" style:height="{innerHeight}px">
			<Sidebar.Root class="llampart-redesigned-sidebar-shell h-full">
				<ChatSidebar bind:this={chatSidebar} />
			</Sidebar.Root>

			<Sidebar.Trigger class="absolute top-5 left-8 z-[900] md:top-5 md:left-8" />

			<Sidebar.Inset class="flex flex-1 flex-col overflow-hidden">
				{@render children?.()}
			</Sidebar.Inset>
		</div>
	</Sidebar.Provider>
</Tooltip.Provider>

<svelte:window onkeydown={handleKeydown} bind:innerHeight />
