import type { LobbyModeId } from '../ui/LobbyUI';

export type ModeHallTabId = 'rules' | 'rewards' | 'map';

export type ModeTheme = 'gold' | 'violet' | 'cyan' | 'amber' | 'purple' | 'red';
export type ModeHallLayoutId = LobbyModeId;

export interface ModeGameplayRules {
    timed: boolean;
    durationSeconds: number;
    foodTarget: number;
    virusTarget: number;
    decayMultiplier: number;
    speedMultiplier: number;
    scoreMultiplier: number;
    rankPointMultiplier: number;
    teamMode: boolean;
    battleRoyale: {
        enabled: boolean;
        initialRadius: number;
        finalRadius: number;
        shrinkStartSeconds: number;
        shrinkDurationSeconds: number;
        outOfZoneDamagePerSecond: number;
    };
}

export interface ModeHudProfile {
    emphasis: 'competitive' | 'elite' | 'casual' | 'rush' | 'team' | 'survival';
    showCombo: boolean;
    showTeamPanel: boolean;
    showZoneWarning: boolean;
}

export interface ModeSettlementProfile {
    style: 'ranked' | 'peak' | 'classic' | 'speed' | 'team' | 'battleRoyale';
    title: string;
    subtitle: string;
    revealPace: 'cinematic' | 'standard' | 'fast';
    cta: {
        replay: string;
        lobby: string;
    };
}

export interface ModeSocialProfile {
    supportsRoom: boolean;
    roomSize: number;
    supportsSpectate: boolean;
    supportsReplay: boolean;
}

export interface ModeMatchmakingProfile {
    targetPlayers: number;
    minStartPlayers: number;
    expectedSeconds: number;
}

export interface ModeHallLayoutProfile {
    id: ModeHallLayoutId;
    columnsDesktop: string;
    leftRows: string;
    centerRows: string;
    rightRows: string;
    footerColumns: string;
}

export interface ModeHallContent {
    heroTitle: string;
    heroSubtitle: string;
    operationTitle: string;
    operationDescription: string;
    intelTitle: string;
    intelEntries: string[];
    tabContent: Record<ModeHallTabId, string[]>;
}

export interface ModeHallRoomSnapshot {
    created: boolean;
    code: string;
    leaderId: string | null;
    members: Array<{
        id: string;
        name: string;
        ready: boolean;
        isBot: boolean;
    }>;
    lastCheck: string;
}

export interface ModeHallState {
    modeId: LobbyModeId | null;
    tabId: ModeHallTabId;
    roomState: ModeHallRoomSnapshot;
    socialTab: 'friends' | 'spectate';
    heroState: 'idle' | 'loading' | 'ready' | 'fallback';
    ctaState: 'idle' | 'ready' | 'locked';
    layoutId: ModeHallLayoutId | null;
    breakpointBucket: 'desktop' | 'laptop' | 'tablet' | 'mobile';
}

export interface ModeDefinition {
    id: LobbyModeId;
    name: string;
    theme: ModeTheme;
    iconId:
        | 'mode_ranked'
        | 'mode_peak'
        | 'mode_classic'
        | 'mode_speed'
        | 'mode_team'
        | 'mode_battleRoyale';
    heroModelPath: string;
    hall: ModeHallContent;
    gameplay: ModeGameplayRules;
    matching: ModeMatchmakingProfile;
    layout: ModeHallLayoutProfile;
    hud: ModeHudProfile;
    settlement: ModeSettlementProfile;
    social: ModeSocialProfile;
}

