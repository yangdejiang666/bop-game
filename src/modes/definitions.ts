import type { LobbyModeId } from "../ui/LobbyUI";

export type ModeHallTabId = "rules" | "rewards" | "records" | "guide";
export type ModeSidebarTabId = "friends" | "leaderboard" | "spectate";
export type ModeTheme = "gold" | "violet" | "cyan" | "amber" | "purple" | "red";
export type ModeHallLayoutId = LobbyModeId;

export interface BattleRoyalePhaseTimings {
  safeUntilSeconds: number;
  firstShrinkEndSeconds: number;
  secondShrinkEndSeconds: number;
  collapseEndSeconds: number;
  suddenDeathStartSeconds: number;
}

export interface BattleRoyaleSafeRectProfile {
  initialSize: number;
  phaseOneSize: number;
  phaseTwoSize: number;
  finalSize: number;
}

export interface BattleRoyaleDamageProfile {
  phase1: number;
  phase2: number;
  phase3: number;
  suddenDeath: number;
}

export interface BattleRoyaleRules {
  enabled: boolean;
  shape: "square";
  phaseTimings: BattleRoyalePhaseTimings;
  safeRect: BattleRoyaleSafeRectProfile;
  damagePerSecond: BattleRoyaleDamageProfile;
  suddenDeath: boolean;
}

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
  battleRoyale: BattleRoyaleRules;
}

export interface ModeHudProfile {
  emphasis: "competitive" | "elite" | "casual" | "rush" | "team" | "survival";
  showCombo: boolean;
  showTeamPanel: boolean;
  showZoneWarning: boolean;
}

export interface ModeSettlementProfile {
  style: "ranked" | "peak" | "classic" | "speed" | "team" | "battleRoyale";
  title: string;
  subtitle: string;
  revealPace: "cinematic" | "standard" | "fast";
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
  stageStyle: "honor" | "elite" | "orb" | "rush" | "squad" | "survival";
  ctaAnchor: "bottom-right" | "center-right";
}

export interface ModeIdentityStat {
  label: string;
  value: string;
  note: string;
}

export interface ModeIdentityHud {
  kicker: string;
  title: string;
  subtitle: string;
  badge: string;
  chips: string[];
  stats: ModeIdentityStat[];
}

export interface ModeQueueVariant {
  id: string;
  label: string;
  subtitle: string;
  hint: string;
  etaMultiplier: number;
}

export interface ModeSidebarSummary {
  kicker: string;
  title: string;
  description: string;
  chips: string[];
}

export interface ModeSidebarEntry {
  title: string;
  meta: string;
  badge: string;
  detail?: string;
}

export interface ModeTrayCard {
  kicker: string;
  headline: string;
  copy: string;
}

export interface ModeTraySection {
  label: string;
  title: string;
  subtitle: string;
  cards: ModeTrayCard[];
}

export interface ModeSceneAccent {
  overline: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  ctaLabel: string;
  ctaHint: string;
  ctaDetail: string;
  spotlight: string[];
  stageNotches: string[];
}

export interface ModePartyProfile {
  defaultExpanded: boolean;
  drawerTitle: string;
  drawerHint: string;
  primaryLabel: string;
  secondaryLabel: string;
}

export interface ModeHallContent {
  identityHud: ModeIdentityHud;
  queueVariants: ModeQueueVariant[];
  sidebarSummary: ModeSidebarSummary;
  leaderboardEntries: ModeSidebarEntry[];
  spectateEntries: ModeSidebarEntry[];
  traySections: Record<ModeHallTabId, ModeTraySection>;
  sceneAccent: ModeSceneAccent;
  party: ModePartyProfile;
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
  trayTab: ModeHallTabId;
  roomState: ModeHallRoomSnapshot;
  sidebarTab: ModeSidebarTabId;
  heroState: "idle" | "loading" | "ready" | "fallback";
  ctaState: "idle" | "ready" | "locked";
  layoutId: ModeHallLayoutId | null;
  breakpointBucket: "desktop" | "laptop" | "tablet" | "mobile";
  queueVariantId: string | null;
  partyPanelExpanded: boolean;
}

