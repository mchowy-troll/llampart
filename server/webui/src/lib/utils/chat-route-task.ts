export interface ChatRouteTask {
	isCurrent: () => boolean;
	isAlreadyActive: boolean;
	loadConversation: () => Promise<boolean>;
	syncLoadingState: () => void;
	resumeStream: () => Promise<unknown>;
	handleUrlParams: () => Promise<void>;
	gotoFallback: () => Promise<unknown>;
}

export async function runChatRouteTask(task: ChatRouteTask): Promise<void> {
	const loaded = task.isAlreadyActive || (await task.loadConversation());
	if (!task.isCurrent()) return;
	if (!loaded) {
		await task.gotoFallback();
		return;
	}

	task.syncLoadingState();
	if (!task.isCurrent()) return;
	await task.resumeStream();
	if (!task.isCurrent()) return;
	await task.handleUrlParams();
}
