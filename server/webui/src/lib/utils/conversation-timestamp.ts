export type ConversationTimestampFormat = 'ddmmyyyy24' | 'mmddyyyy12';

export type ConversationTimestampParts = {
	date: string;
	time: string;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

export const formatConversationTimestampParts = (
	value: number | string | Date | null | undefined,
	format: ConversationTimestampFormat = 'ddmmyyyy24'
): ConversationTimestampParts => {
	if (value === null || value === undefined || value === '') {
		return { date: '', time: '' };
	}

	const date = value instanceof Date ? value : new Date(value);

	if (Number.isNaN(date.getTime())) {
		return { date: '', time: '' };
	}

	const day = pad2(date.getDate());
	const month = pad2(date.getMonth() + 1);
	const year = date.getFullYear();
	const minutes = pad2(date.getMinutes());

	if (format === 'mmddyyyy12') {
		const hours24 = date.getHours();
		const period = hours24 >= 12 ? 'pm' : 'am';
		const hours12 = pad2(hours24 % 12 || 12);

		return {
			date: `${month}.${day}.${year}`,
			time: `${hours12}:${minutes}${period}`
		};
	}

	const hours = pad2(date.getHours());

	return {
		date: `${day}.${month}.${year}`,
		time: `${hours}:${minutes}`
	};
};

export const formatConversationTimestamp = (
	value: number | string | Date | null | undefined,
	format: ConversationTimestampFormat = 'ddmmyyyy24'
) => {
	const parts = formatConversationTimestampParts(value, format);

	if (!parts.date || !parts.time) {
		return '';
	}

	return `${parts.date} ${parts.time}`;
};