export interface ModeDefinition {
  id: LobbyModeId;
  name: string;
  theme: ModeTheme;
  iconId:
    | "mode_ranked"
    | "mode_peak"
    | "mode_classic"
    | "mode_speed"
    | "mode_team"
    | "mode_battleRoyale";
  heroModelPath: string;
  hall: ModeHallContent;
  gameplay: ModeGameplayRules;
  matching: ModeMatchmakingProfile;
  layout: ModeHallLayoutProfile;
  hud: ModeHudProfile;
  settlement: ModeSettlementProfile;
  social: ModeSocialProfile;
}

const cards = (...items: Array<[string, string, string]>): ModeTrayCard[] =>
  items.map(([kicker, headline, copy]) => ({ kicker, headline, copy }));

const tray = (
  label: string,
  title: string,
  subtitle: string,
  items: Array<[string, string, string]>,
): ModeTraySection => ({ label, title, subtitle, cards: cards(...items) });

const hall = (config: ModeHallContent): ModeHallContent => config;

const DISABLED_BATTLE_ROYALE_RULES: BattleRoyaleRules = {
  enabled: false,
  shape: "square",
  phaseTimings: {
    safeUntilSeconds: 0,
    firstShrinkEndSeconds: 0,
    secondShrinkEndSeconds: 0,
    collapseEndSeconds: 0,
    suddenDeathStartSeconds: 0,
  },
  safeRect: {
    initialSize: 0,
    phaseOneSize: 0,
    phaseTwoSize: 0,
    finalSize: 0,
  },
  damagePerSecond: {
    phase1: 0,
    phase2: 0,
    phase3: 0,
    suddenDeath: 0,
  },
  suddenDeath: false,
};

