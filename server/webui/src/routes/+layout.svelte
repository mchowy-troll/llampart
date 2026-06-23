<script lang="ts">
	import '../app.css';
	import { validateApiKey } from '$lib/utils';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import {
		ChatSidebar,
		DialogConversationTitleUpdate,
		DialogChatSettings,
		DialogAboutLlampart
	} from '$lib/components/app';
	import { isLoading } from '$lib/stores/chat.svelte';
	import { conversationsStore, activeMessages } from '$lib/stores/conversations.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { isRouterMode, serverStore } from '$lib/stores/server.svelte';
	import { config, settingsStore } from '$lib/stores/settings.svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { TOOLTIP_DELAY_DURATION } from '$lib/constants';
	import type { SettingsSectionTitle } from '$lib/constants';
	import { KeyboardKey } from '$lib/enums';
	import { setChatSettingsDialogContext } from '$lib/contexts';
	import { CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT, getFrostedGlassWallpaper } from '$lib/constants';
	import { ColorMode } from '$lib/enums/ui';

	let { children } = $props();

	let isChatRoute = $derived(page.route.id === '/chat/[id]');
	let isHomeRoute = $derived(page.route.id === '/');
	let isNewChatMode = $derived(page.url.searchParams.get('new_chat') === 'true');
	let showSidebarByDefault = $derived(activeMessages().length > 0 || isLoading());
	let alwaysShowSidebarOnDesktop = $derived(config().alwaysShowSidebarOnDesktop);
	let autoShowSidebarOnNewChat = $derived(config().autoShowSidebarOnNewChat);
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
	let isFrostedGlassTheme = $derived(config().theme === ColorMode.FROSTED_GLASS);
	let isFrostedGlassWallpaperMilky = $derived(Boolean(config().frostedGlassWallpaperMilky));
	let customFrostedGlassWallpaperRevision = $state(0);
	let frostedGlassWallpaper = $derived(
		getFrostedGlassWallpaper(config().frostedGlassWallpaper, customFrostedGlassWallpaperRevision)
	);
	let uiScalePreset = $derived(normalizeUiScalePreset(config().uiScale));

	function normalizeUiScalePreset(value: unknown): '90' | '100' | '110' {
		const preset = String(value ?? '100');

		return preset === '90' || preset === '110' ? preset : '100';
	}

	$effect(() => {
		if (!browser) return;

		const handleCustomFrostedGlassWallpaperChange = () => {
			customFrostedGlassWallpaperRevision += 1;
		};

		window.addEventListener(
			CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT,
			handleCustomFrostedGlassWallpaperChange
		);
		window.addEventListener('storage', handleCustomFrostedGlassWallpaperChange);

		return () => {
			window.removeEventListener(
				CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT,
				handleCustomFrostedGlassWallpaperChange
			);
			window.removeEventListener('storage', handleCustomFrostedGlassWallpaperChange);
		};
	});

	$effect(() => {
		if (!browser) return;

		document.documentElement.dataset.llampartUiScale = uiScalePreset;
	});

	$effect(() => {
		if (!browser) return;

		const root = document.documentElement;

		if (isFrostedGlassTheme) {
			root.classList.add('has-frosted-glass-theme');
			root.classList.remove('dark');
			root.classList.add('light');
			root.style.setProperty(
				'--llampart-frosted-glass-wallpaper',
				`url("${frostedGlassWallpaper.src}")`
			);
			return;
		}

		root.classList.remove('has-frosted-glass-theme');
		root.style.removeProperty('--llampart-frosted-glass-wallpaper');
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
		// Only fetch if we don't already have props
		if (!serverStore.props) {
			untrack(() => {
				serverStore.fetch();
			});
		}
	});

	// Sync settings when server props are loaded
	$effect(() => {
		const serverProps = serverStore.props;

		if (serverProps) {
			settingsStore.syncWithServerDefaults();
		}
	});

	// Fetch router models when in router mode (for status and modalities)
	// Wait for models to be loaded first, run only once
	let routerModelsFetched = false;

	$effect(() => {
		const isRouter = isRouterMode();
		const modelsCount = modelsStore.models.length;

		// Only fetch router models once when we have models loaded and in router mode
		if (isRouter && modelsCount > 0 && !routerModelsFetched) {
			routerModelsFetched = true;
			untrack(() => {
				modelsStore.fetchRouterModels();
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

	// Monitor provider connection changes and redirect to error page on auth failure.
	$effect(() => {
		const apiProvider = config().apiProvider;
		const serverBaseUrl = config().serverBaseUrl;
		const apiKey = config().apiKey;

		const shouldValidateConnection =
			(page.route.id === '/' || page.route.id === '/chat/[id]') &&
			page.status !== 401 &&
			page.status !== 403 &&
			(apiProvider !== undefined || serverBaseUrl !== undefined || apiKey !== undefined);

		if (shouldValidateConnection) {
			validateApiKey(fetch).catch((err) => {
				if (err && typeof err === 'object' && 'status' in err) {
					const status = Number((err as { status?: unknown }).status);

					if (status === 401 || status === 403) {
						window.location.reload();
						return;
					}
				}

				console.error('Error checking provider connection:', err);
			});
		}
	});

	// Set up title update confirmation callback
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

	/* llampart-frosted-glass-wallpaper-milk-class-only */
	$effect(() => {
		const root = document.documentElement;

		root.classList.toggle(
			'has-frosted-glass-wallpaper-milk',
			isFrostedGlassTheme && isFrostedGlassWallpaperMilky
		);

		return () => {
			root.classList.remove('has-frosted-glass-wallpaper-milk');
		};
	});
</script>

<Tooltip.Provider delayDuration={TOOLTIP_DELAY_DURATION}>
	<ModeWatcher />

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
		<div
			class="relative z-10 flex h-screen w-full"
			style:height="{innerHeight}px"
			class:has-frosted-glass-theme={isFrostedGlassTheme}
		>
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
