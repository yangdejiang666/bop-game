export type LobbyIconId =
    | 'mode_ranked'
    | 'mode_peak'
    | 'mode_classic'
    | 'mode_speed'
    | 'mode_team'
    | 'mode_battleRoyale'
    | 'activity'
    | 'tasks'
    | 'shop'
    | 'magic'
    | 'friends'
    | 'leaderboard'
    | 'match_search'
    | 'victory'
    | 'crown'
    | 'coin'
    | 'xp'
    | 'record'
    | 'rank_gold'
    | 'rank_silver'
    | 'rank_bronze';

interface LobbyIconDefinition {
    viewBox: string;
    body: string;
}

const ICONS: Record<LobbyIconId, LobbyIconDefinition> = {
    mode_ranked: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M12 2L15.3 8.6L22 9.6L17 14.2L18.2 21L12 17.7L5.8 21L7 14.2L2 9.6L8.7 8.6Z" />
        `
    },
    mode_peak: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M4 18L9.2 10.2L12 14L16.2 7L20 18Z" />
            <path d="M3 20H21" fill="none" stroke-width="1.8" stroke-linecap="round" />
        `
    },
    mode_classic: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="9" cy="12" r="5.5" />
            <circle cx="15.5" cy="12.6" r="3.4" />
            <circle cx="17.7" cy="7.1" r="1.2" />
        `
    },
    mode_speed: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M13.8 2L6.8 12.1H11.6L9.7 22L17.2 11.1H12.3Z" />
        `
    },
    mode_team: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="7.2" cy="11" r="3.2" />
            <circle cx="16.8" cy="11" r="3.2" />
            <circle cx="12" cy="15.8" r="3.2" />
        `
    },
    mode_battleRoyale: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="12" cy="12" r="7.2" fill="none" stroke-width="1.8" />
            <circle cx="12" cy="12" r="2.6" fill="none" stroke-width="1.8" />
            <path d="M12 2V5M12 19V22M2 12H5M19 12H22" fill="none" stroke-width="1.8" stroke-linecap="round" />
        `
    },
    activity: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M12 2L14.3 7.7L20.3 8.2L15.7 12L17.2 18L12 14.8L6.8 18L8.3 12L3.7 8.2L9.7 7.7Z" />
            <circle cx="19.2" cy="4.8" r="1.6" />
        `
    },
    tasks: {
        viewBox: '0 0 24 24',
        body: `
            <rect x="4.5" y="4.5" width="15" height="15" rx="3.4" />
            <path d="M8.3 12L10.8 14.3L15.8 9.3" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        `
    },
    shop: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M4.2 8.2H19.8L18.3 20H5.7Z" />
            <path d="M8 8.2V6.6C8 4.6 9.6 3 11.6 3H12.4C14.4 3 16 4.6 16 6.6V8.2" fill="none" stroke-width="1.8" stroke-linecap="round" />
        `
    },
    magic: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M4.2 19.8L10.6 13.4L13.8 16.6L7.4 23Z" />
            <path d="M12.5 5L14 2L15.5 5L18.6 6.5L15.5 8L14 11L12.5 8L9.4 6.5Z" />
            <circle cx="19.2" cy="13.6" r="1.6" />
        `
    },
    friends: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="8.2" cy="9.2" r="3.2" />
            <circle cx="15.8" cy="10.2" r="2.8" />
            <path d="M3.8 19C4.6 16.2 6.8 14.4 9.6 14.4H10.2C13 14.4 15.2 16.2 16 19" fill="none" stroke-width="1.8" stroke-linecap="round" />
            <path d="M14.6 18.2C15 16.5 16.3 15.4 17.9 15.4H18.4C19.7 15.4 20.8 16.1 21.4 17.3" fill="none" stroke-width="1.6" stroke-linecap="round" />
        `
    },
    leaderboard: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M8.2 20V12.2H11.3V20Z" />
            <path d="M12.9 20V9.2H16.1V20Z" />
            <path d="M17.8 20V14.4H20.8V20Z" />
            <path d="M4 20H21" fill="none" stroke-width="1.8" stroke-linecap="round" />
            <circle cx="7.2" cy="7" r="2.2" />
        `
    },
    match_search: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="10.3" cy="10.3" r="6.2" fill="none" stroke-width="1.8" />
            <path d="M14.8 14.8L20.6 20.6" fill="none" stroke-width="1.8" stroke-linecap="round" />
            <circle cx="10.3" cy="10.3" r="2.2" />
        `
    },
    victory: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M6 4.8H18V7.1C18 10.7 15.6 13.7 12 14.7C8.4 13.7 6 10.7 6 7.1Z" />
            <path d="M8.5 16.2H15.5V18.3H8.5Z" />
            <path d="M7.3 19H16.7V21H7.3Z" />
            <path d="M5.9 6.4H3.7C3.8 9.2 4.9 11 6.8 11.9" fill="none" stroke-width="1.6" stroke-linecap="round" />
            <path d="M18.1 6.4H20.3C20.2 9.2 19.1 11 17.2 11.9" fill="none" stroke-width="1.6" stroke-linecap="round" />
        `
    },
    crown: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M3.5 18.8L5.2 8.2L10.1 12.1L12 5.4L13.9 12.1L18.8 8.2L20.5 18.8Z" />
            <path d="M3.8 20.5H20.2" fill="none" stroke-width="1.8" stroke-linecap="round" />
            <circle cx="12" cy="8.1" r="1.1" />
        `
    },
    coin: {
        viewBox: '0 0 24 24',
        body: `
            <ellipse cx="12" cy="12" rx="8.7" ry="6.9" />
            <ellipse cx="12" cy="12" rx="5.3" ry="3.8" fill="none" stroke-width="1.8" />
            <path d="M12 9.9V14.1M10.2 12H13.8" fill="none" stroke-width="1.6" stroke-linecap="round" />
        `
    },
    xp: {
        viewBox: '0 0 24 24',
        body: `
            <path d="M4.2 6.5H19.8V17.5H4.2Z" fill="none" stroke-width="1.8" />
            <path d="M7.1 9.3L10.1 14.7" fill="none" stroke-width="1.8" stroke-linecap="round" />
            <path d="M10.1 9.3L7.1 14.7" fill="none" stroke-width="1.8" stroke-linecap="round" />
            <path d="M13.6 9.3H16.1C17.2 9.3 18 10.2 18 11.3C18 12.5 17.2 13.4 16.1 13.4H13.6Z" fill="none" stroke-width="1.8" stroke-linecap="round" />
        `
    },
    record: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="12" cy="12" r="8.4" />
            <path d="M12 7.8V12.2L15.2 14.1" fill="none" stroke-width="1.8" stroke-linecap="round" />
            <path d="M9 3.8L10.4 6.1M15 3.8L13.6 6.1" fill="none" stroke-width="1.6" stroke-linecap="round" />
        `
    },
    rank_gold: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="12" cy="12" r="9" />
            <path d="M12 6.1L13.9 10L18.2 10.6L15.1 13.5L15.8 17.9L12 15.8L8.2 17.9L8.9 13.5L5.8 10.6L10.1 10Z" />
        `
    },
    rank_silver: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4.6" fill="none" stroke-width="1.8" />
            <path d="M12 7.6V16.4M7.6 12H16.4" fill="none" stroke-width="1.8" stroke-linecap="round" />
        `
    },
    rank_bronze: {
        viewBox: '0 0 24 24',
        body: `
            <circle cx="12" cy="12" r="9" />
            <path d="M8.2 8.3H13.2C15 8.3 16.2 9.3 16.2 10.8C16.2 12.2 15 13.2 13.2 13.2H8.2V8.3ZM8.2 13.2H13.5C15.3 13.2 16.5 14.1 16.5 15.7C16.5 17.2 15.3 18.2 13.5 18.2H8.2V13.2Z" />
        `
    }
};

export function renderLobbyIcon(id: LobbyIconId, className = ''): string {
    const def = ICONS[id];
    const classAttr = className.trim().length > 0 ? ` ${className.trim()}` : '';
    return `<svg class="lobby-svg-icon${classAttr}" viewBox="${def.viewBox}" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${def.body}</svg>`;
}

