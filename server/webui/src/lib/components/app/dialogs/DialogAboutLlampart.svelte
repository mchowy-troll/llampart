<script lang="ts">
	import { browser } from '$app/environment';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { LLAMPART_ABOUT_DISMISSED_VERSION_KEY } from '$lib/constants';
	import { t } from '$lib/i18n';
	import packageJson from '../../../../../package.json';

	const APP_VERSION = packageJson.version;
	const AUTHOR_NAME = 'Marcin Gluziński';
	const AUTHOR_EMAIL = 'gluzinski.marcin@gmail.com';
	const LLAMA_CPP_URL = 'https://github.com/ggml-org/llama.cpp';
	const LLAMPART_REPOSITORY_URL = 'https://github.com/mchowy-troll/llampart';
	const UNSPLASH_LICENSE_URL = 'https://unsplash.com/license';

	type WallpaperCredit = Readonly<{
		label: string;
		author: string;
		authorUrl?: string;
		source: string;
		sourceUrl?: string;
	}>;

	const WALLPAPER_CREDITS: readonly WallpaperCredit[] = [
		{
			label: 'Frosted Glass 01',
			author: 'Marcin Stefański',
			source: 'Gdańsk, Poland'
		},
		{
			label: 'Frosted Glass 02',
			author: 'Royce Fonseca',
			authorUrl:
				'https://unsplash.com/@casunshine0508?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText',
			source: 'Unsplash',
			sourceUrl:
				'https://unsplash.com/photos/white-sand-dunes-with-a-distant-mountain-range-48bRZya67Po?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText'
		},
		{
			label: 'Frosted Glass 03',
			author: 'Pawel Czerwinski',
			authorUrl:
				'https://unsplash.com/@pawel_czerwinski?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText',
			source: 'Unsplash',
			sourceUrl:
				'https://unsplash.com/photos/a-pink-abstract-background-with-curved-shapes-iA4O2vAnieg?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText'
		},
		{
			label: 'Frosted Glass 04',
			author: 'Pawel Czerwinski',
			authorUrl:
				'https://unsplash.com/@pawel_czerwinski?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText',
			source: 'Unsplash',
			sourceUrl:
				'https://unsplash.com/photos/a-close-up-of-a-book-with-a-white-background-jPR5yqkfxbM?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText'
		},
		{
			label: 'Frosted Glass 05',
			author: 'Mason Field',
			authorUrl:
				'https://unsplash.com/@masonrfield?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText',
			source: 'Unsplash',
			sourceUrl:
				'https://unsplash.com/photos/a-lone-giraffe-standing-in-the-middle-of-a-field-HXccAaMfAxI?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText'
		}
	];

	let open = $state(false);
	let doNotShowAgain = $state(false);
	let initialized = false;

	function rememberDismissal() {
		if (!browser || !doNotShowAgain) return;

		localStorage.setItem(LLAMPART_ABOUT_DISMISSED_VERSION_KEY, APP_VERSION);
	}

	function closeDialog() {
		rememberDismissal();
		open = false;
	}

	let wasOpen = false;

	$effect(() => {
		if (!initialized) return;

		if (wasOpen && !open) {
			rememberDismissal();
		}

		wasOpen = open;
	});

	$effect(() => {
		if (!browser || initialized) return;

		initialized = true;

		const dismissedVersion = localStorage.getItem(LLAMPART_ABOUT_DISMISSED_VERSION_KEY);

		if (dismissedVersion !== APP_VERSION) {
			open = true;
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		showCloseButton={false}
		class="flex h-[100dvh] max-h-[100dvh] min-h-[100dvh] w-[100vw] max-w-none! flex-col overflow-hidden rounded-none border border-border/30 p-0 shadow-lg md:h-[80dvh] md:max-h-[80dvh] md:min-h-0 md:w-[60vw] md:max-w-[60vw]! md:rounded-lg"
	>
		<div class="grid min-h-0 flex-1 grid-cols-3">
			<div
				class="col-span-1 flex flex-col items-center justify-center border-r border-border/30 px-8 py-10 text-center"
			>
				<img
					src="/llampart.svg"
					alt="llampart"
					class="mb-8 h-60 max-h-[34vh] w-60 max-w-[78%] object-contain dark:opacity-80 dark:invert"
				/>

				<Dialog.Title class="mb-2 text-2xl font-semibold tracking-tight md:text-3xl">
					llampart
				</Dialog.Title>

				<Dialog.Description class="mb-10 max-w-xs text-sm text-muted-foreground">
					{t('dialogs.aboutLlampartDescription')}
				</Dialog.Description>

				<div class="grid w-full grid-cols-3 gap-4 text-left">
					<div
						class="col-span-2 min-w-0 overflow-hidden rounded-lg border border-border/30 bg-background px-4 py-3"
					>
						<div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{t('dialogs.aboutLlampartAuthorLabel')}
						</div>
						<div class="mt-2 text-base leading-snug font-semibold break-words">{AUTHOR_NAME}</div>
						<a
							href={`mailto:${AUTHOR_EMAIL}`}
							class="mt-1 block min-w-0 border-0 bg-transparent p-0 text-sm break-all whitespace-normal text-muted-foreground no-underline decoration-transparent shadow-none ring-0 outline-none hover:text-foreground hover:no-underline focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
						>
							{AUTHOR_EMAIL}
						</a>
					</div>

					<div
						class="col-span-1 min-w-0 overflow-hidden rounded-lg border border-border/30 bg-background px-4 py-3"
					>
						<div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{t('dialogs.aboutLlampartVersionLabel')}
						</div>
						<div class="mt-2 text-base leading-snug font-semibold break-words">{APP_VERSION}</div>
					</div>

					<div
						class="col-span-3 min-w-0 overflow-hidden rounded-lg border border-border/30 bg-background px-4 py-3"
					>
						<div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{t('dialogs.aboutLlampartRepositoryLabel')}
						</div>
						<a
							href={LLAMPART_REPOSITORY_URL}
							target="_blank"
							rel="noreferrer"
							class="mt-2 block min-w-0 border-0 bg-transparent p-0 text-sm font-medium break-all whitespace-normal text-muted-foreground no-underline decoration-transparent shadow-none ring-0 outline-none hover:text-foreground hover:no-underline focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
						>
							{LLAMPART_REPOSITORY_URL}
						</a>
					</div>
				</div>
			</div>

			<div class="col-span-2 flex min-h-0 flex-col px-8 py-8">
				<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
					<section class="rounded-lg border border-border/30 bg-muted/10 p-5">
						<div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{t('dialogs.aboutLlampartAboutProgramTitle')}
						</div>

						<div class="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
							<p>{t('dialogs.aboutLlampartAboutProgramBodyOne')}</p>
							<p>{t('dialogs.aboutLlampartAboutProgramBodyTwo')}</p>
							<p>{t('dialogs.aboutLlampartAboutProgramBodyThree')}</p>
						</div>
					</section>

					<div class="grid gap-4 md:grid-cols-2">
						<section class="rounded-lg border border-border/30 bg-muted/10 p-5">
							<div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								{t('dialogs.aboutLlampartSpecialThanksTitle')}
							</div>

							<p class="mt-3 text-sm leading-relaxed text-muted-foreground">
								{t('dialogs.aboutLlampartSpecialThanksLlamaUiBody')}
							</p>

							<a
								href={LLAMA_CPP_URL}
								target="_blank"
								rel="noreferrer"
								class="mt-3 inline-block border-0 bg-transparent p-0 text-sm text-muted-foreground no-underline decoration-transparent shadow-none ring-0 outline-none hover:text-foreground hover:no-underline focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
							>
								{LLAMA_CPP_URL}
							</a>

							<div class="my-4 border-t border-border/30" aria-hidden="true"></div>

							<p class="text-sm leading-relaxed text-muted-foreground">
								{t('dialogs.aboutLlampartSpecialThanksWallpapersBody')}
							</p>

							<ul class="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
								{#each WALLPAPER_CREDITS as credit (credit.label)}
									<li>
										<span class="font-medium text-foreground">{credit.label}: </span>
										{#if credit.authorUrl}
											<a
												href={credit.authorUrl}
												target="_blank"
												rel="noreferrer"
												class="border-0 bg-transparent p-0 text-muted-foreground no-underline decoration-transparent shadow-none ring-0 outline-none hover:text-foreground hover:no-underline focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
											>
												{credit.author}
											</a>
										{:else}
											<span>{credit.author}</span>
										{/if}
										<span> — </span>
										{#if credit.sourceUrl}
											<a
												href={credit.sourceUrl}
												target="_blank"
												rel="noreferrer"
												class="border-0 bg-transparent p-0 text-muted-foreground no-underline decoration-transparent shadow-none ring-0 outline-none hover:text-foreground hover:no-underline focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
											>
												{credit.source}
											</a>
										{:else}
											<span>{credit.source}</span>
										{/if}
									</li>
								{/each}
							</ul>

							<p class="mt-3 text-xs leading-relaxed text-muted-foreground">
								{t('dialogs.aboutLlampartSpecialThanksUnsplashLicenseBody')}
								<a
									href={UNSPLASH_LICENSE_URL}
									target="_blank"
									rel="noreferrer"
									class="border-0 bg-transparent p-0 text-muted-foreground no-underline decoration-transparent shadow-none ring-0 outline-none hover:text-foreground hover:no-underline focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none"
								>
									Unsplash License
								</a>.
							</p>
						</section>

						<section class="rounded-lg border border-border/30 bg-muted/10 p-5">
							<div class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								{t('dialogs.aboutLlampartLicenseTitle')}
							</div>

							<p class="mt-3 text-sm leading-relaxed text-muted-foreground">
								{t('dialogs.aboutLlampartLicenseBody')}
							</p>
						</section>
					</div>
				</div>
			</div>
		</div>

		<div class="flex items-center gap-4 border-t border-border/30 px-6 py-4">
			<div class="flex min-w-0 flex-1 items-center gap-3">
				<Checkbox id="about-llampart-do-not-show-again" bind:checked={doNotShowAgain} />

				<Label
					for="about-llampart-do-not-show-again"
					class="cursor-pointer text-sm leading-snug text-muted-foreground"
				>
					{t('dialogs.aboutLlampartDoNotShowAgain')}
				</Label>
			</div>

			<Button class="min-w-28" onclick={closeDialog}>{t('dialogs.aboutLlampartClose')}</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