export const MODE_DEFINITIONS: Record<LobbyModeId, ModeDefinition> = {
  ranked: {
    id: "ranked",
    name: "排位赛",
    theme: "gold",
    iconId: "mode_ranked",
    heroModelPath: "/models/modes/ranked/hero.gltf",
    hall: hall({
      identityHud: {
        kicker: "赛季竞技身份",
        title: "荣耀晋级中",
        subtitle: "正式、稳定、围绕上分展开。",
        badge: "赛季 S3",
        chips: ["单排优先", "连胜 x1.2", "保护开启"],
        stats: [
          { label: "当前段位", value: "黄金 II", note: "距晋级还差 2 星" },
          { label: "赛季积分", value: "1386", note: "近 5 局净胜 +47" },
          { label: "预计时间", value: "7.2 秒", note: "16 人可开局" },
        ],
      },
      queueVariants: [
        { id: "solo", label: "单排", subtitle: "纯个人上分", hint: "最稳", etaMultiplier: 1 },
        { id: "duo", label: "双排", subtitle: "双人冲星", hint: "更重配合", etaMultiplier: 1.1 },
        { id: "trio", label: "三排", subtitle: "稳健抱团", hint: "保位更强", etaMultiplier: 1.18 },
      ],
      sidebarSummary: {
        kicker: "赛季摘要",
        title: "冲星窗口已打开",
        description: "把注意力放在段位、状态和开始匹配。",
        chips: ["剩余 12 天", "晋级保护 1 次", "观战开启"],
      },
      leaderboardEntries: [
        { title: "Aurora", meta: "1928 分 · 胜率 68%", badge: "#1" },
        { title: "Stone", meta: "1880 分 · 15 连胜", badge: "#2" },
        { title: "LumenFox", meta: "1842 分 · 金牌指挥", badge: "#3" },
      ],
      spectateEntries: [
        { title: "高星晋级赛", meta: "黄金 I -> 铂金 V", badge: "观战" },
        { title: "五连胜回放", meta: "4 分钟前 · 双排局", badge: "复盘" },
        { title: "赛季热点局", meta: "高分抢七中", badge: "进入" },
      ],
      traySections: {
        rules: tray("规则", "排位规则", "正式竞技，不抢主舞台。", [
          ["局内目标", "6 分钟标准竞技", "靠名次、连胜和稳定发挥拿分。"],
          ["匹配逻辑", "段位与表现共同拉齐", "优先保证强度接近与节奏稳定。"],
          ["结算说明", "星级与积分双轨变化", "保护局会抵消一次关键失利。"],
        ]),
        rewards: tray("奖励", "赛季奖励", "上分也在推动赛季荣誉。", [
          ["赛季里程碑", "黄金以上解锁赛季徽章", "晋级时同步点亮外显荣誉。"],
          ["每日冲分", "首胜奖励待领取", "每日第一场排位胜利收益更高。"],
          ["连胜加成", "当前连胜修正 x1.2", "稳定上分会持续加速收益。"],
        ]),
        records: tray("战绩", "最近战绩", "只保留有用的冲分信息。", [
          ["最近 5 局", "3 胜 1 晋级局 1 惜败", "节奏偏稳，适合继续单排。"],
          ["强势时段", "20:00 - 23:00 胜率更高", "建议在这个时间段集中上分。"],
          ["操作侧重点", "中盘发育效率提升明显", "继续保持稳开再中盘发力。"],
        ]),
        guide: tray("教学", "排位指南", "规则收进托盘里。", [
          ["开局建议", "前 60 秒不要乱撞", "优先攒体积和安全视野。"],
          ["晋级心态", "连败时切回双排", "先止损，再继续上分。"],
          ["复盘重点", "看中盘抱团和切边", "高分差通常出在中盘决策。"],
        ]),
      },
      sceneAccent: {
        overline: "Seasonal Honor Arena",
        title: "赛季主舞台",
        subtitle: "奖章、星级、连胜压力集中到中区。",
        statusLabel: "荣誉竞技",
        ctaLabel: "开始匹配",
        ctaHint: "锚定当前段位进入正式排位队列",
        ctaDetail: "推荐单排，匹配保护已生效",
        spotlight: ["赛季奖章", "晋级星轨", "连胜修正"],
        stageNotches: ["当前段位稳定", "推荐单排", "目标冲到铂金"],
      },
      party: {
        defaultExpanded: false,
        drawerTitle: "排位集结",
        drawerHint: "房间工具退到二级抽屉。",
        primaryLabel: "房间工具",
        secondaryLabel: "复制房间码、拉好友或切换准备状态",
      },
    }),
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
      battleRoyale: DISABLED_BATTLE_ROYALE_RULES,
    },
    matching: { targetPlayers: 50, minStartPlayers: 16, expectedSeconds: 7.2 },
    layout: { id: "ranked", stageStyle: "honor", ctaAnchor: "bottom-right" },
    hud: { emphasis: "competitive", showCombo: true, showTeamPanel: false, showZoneWarning: false },
    settlement: { style: "ranked", title: "Ranked Result", subtitle: "段位积分结算中", revealPace: "cinematic", cta: { replay: "继续上分", lobby: "返回大厅" } },
    social: { supportsRoom: true, roomSize: 4, supportsSpectate: true, supportsReplay: true },
  },
  peak: {
    id: "peak",
    name: "巅峰赛",
    theme: "violet",
    iconId: "mode_peak",
    heroModelPath: "/models/modes/peak/hero.gltf",
    hall: hall({
      identityHud: {
        kicker: "精英资格认证",
        title: "巅峰开放中",
        subtitle: "冷感、稀缺、只为冲榜玩家保留。",
        badge: "限时开放",
        chips: ["20:00 - 24:00", "资格已通过", "观战开启"],
        stats: [
          { label: "当前榜位", value: "#178", note: "今晚可冲前 150" },
          { label: "巅峰分", value: "2164", note: "距前 100 还差 91 分" },
          { label: "预计时间", value: "7.8 秒", note: "精英队列更高压" },
        ],
      },
      queueVariants: [
        { id: "qualification", label: "资格场", subtitle: "保位局", hint: "更稳守资格", etaMultiplier: 1 },
        { id: "ladder", label: "冲榜局", subtitle: "高压争榜", hint: "收益更高", etaMultiplier: 1.08 },
      ],
      sidebarSummary: {
        kicker: "精英摘要",
        title: "榜单波动窗口已到来",
        description: "巅峰更收、更冷、更看榜位和资格。",
        chips: ["前 100 差 91 分", "资格有效", "高分热战"],
      },
      leaderboardEntries: [
        { title: "Winter", meta: "2476 分 · 全服第一", badge: "#1" },
        { title: "RiftZero", meta: "2431 分 · 今晚 9 胜", badge: "#2" },
        { title: "GlassArc", meta: "2388 分 · 稳定冲榜", badge: "#3" },
      ],
      spectateEntries: [
        { title: "前十焦点局", meta: "最后一圈拉扯", badge: "进入" },
        { title: "资格保位战", meta: "高压守分中", badge: "观看" },
        { title: "精英复盘", meta: "12 分钟前 · 关键运营局", badge: "复盘" },
      ],
      traySections: {
        rules: tray("规则", "巅峰规则", "信息克制，强调榜单压力。", [
          ["高压时长", "8 分钟稀缺资源局", "资源更紧，失误惩罚更大。"],
          ["资格要求", "只开放给已达标玩家", "资格不足时只能围观看榜。"],
          ["榜位变化", "每局波动更明显", "高排名局收益远高于普通排位。"],
        ]),
        rewards: tray("奖励", "巅峰奖励", "稀缺感来自奖励也来自入口。", [
          ["榜单结算", "前 100 解锁限时称号", "榜位越高，展示越明显。"],
          ["额外收益", "金币与荣誉额外结算", "高分段奖励会继续放大。"],
          ["观战热度", "焦点局进入推荐位", "高热度对局更容易被围观。"],
        ]),
        records: tray("战绩", "巅峰表现", "只保留冲榜真正需要看的摘要。", [
          ["最近 3 局", "1 胜 1 保位 1 掉分", "适合继续冲榜局而不是保位局。"],
          ["强势阶段", "后半场拉扯能力更强", "你的翻盘多出在最后 3 分钟。"],
          ["波动控制", "今晚平均损失压到 18 分", "控波动比盲目连开更重要。"],
        ]),
        guide: tray("教学", "冲榜建议", "把高价值提示收进托盘。", [
          ["资格保护", "保位局用于止损", "不要把全部筹码压到冲榜局。"],
          ["观战价值", "优先看前十收圈处理", "巅峰差距常出在终局。"],
          ["队列节奏", "连开 3 局后再复盘", "先保持手感，再修正细节。"],
        ]),
      },
      sceneAccent: {
        overline: "Elite Peak Ladder",
        title: "巅峰主舞台",
        subtitle: "更高耸、更冷、更聚焦榜位。",
        statusLabel: "精英冲榜",
        ctaLabel: "开始挑战",
        ctaHint: "进入精英队列争取更高榜位",
        ctaDetail: "资格有效，当前属于冲榜窗口",
        spotlight: ["资格门槛", "全服榜位", "高压复盘"],
        stageNotches: ["冷感舞台", "榜位优先", "观战席热度高"],
      },
      party: {
        defaultExpanded: false,
        drawerTitle: "巅峰组队工具",
        drawerHint: "组队能力保留，但不打断冲榜主舞台。",
        primaryLabel: "精英集结",
        secondaryLabel: "更适合固定队短暂协同或复盘约局",
      },
    }),
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
      battleRoyale: DISABLED_BATTLE_ROYALE_RULES,
    },
    matching: { targetPlayers: 50, minStartPlayers: 18, expectedSeconds: 7.8 },
    layout: { id: "peak", stageStyle: "elite", ctaAnchor: "bottom-right" },
    hud: { emphasis: "elite", showCombo: true, showTeamPanel: false, showZoneWarning: false },
    settlement: { style: "peak", title: "Peak Result", subtitle: "冲榜结果结算中", revealPace: "cinematic", cta: { replay: "继续冲榜", lobby: "返回大厅" } },
    social: { supportsRoom: true, roomSize: 3, supportsSpectate: true, supportsReplay: true },
  },
  classic: {
    id: "classic",
    name: "经典模式",
    theme: "cyan",
    iconId: "mode_classic",
    heroModelPath: "/models/modes/classic/hero.gltf",
    hall: hall({
      identityHud: {
        kicker: "经典身份",
        title: "主球体待发",
        subtitle: "轻快、熟悉、最有球感的一块主舞台。",
        badge: "常驻模式",
        chips: ["上手最快", "球感最强", "成长稳定"],
        stats: [
          { label: "今日推荐", value: "海潮遗迹", note: "资源刷新节奏偏平稳" },
          { label: "最佳纪录", value: "1324kg", note: "离本周新纪录还差 89kg" },
          { label: "预计时间", value: "6.6 秒", note: "适合随时来一局" },
        ],
      },
      queueVariants: [
        { id: "solo", label: "单人", subtitle: "纯个人手感", hint: "最适合练基本功", etaMultiplier: 1 },
        { id: "duo", label: "双人", subtitle: "轻社交开局", hint: "拉一位好友一起打", etaMultiplier: 1.05 },
        { id: "free", label: "自由", subtitle: "随到随打", hint: "球感最轻快", etaMultiplier: 0.94 },
      ],
      sidebarSummary: {
        kicker: "经典摘要",
        title: "轻快开球，最熟悉的一局",
        description: "复杂条件最少，最适合练手、刷成长和保持球感。",
        chips: ["球感最强", "新手友好", "成长收益稳定"],
      },
      leaderboardEntries: [
        { title: "MintBubble", meta: "本周最佳 1886kg", badge: "#1" },
        { title: "CloverRoll", meta: "最快破千 2:08", badge: "#2" },
        { title: "SoftOrbit", meta: "经典场次 314 局", badge: "#3" },
      ],
      spectateEntries: [
        { title: "高质量自由局", meta: "经典球感示范局", badge: "观看" },
        { title: "新纪录回放", meta: "3 分钟前 · 破个人最佳", badge: "复盘" },
        { title: "教学示例局", meta: "前 90 秒发育演示", badge: "学习" },
      ],
      traySections: {
        rules: tray("规则", "经典规则", "熟悉感收进底部。", [
          ["标准节奏", "6 分钟轻竞技局", "最适合练基本功和手感。"],
          ["成长优先", "更看重平滑发育", "靠稳定吞噬建立优势。"],
          ["日常体验", "适合随时来一局", "是碎片时间最顺手的入口。"],
        ]),
        rewards: tray("奖励", "成长奖励", "稳定升级、刷记录、拿金币。", [
          ["常规收益", "经验与金币基础奖励", "经典模式是最稳定的成长来源。"],
          ["破纪录", "最佳纪录额外加成", "刷新个人最佳会额外给奖励。"],
          ["活跃任务", "每周任务推进最快", "很多任务都能顺手完成。"],
        ]),
        records: tray("战绩", "成长记录", "继续保留最关键的几组数据。", [
          ["本周走势", "平均质量稳定在 1080kg", "已经明显高于上周。"],
          ["纪录线", "距离周最佳只差 89kg", "建议继续自由局冲一波纪录。"],
          ["高光片段", "双杀翻盘出现在中后盘", "耐心发育仍然是核心。"],
        ]),
        guide: tray("教学", "经典教学", "以成长和手感为主。", [
          ["新手建议", "先练稳开，不急着找碰撞", "前期保住增速更重要。"],
          ["自由局技巧", "保持大球体移动惯性", "路线选择直接决定发育效率。"],
          ["复盘方向", "重点看被追击时脱身路线", "少丢一次大体积就能改一整局。"],
        ]),
      },
      sceneAccent: {
        overline: "Classic Orb Playground",
        title: "主球体舞台",
        subtitle: "中心球体更强、更轻、更有动感。",
        statusLabel: "经典开球",
        ctaLabel: "立即开球",
        ctaHint: "轻快进入一局，直接感受球感和成长反馈",
        ctaDetail: "推荐自由局，适合刷新纪录",
        spotlight: ["主球体", "轻快节奏", "成长记录"],
        stageNotches: ["最熟悉", "新手友好", "适合练球感"],
      },
      party: {
        defaultExpanded: false,
        drawerTitle: "经典房间工具",
        drawerHint: "也保留房间能力，但默认让位给主球体。",
        primaryLabel: "切到房间",
        secondaryLabel: "约好友开自由局或同步准备状态",
      },
    }),
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
      battleRoyale: DISABLED_BATTLE_ROYALE_RULES,
    },
    matching: { targetPlayers: 50, minStartPlayers: 14, expectedSeconds: 6.6 },
    layout: { id: "classic", stageStyle: "orb", ctaAnchor: "center-right" },
    hud: { emphasis: "casual", showCombo: true, showTeamPanel: false, showZoneWarning: false },
    settlement: { style: "classic", title: "Classic Result", subtitle: "经典对局已结算", revealPace: "standard", cta: { replay: "再来一局", lobby: "返回大厅" } },
    social: { supportsRoom: true, roomSize: 4, supportsSpectate: false, supportsReplay: true },
  },
  battleRoyale: {
    id: "battleRoyale",
    name: "大逃杀",
    theme: "red",
    iconId: "mode_battleRoyale",
    heroModelPath: "/models/modes/battleRoyale/hero.gltf",
    hall: hall({
      identityHud: {
        kicker: "生存身份",
        title: "危险圈已闭合",
        subtitle: "更紧张、更压迫、更强调风险与收益。",
        badge: "高危模式",
        chips: ["方形安全区", "终圈拼盾", "高风险高奖励"],
        stats: [
          { label: "初始边长", value: "7600", note: "40 秒后进入第一段收缩" },
          { label: "终圈伤害", value: "60 / 秒", note: "无安全区后只剩拼盾和残局" },
          { label: "预计时间", value: "8.4 秒", note: "高峰时段更容易成局" },
        ],
      },
      queueVariants: [
        { id: "solo", label: "单人求生", subtitle: "纯生存", hint: "更适合稳扎稳打", etaMultiplier: 1 },
        { id: "duo", label: "双人求生", subtitle: "双核互保", hint: "适合边缘运营", etaMultiplier: 1.08 },
        { id: "squad", label: "四人求生", subtitle: "高压编队", hint: "风险更高收益更足", etaMultiplier: 1.12 },
      ],
      sidebarSummary: {
        kicker: "生存摘要",
        title: "每条信息都该有危险感",
        description: "整体更紧、更暗、更有压迫感，核心是马上进入危险区。",
        chips: ["缩圈压迫", "高危收益", "观战热度高"],
      },
      leaderboardEntries: [
        { title: "RedMist", meta: "生存胜率 41%", badge: "#1" },
        { title: "AshOrbit", meta: "平均存活 5:28", badge: "#2" },
        { title: "GrimDrop", meta: "反杀次数 22", badge: "#3" },
      ],
      spectateEntries: [
        { title: "终圈决胜局", meta: "仅剩 6 人 · 高压拉扯", badge: "进入" },
        { title: "危险热区战", meta: "资源区混战中", badge: "观看" },
        { title: "生存复盘", meta: "缩圈运营教学", badge: "学习" },
      ],
      traySections: {
        rules: tray("规则", "生存规则", "缩圈与圈外伤害是底层压力。", [
          ["缩圈节奏", "两段半缩后进入无安全区", "拖延和站位错误都会被持续放大。"],
          ["伤害规则", "圈外持续掉体重", "最后 20 秒全图危险，只能靠护盾和残局处理。"],
          ["胜利条件", "活到最后", "更看位置、风控和终圈决策。"],
        ]),
        rewards: tray("奖励", "生存奖励", "越危险，越值得被强调。", [
          ["名次收益", "排名越高收益越高", "终圈名次带来的额外收益很明显。"],
          ["反杀奖励", "危险区反杀额外加成", "高风险击败会单独高亮。"],
          ["生存任务", "缩圈任务同步推进", "适合做高风险类周任务。"],
        ]),
        records: tray("战绩", "生存记录", "更关注你如何活下去。", [
          ["平均存活", "当前 4 分 52 秒", "下一步要练终圈决策。"],
          ["最好名次", "本周最好 Top 3", "离吃鸡只差最后一波判断。"],
          ["高光来源", "危险区反打成功率提升", "亮点来自边缘拉扯而不是硬拼。"],
        ]),
        guide: tray("教学", "热区与教学", "把危险提示和路线教学放在托盘里。", [
          ["开局落点", "避开第一波最热区", "先拿稳定发育空间。"],
          ["圈边运营", "边圈更适合做信息差", "高名次局不一定靠硬冲中心。"],
          ["终圈重点", "保命优先于贪质量", "最后 20 秒会进入无安全区，提前准备护盾。"],
        ]),
      },
      sceneAccent: {
        overline: "Last Orb Survival Zone",
        title: "危险主舞台",
        subtitle: "压迫感、收缩感、风险收益，都必须在第一眼成立。",
        statusLabel: "危险生存",
        ctaLabel: "进入战斗",
        ctaHint: "进入危险区，活到最后才算胜利",
        ctaDetail: "缩圈已启用，建议优先单排求生",
        spotlight: ["危险圈", "热区", "终圈决策"],
        stageNotches: ["更紧张", "更压迫", "更看风控"],
      },
      party: {
        defaultExpanded: false,
        drawerTitle: "生存组队工具",
        drawerHint: "保留房间与组队，但首页更强调危险区主舞台。",
        primaryLabel: "生存集结",
        secondaryLabel: "用于约队进入同一局或同步准备状态",
      },
    }),
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
        shape: "square",
        phaseTimings: {
          safeUntilSeconds: 40,
          firstShrinkEndSeconds: 140,
          secondShrinkEndSeconds: 220,
          collapseEndSeconds: 340,
          suddenDeathStartSeconds: 340,
        },
        safeRect: {
          initialSize: 7600,
          phaseOneSize: 3800,
          phaseTwoSize: 1900,
          finalSize: 0,
        },
        damagePerSecond: {
          phase1: 18,
          phase2: 28,
          phase3: 42,
          suddenDeath: 60,
        },
        suddenDeath: true,
      },
    },
    matching: { targetPlayers: 60, minStartPlayers: 20, expectedSeconds: 8.4 },
    layout: { id: "battleRoyale", stageStyle: "survival", ctaAnchor: "bottom-right" },
    hud: { emphasis: "survival", showCombo: false, showTeamPanel: false, showZoneWarning: true },
    settlement: { style: "battleRoyale", title: "Survival Result", subtitle: "生存排名与击败数据结算中", revealPace: "standard", cta: { replay: "再次生存", lobby: "返回大厅" } },
    social: { supportsRoom: true, roomSize: 4, supportsSpectate: true, supportsReplay: true },
  },
};

export function getModeDefinition(modeId: LobbyModeId): ModeDefinition {
  return MODE_DEFINITIONS[modeId] ?? MODE_DEFINITIONS.classic;
}
