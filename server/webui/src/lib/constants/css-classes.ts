export const BOX_BORDER =
	'border border-border/30 focus-within:border-border  dark:border-border/20 dark:focus-within:border-border';

export const INPUT_CLASSES = `
    bg-muted/60 dark:bg-muted/75
    ${BOX_BORDER}
    shadow-sm
    outline-none
    text-foreground
`;

export const PANEL_CLASSES = `
    bg-background
    border border-border/30 dark:border-border/20
    shadow-sm backdrop-blur-lg!
    rounded-t-lg!
`;

export const CHAT_FORM_POPOVER_MAX_HEIGHT = 'max-h-80';

export const COMPOSER_TOOLS_SUBMENU_LIST_MAX_HEIGHT = 'max-h-[calc(50vh-1rem)]';

export const COMPOSER_TOOLS_SUBMENU_PANEL_CLASSES =
	'llampart-composer-menu-content llampart-composer-tools-submenu w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border-border/50 p-1.5 shadow-xl';

export const COMPOSER_TOOLS_SUBMENU_GROUP_ROW_CLASSES =
	'llampart-tools-group-item flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-accent/55';

export const COMPOSER_TOOLS_SUBMENU_ITEM_ROW_CLASSES =
	'llampart-tools-item flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/30';
