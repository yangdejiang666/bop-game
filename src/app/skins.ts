export interface SkinOption {
    id: string;
    name: string;
    colorA: string;
    colorB: string;
    code: string;
    series: string;
    rarity: string;
    finish: string;
    signature: string;
    scenario: string;
    signal: string;
}

export const SKIN_OPTIONS: SkinOption[] = [
    {
        id: 'classic_blue',
        name: '经典蓝',
        colorA: '#81ecff',
        colorB: '#4f7dff',
        code: 'AX-01',
        series: '标准竞技',
        rarity: '标准',
        finish: '冷光镜面',
        signature: '蓝白双层护膜，轮廓稳定，适合长时间主界面展示。',
        scenario: '大厅常驻',
        signal: '冷调清晰'
    },
    {
        id: 'mint_pop',
        name: '薄荷泡泡',
        colorA: '#56ffc0',
        colorB: '#1ac788',
        code: 'MN-22',
        series: '轻快社交',
        rarity: '进阶',
        finish: '清透荧彩',
        signature: '高亮薄荷核与柔和外晕，更偏轻盈和治愈的展示风格。',
        scenario: '社交轻展示',
        signal: '清透柔光'
    },
    {
        id: 'sunset_lava',
        name: '熔岩余晖',
        colorA: '#ffcf66',
        colorB: '#ff6b4a',
        code: 'SV-77',
        series: '热区冲锋',
        rarity: '稀有',
        finish: '熔融流釉',
        signature: '暖金到炽橙的熔流渐变，适合强调攻击性与爆发感。',
        scenario: '高压冲锋',
        signal: '炽热爆发'
    },
    {
        id: 'neon_violet',
        name: '霓虹紫电',
        colorA: '#d18bff',
        colorB: '#7657ff',
        code: 'NV-09',
        series: '夜幕霓虹',
        rarity: '史诗',
        finish: '高压电镀',
        signature: '紫电边缘与深空弧光并行，适合做大厅主视觉皮肤。',
        scenario: '主视觉展示',
        signal: '霓虹电弧'
    }
];

export function resolveSkinId(rawSkinId: string): string {
    return SKIN_OPTIONS.some((skin) => skin.id === rawSkinId) ? rawSkinId : SKIN_OPTIONS[0].id;
}

export function getSkinOption(rawSkinId: string): SkinOption {
    const skinId = resolveSkinId(rawSkinId);
    return SKIN_OPTIONS.find((skin) => skin.id === skinId) ?? SKIN_OPTIONS[0];
}
