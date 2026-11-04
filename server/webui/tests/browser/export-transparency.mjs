import assert from 'node:assert/strict';

/** UI transparency is separate from the downloaded image's alpha below.
 * Code tooltips are real, out-of-hitbox pseudo elements, not button surfaces. */
export async function assertTextActionStyles(page, button) {
	const states = {};
	for (const state of ['rest', 'hover', 'focus', 'active']) {
		await page.mouse.move(0, 0);
		await page.evaluate(() => document.activeElement?.blur());
		await button.scrollIntoViewIfNeeded();
		if (state === 'hover' || state === 'active') await button.hover();
		if (state === 'active') await page.mouse.down();
		if (state === 'focus') {
			await button.focus();
			await page.keyboard.press('Tab');
			await page.keyboard.press('Shift+Tab');
		}
		try {
			const measured = await button.evaluate(async (el) => {
				await document.fonts.ready;
				await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				await Promise.all(el.getAnimations().map((animation) => animation.finished));
				const css = getComputedStyle(el);
				const box = el.getBoundingClientRect();
				return {
					...Object.fromEntries(
						[
							'backgroundColor',
							'backgroundImage',
							'boxShadow',
							'backdropFilter',
							'filter',
							'borderRadius',
							'height',
							'padding',
							'fontFamily',
							'fontSize',
							'fontWeight',
							'lineHeight',
							'textDecorationLine',
							'outlineStyle',
							'transitionDuration'
						].map((key) => [key, css[key]])
					),
					width: box.width,
					rootSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
					borders: ['Top', 'Right', 'Bottom', 'Left'].map((side) => ({
						width: css[`border${side}Width`],
						color: css[`border${side}Color`],
						style: css[`border${side}Style`]
					})),
					classes: [...el.classList],
					focused: document.activeElement === el,
					focusVisible: el.matches(':focus-visible'),
					hover: el.matches(':hover'),
					active: el.matches(':active'),
					tooltip: el.dataset.llampartCodeTooltip,
					pseudo: ['::before', '::after'].map((pseudo) => {
						const s = getComputedStyle(el, pseudo);
						return {
							pseudo,
							content: s.content,
							top: s.top,
							position: s.position,
							pointerEvents: s.pointerEvents,
							background: s.backgroundColor
						};
					})
				};
			});
			states[state] = measured;
			assert(measured.classes.includes('llampart-button-text-action'));
			assert(!measured.classes.some((name) => name.includes('backdrop-blur-')));
			assert.equal(measured.backgroundColor, 'rgba(0, 0, 0, 0)', state);
			assert.equal(measured.backgroundImage, 'none', state);
			assert.equal(measured.boxShadow, 'none', state);
			assert.equal(measured.backdropFilter, 'none', state);
			assert.equal(measured.filter, 'none', state);
			assert(
				measured.borders.every(
					(b) => b.width === '0px' || b.style === 'none' || b.color === 'rgba(0, 0, 0, 0)'
				),
				state
			);
			assert.equal(parseFloat(measured.height), measured.rootSize * 1.75, 'existing hitbox height');
			assert.equal(
				measured.padding,
				`${Number((measured.rootSize * 0.25).toFixed(6))}px ${Number((measured.rootSize * 0.4).toFixed(6))}px`
			);
			assert(measured.width > 0);
			if (state !== 'rest') assert.equal(measured.width, states.rest.width, 'stable hitbox width');
			if (state === 'focus') {
				assert(measured.focused && measured.focusVisible, 'actual keyboard focus-visible');
				assert(measured.textDecorationLine.includes('underline'), 'visible text focus indicator');
			}
			if (state === 'hover' || state === 'active') assert(measured.hover);
			if (state === 'active') assert(measured.active, 'measure while mouse is down');
			for (const pseudo of measured.pseudo) {
				if (pseudo.content === 'none' || pseudo.content === 'normal') continue;
				assert(
					(measured.tooltip && measured.hover) || (measured.tooltip && measured.focusVisible),
					'only the existing code tooltip may generate pseudo content'
				);
				assert.equal(pseudo.position, 'absolute');
				assert.equal(pseudo.pointerEvents, 'none');
				assert(parseFloat(pseudo.top) >= parseFloat(measured.height), 'tooltip outside hitbox');
				if (pseudo.pseudo === '::after')
					assert.equal(pseudo.content, JSON.stringify(measured.tooltip));
			}
			if (measured.tooltip && (state === 'hover' || state === 'focus')) {
				assert.equal(
					measured.pseudo[1].content,
					JSON.stringify(measured.tooltip),
					'export tooltip'
				);
			}
		} finally {
			if (state === 'active') {
				await page.mouse.move(0, 0);
				await page.mouse.up();
			}
		}
	}
	await page.mouse.move(0, 0);
	await page.evaluate(() => document.activeElement?.blur());
	return states;
}

/** Inspect actual downloaded bytes in Chromium, not file-name/source heuristics.
 * Both formats must rasterize with alpha=0 at all four canvas corners while
 * retaining visible artwork. SVG additionally has no full-document paint rect. */
export async function assertTransparentExport(page, bytes, format) {
	format = format.toLowerCase();
	assert(['png', 'svg'].includes(format));
	if (format === 'png') assert.equal(bytes[25], 6, 'PNG must have an RGBA IHDR color type');
	const result = await page.evaluate(
		async ({ base64, format }) => {
			let backdrop = false;
			if (format === 'svg') {
				const xml = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
				const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
				if (doc.querySelector('parsererror')) throw new Error('Invalid export XML');
				const svg = doc.documentElement;
				const box = svg.viewBox.baseVal;
				backdrop = [...svg.children].some((el) => {
					if (el.localName !== 'rect') return false;
					const width = el.getAttribute('width'),
						height = el.getAttribute('height');
					return (
						(width === '100%' && height === '100%') ||
						(Number(el.getAttribute('x') || 0) <= box.x &&
							Number(el.getAttribute('y') || 0) <= box.y &&
							Number(width) >= box.width &&
							Number(height) >= box.height)
					);
				});
			}
			const image = new Image();
			image.src = `data:image/${format === 'svg' ? 'svg+xml' : 'png'};base64,${base64}`;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = Math.min(512, image.naturalWidth);
			canvas.height = Math.min(512, image.naturalHeight);
			const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
			context.drawImage(image, 0, 0, canvas.width, canvas.height);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			const corners = [
				[0, 0],
				[canvas.width - 1, 0],
				[0, canvas.height - 1],
				[canvas.width - 1, canvas.height - 1]
			];
			const alpha = corners.map(([x, y]) => pixels[(y * canvas.width + x) * 4 + 3]);
			let painted = 0,
				transparent = 0;
			for (let i = 3; i < pixels.length; i += 4) {
				if (pixels[i] === 0) transparent++;
				else painted++;
			}
			return {
				format,
				width: image.naturalWidth,
				height: image.naturalHeight,
				backdrop,
				alpha,
				painted,
				transparent
			};
		},
		{ base64: bytes.toString('base64'), format }
	);
	assert(!result.backdrop, 'SVG must not contain a whole-document background rectangle');
	assert.deepEqual(
		result.alpha,
		[0, 0, 0, 0],
		`${format.toUpperCase()} canvas corners must be fully transparent`
	);
	assert(
		result.transparent > result.painted * 0.05,
		'Export must retain genuinely transparent background pixels'
	);
	assert(result.painted > 20, 'Transparency must not be achieved by dropping the visualization');
	return result;
}
