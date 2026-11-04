import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOG, RETIRED_FONT_IDS } from '$lib/constants/typography';
import { getFontVariants, normalizeFontFamily, applyTypography } from '$lib/utils/typography';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
import {
	parseSettingsConfig,
	parseSettingsStorage,
	serializeSettingsStorage
} from '$lib/utils/settings-schema';

describe('seven local font families', () => {
	it('owns precisely seven ordered options and their internal fallbacks', () => {
		expect(Object.keys(FONT_CATALOG)).toEqual([
			'merriweather',
			'google-sans',
			'barlow',
			'inter',
			'fira-sans',
			'literata',
			'domine'
		]);
		expect(Object.values(FONT_CATALOG).map((f) => f.label)).toEqual([
			'Merriweather',
			'Google Sans',
			'Barlow',
			'Inter',
			'Fira Sans',
			'Literata',
			'Domine'
		]);
		expect(FONT_CATALOG.merriweather.families).toEqual(['Llampart Merriweather', 'Llampart Tinos']);
		expect(FONT_CATALOG.barlow.families).toEqual(['Llampart Barlow', 'Llampart Inter']);
		for (const id of ['google-sans', 'barlow', 'inter', 'fira-sans'] as const)
			expect(FONT_CATALOG[id].families.join()).not.toContain('Tinos');
		const settings = readFileSync(
			new URL(
				'../../src/lib/components/app/chat/ChatSettings/ChatSettings.svelte',
				import.meta.url
			),
			'utf8'
		);
		expect(settings).toContain('Object.entries(FONT_CATALOG)');
	});
	it.each(Object.keys(FONT_CATALOG))(
		'round-trips %s without changing other preferences',
		(family) => {
			const config = parseSettingsConfig({
				fontFamily: family,
				fontVariant: '600',
				fontSize: '18',
				temperature: 0.3
			});
			expect(parseSettingsStorage(serializeSettingsStorage(config))).toMatchObject({
				fontFamily: family,
				fontVariant: '600',
				fontSize: '18',
				temperature: 0.3
			});
			expect(getFontVariants(family).map((v) => v.value)).toEqual(['400', '500', '600', '700']);
		}
	);
	it.each(RETIRED_FONT_IDS)(
		'migrates historical %s explicitly without resetting unrelated settings',
		(fontFamily) => {
			const config = parseSettingsConfig({
				fontFamily,
				fontVariant: '600',
				fontSize: '19',
				temperature: 0.7
			});
			expect(config).toMatchObject({
				fontFamily: 'merriweather',
				fontVariant: '600',
				fontSize: '19',
				temperature: 0.7
			});
			expect(JSON.parse(serializeSettingsStorage(config)).fontFamily).toBe('merriweather');
		}
	);
	it('retains the internal sentinel and safe invalid-value behavior', () => {
		expect(normalizeFontFamily('default')).toBe('default');
		for (const value of ['unknown', null, {}, 42])
			expect(normalizeFontFamily(value)).toBe('default');
		expect(parseSettingsConfig({ fontFamily: {}, temperature: 0.4 })).toMatchObject({
			fontFamily: 'merriweather',
			temperature: 0.4
		});
	});
	it('uses catalog stacks and never exceeds a font’s real variable weight range', () => {
		for (const [id, definition] of Object.entries(FONT_CATALOG)) {
			const properties = new Map();
			const root = {
				dataset: {},
				style: {
					setProperty: (k: string, v: string) => properties.set(k, v),
					removeProperty: (k: string) => properties.delete(k)
				}
			} as unknown as HTMLElement;
			applyTypography(
				root,
				parseSettingsConfig({ ...SETTING_CONFIG_DEFAULT, fontFamily: id, fontVariant: '700' })
			);
			expect(properties.get('--llampart-font-family')).toBe(
				definition.families.map((f) => `"${f}"`).join(', ')
			);
			expect(Number(properties.get('--llampart-font-bold'))).toBeLessThanOrEqual(
				definition.maxWeight
			);
		}
	});
	it('ships only manifested assets with exact sizes, checksums, licenses and local faces', () => {
		const root = new URL('../../static/fonts/', import.meta.url);
		const records = JSON.parse(readFileSync(new URL('sources.json', root), 'utf8'));
		expect(records.map((r: { file: string }) => r.file).sort()).toEqual(
			readdirSync(root)
				.filter((f) => f.endsWith('.woff2'))
				.sort()
		);
		const css = readFileSync(
			new URL('../../src/lib/styles/local-fonts.css', import.meta.url),
			'utf8'
		);
		expect(css.match(/@font-face/g)).toHaveLength(records.length);
		for (const record of records) {
			const data = readFileSync(new URL(record.file, root));
			expect(data.byteLength).toBe(record.bytes);
			expect(createHash('sha256').update(data).digest('hex')).toBe(record.sha256);
			expect(readFileSync(new URL(record.license, root), 'utf8')).toContain(
				'SIL OPEN FONT LICENSE Version 1.1'
			);
			expect(css).toContain(`/fonts/${record.file}`);
		}
		expect(css).not.toMatch(/https?:|local\(/);
		expect(readFileSync(new URL('google-sans-TRADEMARKS.txt', root), 'utf8')).toContain(
			'trademarks of Google LLC'
		);
	});
});