export const MODE_DEFINITIONS: Record<LobbyModeId, ModeDefinition> = {
    ranked: {
        id: 'ranked',
        name: '排位赛',
        theme: 'gold',
        iconId: 'mode_ranked',
        heroModelPath: '/models/modes/ranked/hero.gltf',
        hall: {
            heroTitle: '赛季奖章荣耀战场',
            heroSubtitle: '冲分、晋级、连胜加成，争夺赛季排名。',
            operationTitle: '竞技匹配',
            operationDescription: '支持单排/双排/多排，按段位匹配。',
            intelTitle: '赛季情报',
            intelEntries: ['赛季剩余 12 天', '当前段位：黄金 II', '连胜加成：x1.2'],
            tabContent: {
                rules: ['6 分钟限时', '按个人质量排名', '结算排位积分与连胜修正'],
                rewards: ['赛季徽章', '段位金币奖励', '连胜额外经验'],
                map: ['标准竞技场轮换', '资源均衡刷新', '对局回放入口']
            }
        },
        gameplay: {
            timed: true,
            durationSeconds: 360,
            foodTarget: 1300,
            virusTarget: 14,
            decayMultiplier: 1.05,
            speedMultiplier: 1,
            scoreMultiplier: 1.2,
            rankPointMultiplier: 1.25,
            teamMode: false,
            battleRoyale: {
                enabled: false,
                initialRadius: 0,
                finalRadius: 0,
                shrinkStartSeconds: 0,
                shrinkDurationSeconds: 0,
                outOfZoneDamagePerSecond: 0
            }
        },
        matching: {
            targetPlayers: 50,
            minStartPlayers: 16,
            expectedSeconds: 7.2
        },
        layout: {
            id: 'ranked',
            columnsDesktop: '6fr 10fr 8fr',
            leftRows: 'auto minmax(0, 1fr) auto',
            centerRows: '112px 0px minmax(0, 1fr) 88px',
            rightRows: '72px 72px 72px minmax(0, 1fr)',
            footerColumns: '2fr 3fr'
        },
        hud: {
            emphasis: 'competitive',
            showCombo: true,
            showTeamPanel: false,
            showZoneWarning: false
        },
        settlement: {
            style: 'ranked',
            title: 'Ranked Result',
            subtitle: '段位积分结算中',
            revealPace: 'cinematic',
            cta: {
                replay: '继续上分',
                lobby: '返回大厅'
            }
        },
        social: {
            supportsRoom: true,
            roomSize: 4,
            supportsSpectate: true,
            supportsReplay: true
        }
    },
    peak: {
        id: 'peak',
        name: '巅峰赛',
        theme: 'violet',
        iconId: 'mode_peak',
        heroModelPath: '/models/modes/peak/hero.gltf',
        hall: {
            heroTitle: '巅峰冲榜计划',
            heroSubtitle: '高压高回报，挑战区服与全服榜位。',
            operationTitle: '精英入场',
            operationDescription: '达到资格后可进入巅峰匹配。',
            intelTitle: '巅峰情报',
            intelEntries: ['开放时段：20:00 - 24:00', '当前榜位：#178', '今日冲榜奖励已解锁'],
            tabContent: {
                rules: ['8 分钟高压对局', '资源更稀，衰减更强', '榜位优先与积分波动加大'],
                rewards: ['巅峰徽章', '排名额外金币', '高分段限时称号'],
                map: ['精英地图池', '观战入口', '对局复盘']
            }
        },
        gameplay: {
            timed: true,
            durationSeconds: 480,
            foodTarget: 900,
            virusTarget: 10,
            decayMultiplier: 1.22,
            speedMultiplier: 0.96,
            scoreMultiplier: 1.35,
            rankPointMultiplier: 1.5,
            teamMode: false,
            battleRoyale: {
                enabled: false,
                initialRadius: 0,
                finalRadius: 0,
                shrinkStartSeconds: 0,
                shrinkDurationSeconds: 0,
                outOfZoneDamagePerSecond: 0
            }
        },
        matching: {
            targetPlayers: 50,
            minStartPlayers: 18,
            expectedSeconds: 7.8
        },
        layout: {
            id: 'peak',
            columnsDesktop: '5fr 11fr 8fr',
            leftRows: 'auto minmax(0, 1fr) 92px',
            centerRows: '96px 0px minmax(0, 1fr) 0px',
            rightRows: 'minmax(88px, 0.4fr) minmax(0, 0.22fr) 44px minmax(0, 0.38fr)',
            footerColumns: '1.2fr 1fr 1fr'
        },
        hud: {
            emphasis: 'elite',
            showCombo: true,
            showTeamPanel: false,
            showZoneWarning: false
        },
        settlement: {
            style: 'peak',
            title: 'Peak Result',
            subtitle: '冲榜结果结算中',
            revealPace: 'cinematic',
            cta: {
                replay: '继续冲榜',
                lobby: '返回大厅'
            }
        },
        social: {
            supportsRoom: true,
            roomSize: 3,
            supportsSpectate: true,
            supportsReplay: true
        }
    },
    classic: {
        id: 'classic',
        name: '经典模式',
        theme: 'cyan',
        iconId: 'mode_classic',
        heroModelPath: '/models/modes/classic/hero.gltf',
        hall: {
            heroTitle: '经典吞噬乐园',
            heroSubtitle: '轻竞技体验，最熟悉的球球手感。',
            operationTitle: '快速开始',
            operationDescription: '经典单人体验，适合日常练手。',
            intelTitle: '经典情报',
            intelEntries: ['今日推荐地图：海潮遗迹', '新手任务：进行中', '热门皮肤：薄荷泡泡'],
            tabContent: {
                rules: ['6 分钟轻竞技', '标准资源密度', '强调成长与记录'],
                rewards: ['经验与金币基础奖励', '新纪录额外加成', '每周活跃奖励'],
                map: ['经典地图轮换', '教学与技巧指引', '热区提示']
            }
        },
        gameplay: {
            timed: true,
            durationSeconds: 360,
            foodTarget: 1200,
            virusTarget: 12,
            decayMultiplier: 1,
            speedMultiplier: 1,
            scoreMultiplier: 1,
            rankPointMultiplier: 1,
            teamMode: false,
            battleRoyale: {
                enabled: false,
                initialRadius: 0,
                finalRadius: 0,
                shrinkStartSeconds: 0,
                shrinkDurationSeconds: 0,
                outOfZoneDamagePerSecond: 0
            }
        },
        matching: {
            targetPlayers: 50,
            minStartPlayers: 14,
            expectedSeconds: 6.6
        },
        layout: {
            id: 'classic',
            columnsDesktop: '9fr 7fr 8fr',
            leftRows: 'auto minmax(0, 1fr) auto',
            centerRows: '88px 0px minmax(0, 1fr) 108px',
            rightRows: '84px 0px 44px minmax(0, 1fr)',
            footerColumns: 'repeat(3, minmax(0, 1fr))'
        },
        hud: {
            emphasis: 'casual',
            showCombo: true,
            showTeamPanel: false,
            showZoneWarning: false
        },
        settlement: {
            style: 'classic',
            title: 'Classic Result',
            subtitle: '经典对局已结算',
            revealPace: 'standard',
            cta: {
                replay: '再来一局',
                lobby: '返回大厅'
            }
        },
        social: {
            supportsRoom: true,
            roomSize: 4,
            supportsSpectate: false,
            supportsReplay: true
        }
    },
    speed: {
        id: 'speed',
        name: '极速模式',
        theme: 'amber',
        iconId: 'mode_speed',
        heroModelPath: '/models/modes/speed/hero.gltf',
        hall: {
            heroTitle: '极限冲刺战场',
            heroSubtitle: '短时高强刺激，连续爆发增长。',
            operationTitle: '冲刺开局',
            operationDescription: '3 分钟快局，节奏拉满。',
            intelTitle: '极速情报',
            intelEntries: ['平均局长：180 秒', '连击奖励：开启', '推荐人数：1-2 人'],
            tabContent: {
                rules: ['180 秒快局', '食物刷新倍率提升', '连击奖励结算'],
                rewards: ['极速挑战积分', '连击额外经验', '快局首胜奖励'],
                map: ['速度地图池', '冲刺路线提示', '教学回放']
            }
        },
        gameplay: {
            timed: true,
            durationSeconds: 180,
            foodTarget: 1900,
            virusTarget: 9,
            decayMultiplier: 0.88,
            speedMultiplier: 1.2,
            scoreMultiplier: 1.4,
            rankPointMultiplier: 1.1,
            teamMode: false,
            battleRoyale: {
                enabled: false,
                initialRadius: 0,
                finalRadius: 0,
                shrinkStartSeconds: 0,
                shrinkDurationSeconds: 0,
                outOfZoneDamagePerSecond: 0
            }
        },
        matching: {
            targetPlayers: 40,
            minStartPlayers: 12,
            expectedSeconds: 5.4
        },
        layout: {
            id: 'speed',
            columnsDesktop: '4fr 12fr 8fr',
            leftRows: 'auto minmax(0, 1fr) 72px',
            centerRows: '72px 0px minmax(0, 1fr) 72px',
            rightRows: '68px 68px 68px minmax(0, 1fr)',
            footerColumns: 'repeat(4, minmax(0, 1fr))'
        },
        hud: {
            emphasis: 'rush',
            showCombo: true,
            showTeamPanel: false,
            showZoneWarning: false
        },
        settlement: {
            style: 'speed',
            title: 'Speed Result',
            subtitle: '极速奖励结算中',
            revealPace: 'fast',
            cta: {
                replay: '继续冲刺',
                lobby: '返回大厅'
            }
        },
        social: {
            supportsRoom: true,
            roomSize: 3,
            supportsSpectate: false,
            supportsReplay: true
        }
    },
    team: {
        id: 'team',
        name: '团队模式',
        theme: 'purple',
        iconId: 'mode_team',
        heroModelPath: '/models/modes/team/hero.gltf',
        hall: {
            heroTitle: '协同作战联结体',
            heroSubtitle: '队伍配合与协作吞噬，争夺团队胜利。',
            operationTitle: '组队匹配',
            operationDescription: '支持房间、邀请与准备流程。',
            intelTitle: '团队情报',
            intelEntries: ['推荐阵容：4 人队', '协作奖励：开启', '队伍频道：可用'],
            tabContent: {
                rules: ['6 分钟团队对抗', '按队伍总质量结算', '计入协作指标'],
                rewards: ['队伍胜场奖励', '协作任务加成', '团队里程碑奖励'],
                map: ['团队地图池', '战术标签', '观战入口']
            }
        },
        gameplay: {
            timed: true,
            durationSeconds: 360,
            foodTarget: 1400,
            virusTarget: 16,
            decayMultiplier: 1.02,
            speedMultiplier: 1,
            scoreMultiplier: 1.2,
            rankPointMultiplier: 1.15,
            teamMode: true,
            battleRoyale: {
                enabled: false,
                initialRadius: 0,
                finalRadius: 0,
                shrinkStartSeconds: 0,
                shrinkDurationSeconds: 0,
                outOfZoneDamagePerSecond: 0
            }
        },
        matching: {
            targetPlayers: 40,
            minStartPlayers: 12,
            expectedSeconds: 6
        },
        layout: {
            id: 'team',
            columnsDesktop: '4fr 13fr 7fr',
            leftRows: 'auto minmax(0, 0.62fr) minmax(56px, 0.38fr)',
            centerRows: '72px 84px minmax(0, 1fr) 84px',
            rightRows: '84px 0px 44px minmax(0, 1fr)',
            footerColumns: '2fr 1fr 1fr'
        },
        hud: {
            emphasis: 'team',
            showCombo: true,
            showTeamPanel: true,
            showZoneWarning: false
        },
        settlement: {
            style: 'team',
            title: 'Team Result',
            subtitle: '协作贡献与队伍成绩结算中',
            revealPace: 'cinematic',
            cta: {
                replay: '团队再战',
                lobby: '返回大厅'
            }
        },
        social: {
            supportsRoom: true,
            roomSize: 5,
            supportsSpectate: true,
            supportsReplay: true
        }
    },
    battleRoyale: {
        id: 'battleRoyale',
        name: '大逃杀',
        theme: 'red',
        iconId: 'mode_battleRoyale',
        heroModelPath: '/models/modes/battleRoyale/hero.gltf',
        hall: {
            heroTitle: '危险圈生存协议',
            heroSubtitle: '缩圈压迫，活到最后才是胜利。',
            operationTitle: '生存挑战',
            operationDescription: '单排/组队均可进入高压生存战场。',
            intelTitle: '生存情报',
            intelEntries: ['安全区缩圈已启用', '圈外持续伤害', '高风险高奖励'],
            tabContent: {
                rules: ['360 秒生存局', '安全区持续收缩', '圈外每秒受到伤害'],
                rewards: ['生存排名奖励', '反杀加成', '生存任务奖励'],
                map: ['危险热区轮换', '安全区预测', '教学回放']
            }
        },
        gameplay: {
            timed: true,
            durationSeconds: 360,
            foodTarget: 950,
            virusTarget: 8,
            decayMultiplier: 1.14,
            speedMultiplier: 1.03,
            scoreMultiplier: 1.25,
            rankPointMultiplier: 1.2,
            teamMode: false,
            battleRoyale: {
                enabled: true,
                initialRadius: 2800,
                finalRadius: 580,
                shrinkStartSeconds: 40,
                shrinkDurationSeconds: 220,
                outOfZoneDamagePerSecond: 18
            }
        },
        matching: {
            targetPlayers: 60,
            minStartPlayers: 20,
            expectedSeconds: 8.4
        },
        layout: {
            id: 'battleRoyale',
            columnsDesktop: '8fr 10fr 7fr',
            leftRows: 'auto minmax(0, 1fr) auto',
            centerRows: '76px 52px minmax(0, 1fr) 64px',
            rightRows: '164px 44px 44px minmax(0, 1fr)',
            footerColumns: 'repeat(3, minmax(0, 1fr))'
        },
        hud: {
            emphasis: 'survival',
            showCombo: false,
            showTeamPanel: false,
            showZoneWarning: true
        },
        settlement: {
            style: 'battleRoyale',
            title: 'Survival Result',
            subtitle: '生存排名与击败数据结算中',
            revealPace: 'standard',
            cta: {
                replay: '再次生存',
                lobby: '返回大厅'
            }
        },
        social: {
            supportsRoom: true,
            roomSize: 4,
            supportsSpectate: true,
            supportsReplay: true
        }
    }
};

export function getModeDefinition(modeId: LobbyModeId): ModeDefinition {
    return MODE_DEFINITIONS[modeId] ?? MODE_DEFINITIONS.classic;
}
