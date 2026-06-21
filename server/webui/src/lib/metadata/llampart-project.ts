export type ProjectAuthorMetadata = Readonly<{
	name: string;
	email: string;
}>;

export const LLAMPART_PROJECT_AUTHOR = {
	name: 'Marcin Gluziński',
	email: 'gluzinski.marcin@gmail.com'
} as const satisfies ProjectAuthorMetadata;

export const LLAMPART_REPOSITORY_URL = 'https://github.com/mchowy-troll/llampart';
export const LLAMA_CPP_REPOSITORY_URL = 'https://github.com/ggml-org/llama.cpp';
export const UNSPLASH_LICENSE_URL = 'https://unsplash.com/license';
export const LLAMPART_AUTHORS_DOCUMENT_URL = `${LLAMPART_REPOSITORY_URL}/blob/main/AUTHORS.md`;
