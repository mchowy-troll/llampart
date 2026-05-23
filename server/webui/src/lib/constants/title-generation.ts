/* llampart LLM conversation title generation constants */

export const TITLE_GENERATION_PROMPTS = {
	en: `Based on the following interaction, generate a short, concise title in the language of the conversation (maximum 6-8 words) that captures the main topic. Return ONLY the title text, nothing else. Do not use quotes.

User: {{USER}}

Assistant: {{ASSISTANT}}

Title:`,
	pl: `Na podstawie poniższej interakcji wygeneruj krótki, zwięzły tytuł w języku rozmowy (maksymalnie 6–8 słów), który oddaje główny temat. Zwróć WYŁĄCZNIE tekst tytułu, nic więcej. Nie używaj cudzysłowów.

Użytkownik: {{USER}}

Asystent: {{ASSISTANT}}

Tytuł:`,
	de: `Erstelle auf Grundlage der folgenden Interaktion einen kurzen, prägnanten Titel in der Sprache der Unterhaltung (maximal 6–8 Wörter), der das Hauptthema erfasst. Gib AUSSCHLIESSLICH den Titeltext zurück, sonst nichts. Verwende keine Anführungszeichen.

Benutzer: {{USER}}

Assistent: {{ASSISTANT}}

Titel:`,
	fr: `À partir de l’interaction suivante, générez un titre court et concis dans la langue de la conversation (maximum 6 à 8 mots) qui résume le sujet principal. Retournez UNIQUEMENT le texte du titre, rien d’autre. N’utilisez pas de guillemets.

Utilisateur : {{USER}}

Assistant : {{ASSISTANT}}

Titre :`,
	it: `In base alla seguente interazione, genera un titolo breve e conciso nella lingua della conversazione (massimo 6–8 parole) che riassuma l’argomento principale. Restituisci SOLO il testo del titolo, nient’altro. Non usare virgolette.

Utente: {{USER}}

Assistente: {{ASSISTANT}}

Titolo:`,
	es: `Basándote en la siguiente interacción, genera un título breve y conciso en el idioma de la conversación (máximo 6–8 palabras) que resuma el tema principal. Devuelve SOLO el texto del título, nada más. No uses comillas.

Usuario: {{USER}}

Asistente: {{ASSISTANT}}

Título:`
} as const;

const LEGACY_DEFAULT_PROMPTS = [
	'Based on the following interaction, generate a short, concise title (maximum 6-8 words) that captures the main topic. Return ONLY the title text, nothing else. Do not use quotes.\n\nUser: {{USER}}\n\nAssistant: {{ASSISTANT}}\n\nTitle:'
] as const;

function normalizePrompt(value: string): string {
	return value.replace(/\r\n/g, '\n').trim();
}

export function getLocalizedTitleGenerationPrompt(language?: string): string {
	const prompt = TITLE_GENERATION_PROMPTS[language as keyof typeof TITLE_GENERATION_PROMPTS];

	return prompt ?? TITLE_GENERATION_PROMPTS.en;
}

export function isBuiltInTitleGenerationPrompt(value: unknown): boolean {
	if (typeof value !== 'string') return false;

	const normalized = normalizePrompt(value);

	return [...Object.values(TITLE_GENERATION_PROMPTS), ...LEGACY_DEFAULT_PROMPTS].some(
		(prompt) => normalizePrompt(prompt) === normalized
	);
}

export const TITLE_GENERATION = {
	MIN_LENGTH: 3,
	FALLBACK: 'New Chat',
	DEFAULT_PROMPT: TITLE_GENERATION_PROMPTS.en,
	PREFIX_PATTERN: /^(Title:|Subject:|Topic:|Tytuł:|Titel:|Titre:|Titolo:)\s*/i,
	QUOTE_PATTERN: /^["'“”‘’]|["'“”‘’]$/g
} as const;
