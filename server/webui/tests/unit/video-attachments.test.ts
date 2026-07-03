import { describe, expect, it } from 'vitest';
import { AttachmentType, ContentPartType, FileTypeCategory, ModelModality } from '$lib/enums';
import { VIDEO_FILE_TYPES } from '$lib/constants';
import { ChatService } from '$lib/services/chat.service';
import {
	getFileTypeCategory,
	getFileTypeCategoryByExtension,
	isFileTypeSupported,
	isFileTypeSupportedByModel
} from '$lib/utils';

describe('video attachments', () => {
	it('classifies supported video MIME types and extensions', () => {
		expect(getFileTypeCategory('video/mp4')).toBe(FileTypeCategory.VIDEO);
		expect(getFileTypeCategory('video/ogg')).toBe(FileTypeCategory.VIDEO);
		expect(getFileTypeCategoryByExtension('clip.mp4')).toBe(FileTypeCategory.VIDEO);
		expect(getFileTypeCategoryByExtension('clip.ogg')).toBe(FileTypeCategory.VIDEO);
		expect(isFileTypeSupported('clip.mp4', 'video/mp4')).toBe(true);
		expect(VIDEO_FILE_TYPES.mp4.mimeTypes).toContain('video/mp4');
	});

	it('requires explicit video modality support', () => {
		expect(
			isFileTypeSupportedByModel('clip.mp4', 'video/mp4', {
				hasVision: false,
				hasAudio: false,
				hasVideo: false
			})
		).toBe(false);

		expect(
			isFileTypeSupportedByModel('clip.mp4', 'video/mp4', {
				hasVision: false,
				hasAudio: false,
				hasVideo: true
			})
		).toBe(true);
	});

	it('emits input_video content parts for stored video attachments', () => {
		const message = {
			id: 'msg-video',
			convId: 'conv-video',
			type: 'text',
			timestamp: 1,
			role: 'user',
			content: 'Describe this clip',
			parent: null,
			children: [],
			extra: [
				{
					type: AttachmentType.VIDEO,
					name: 'clip.mp4',
					base64Data: 'AAAA',
					mimeType: 'video/mp4'
				}
			]
		} as DatabaseMessage;

		const result = ChatService.convertDbMessageToApiChatMessageData(message);

		expect(Array.isArray(result.content)).toBe(true);
		expect(result.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: ContentPartType.INPUT_VIDEO,
					input_video: {
						data: 'AAAA',
						format: 'mp4'
					}
				})
			])
		);
	});

	it('exposes video as a model modality enum', () => {
		expect(ModelModality.VIDEO).toBe('VIDEO');
	});
});
