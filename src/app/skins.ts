export interface SkinOption {
    id: string;
    name: string;
    colorA: string;
    colorB: string;
}

export const SKIN_OPTIONS: SkinOption[] = [
    { id: 'classic_blue', name: '经典蓝', colorA: '#81ecff', colorB: '#4f7dff' },
    { id: 'mint_pop', name: '薄荷泡泡', colorA: '#56ffc0', colorB: '#1ac788' },
    { id: 'sunset_lava', name: '熔岩余晖', colorA: '#ffcf66', colorB: '#ff6b4a' },
    { id: 'neon_violet', name: '霓虹紫电', colorA: '#d18bff', colorB: '#7657ff' }
];

export function resolveSkinId(rawSkinId: string): string {
    return SKIN_OPTIONS.some((skin) => skin.id === rawSkinId) ? rawSkinId : SKIN_OPTIONS[0].id;
}

export function getSkinOption(rawSkinId: string): SkinOption {
    const skinId = resolveSkinId(rawSkinId);
    return SKIN_OPTIONS.find((skin) => skin.id === skinId) ?? SKIN_OPTIONS[0];
}
