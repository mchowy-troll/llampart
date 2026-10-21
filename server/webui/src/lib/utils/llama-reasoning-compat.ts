/** Bounded Jinja evidence reader, not an interpreter. Recognizes string sequences,
 * single-assignment aliases/default filters and immediately rejecting membership
 * guards. Everything outside that grammar remains unknown. Strings/comments/raw
 * blocks are never searched for executable evidence. */
type Token = { kind: 'name' | 'string' | 'symbol'; text: string };
type Tag = { kind: string; tokens: Token[] };

function tokenize(code: string): Token[] | null {
	const result: Token[] = [];
	for (let i = 0; i < code.length; ) {
		const c = code[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (c === '"' || c === "'") {
			const quote = c;
			let text = '';
			i++;
			while (i < code.length && code[i] !== quote) {
				// Escaped strings are outside the literal evidence grammar.
				if (code[i] === '\\') return null;
				text += code[i++];
			}
			if (code[i++] !== quote) return null;
			result.push({ kind: 'string', text });
		} else if (/[a-zA-Z_]/.test(c)) {
			let text = c;
			i++;
			while (i < code.length && /[a-zA-Z0-9_]/.test(code[i])) text += code[i++];
			result.push({ kind: 'name', text });
		} else {
			result.push({ kind: 'symbol', text: c });
			i++;
		}
	}
	return result;
}

function tags(template: string): Tag[] {
	const result: Tag[] = [];
	let raw = false;
	for (let i = 0; i < template.length - 1; i++) {
		if (template[i] !== '{' || !'{%#'.includes(template[i + 1])) continue;
		const kind = template[++i];
		const end = kind === '{' ? '}}' : `${kind}}`;
		const start = i + 1;
		let quote = '';
		for (i++; i < template.length; i++) {
			if (quote) {
				if (template[i] === '\\') i++;
				else if (template[i] === quote) quote = '';
			} else if (template.startsWith(end, i)) break;
			else if (kind !== '#' && (template[i] === '"' || template[i] === "'")) quote = template[i];
		}
		const code = template.slice(start, i).replace(/^-|-$/g, '').trim();
		i++;
		if (kind === '#') continue;
		if (kind === '%' && code === 'endraw') {
			raw = false;
			continue;
		}
		if (raw) continue;
		if (kind === '%' && code === 'raw') {
			raw = true;
			continue;
		}
		result.push({ kind, tokens: tokenize(code) ?? [] });
	}
	return result;
}

function stringSequence(tokens: Token[]): string[] | undefined {
	if (
		!['[', '('].includes(tokens[0]?.text) ||
		tokens.at(-1)?.text !== (tokens[0].text === '[' ? ']' : ')')
	)
		return;
	const values: string[] = [];
	let expectValue = true;
	for (const token of tokens.slice(1, -1)) {
		if (expectValue && token.kind === 'string' && token.text) {
			values.push(token.text);
			expectValue = false;
		} else if (!expectValue && token.text === ',') expectValue = true;
		else return;
	}
	return values.length ? [...new Set(values)] : undefined;
}

/** Only top-level or positive thinking branches establish unconditional evidence.
 * In particular a guard in an unused macro/loop/conditional is not a declaration. */
function evidenceScopes(statements: Tag[]): boolean[] {
	const scopes: { kind: string; active: boolean }[] = [];
	return statements.map(({ kind, tokens }) => {
		const active = scopes.every((scope) => scope.active);
		if (kind !== '%') return active;
		const head = tokens[0]?.text ?? '';
		if (head.startsWith('end') && scopes.at(-1)?.kind === head.slice(3)) scopes.pop();
		else if (head === 'else' || head === 'elif') {
			if (scopes.length) scopes[scopes.length - 1].active = false;
		} else if (head === 'if') {
			const expression = tokens
				.slice(1)
				.map((token) => (token.kind === 'name' ? token.text : '?'))
				.join(' ');
			scopes.push({
				kind: head,
				active: [
					'enable_thinking',
					'enable_thinking is true',
					'enable_thinking is defined and enable_thinking',
					'enable_thinking is undefined or enable_thinking',
					'enable_thinking is undefined or enable_thinking is true'
				].includes(expression)
			});
		} else if (
			['for', 'macro', 'block', 'call', 'filter', 'with', 'autoescape'].includes(head) ||
			(head === 'set' && !tokens.some((token) => token.text === '='))
		)
			scopes.push({ kind: head, active: false });
		return active;
	});
}

function unconditionalRaise(tokens: Token[]): boolean {
	if (tokens[0]?.text !== 'raise_exception' || tokens[1]?.text !== '(') return false;
	let depth = 0;
	for (let i = 1; i < tokens.length; i++) {
		if (tokens[i].kind !== 'symbol') continue;
		if (tokens[i].text === '(') depth++;
		if (tokens[i].text === ')' && --depth === 0) return i === tokens.length - 1;
	}
	return false;
}

export function llamaReasoningCompatibility(template?: string | null): {
	toggle: boolean;
	effortParameter?: 'reasoning_effort' | 'reasoning_strength';
	values?: string[];
} {
	const statements = tags(template ?? '');
	const scopes = evidenceScopes(statements);
	const assignments = new Map<string, { tokens: Token[]; index: number } | null>();
	for (const [index, { kind, tokens: t }] of statements.entries()) {
		if (kind !== '%' || t[0]?.text !== 'set' || t[1]?.kind !== 'name' || t[2]?.text !== '=')
			continue;
		assignments.set(t[1].text, assignments.has(t[1].text) ? null : { tokens: t.slice(3), index });
	}
	const aliasSource = (t: Token[]): string | undefined => {
		if (t[0]?.kind !== 'name') return;
		if (
			t.length === 1 ||
			(t.length === 6 &&
				t[1].text === '|' &&
				t[2].text === 'default' &&
				t[3].text === '(' &&
				t[4].kind === 'string' &&
				t[5].text === ')')
		)
			return t[0].text;
	};
	const root = (
		name: string,
		before: number,
		visited = new Set<string>()
	): 'reasoning_effort' | 'reasoning_strength' | undefined => {
		if (visited.has(name)) return;
		visited.add(name);
		const assignment = assignments.get(name);
		if (name === 'reasoning_effort' || name === 'reasoning_strength') {
			if (
				!assignments.has(name) ||
				(assignment &&
					assignment.index < before &&
					assignment.tokens.length === 6 &&
					aliasSource(assignment.tokens) === name)
			)
				return name;
			return;
		}
		if (!assignment || assignment.index >= before || !scopes[assignment.index]) return;
		const source = aliasSource(assignment.tokens);
		if (source) return root(source, assignment.index, visited);
	};
	let toggle = false;
	let effortParameter: 'reasoning_effort' | 'reasoning_strength' | undefined;
	let values: string[] | undefined;
	let ambiguous = false;
	for (let i = 0; i < statements.length; i++) {
		if (!scopes[i]) continue;
		const { kind, tokens: t } = statements[i];
		if (
			kind === '%' &&
			t[0]?.text === 'if' &&
			t.some((v) => v.kind === 'name' && v.text === 'enable_thinking') &&
			t
				.slice(1)
				.every(
					(v) =>
						v.kind === 'name' &&
						[
							'enable_thinking',
							'is',
							'defined',
							'undefined',
							'true',
							'false',
							'and',
							'or',
							'not'
						].includes(v.text)
				)
		)
			toggle = true;
		if (kind === '{' && t.length === 1 && t[0].kind === 'name')
			effortParameter ??= root(t[0].text, i);
		if (
			kind !== '%' ||
			t[0]?.text !== 'if' ||
			t[1]?.kind !== 'name' ||
			t[2]?.text !== 'not' ||
			t[3]?.text !== 'in'
		)
			continue;
		const parameter = root(t[1].text, i);
		if (!parameter) continue;
		const rhs = t.slice(4);
		const literal =
			rhs.length === 1 && rhs[0].kind === 'name' ? assignments.get(rhs[0].text) : undefined;
		const declared = stringSequence(
			rhs.length === 1
				? literal && literal.index < i && scopes[literal.index]
					? literal.tokens
					: []
				: rhs
		);
		const next = statements[i + 1],
			end = statements[i + 2];
		if (
			!declared ||
			next?.kind !== '{' ||
			!unconditionalRaise(next.tokens) ||
			end?.kind !== '%' ||
			end.tokens.length !== 1 ||
			end.tokens[0].text !== 'endif'
		)
			continue;
		if (
			values &&
			(effortParameter !== parameter || JSON.stringify(values) !== JSON.stringify(declared))
		)
			ambiguous = true;
		effortParameter = parameter;
		values = declared;
	}
	return { toggle, effortParameter, ...(!ambiguous && values ? { values } : {}) };
}
