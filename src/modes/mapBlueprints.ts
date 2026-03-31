import type { LobbyModeId } from "../ui/LobbyUI";

export type MapLayoutArchetype =
  | "symmetrical-control"
  | "compressed-elite"
  | "open-growth"
  | "survival-ring";

export type MapScaleProfile = "standard" | "expanded";
export type MapFeatureStatus = "ready" | "planned";

export interface ModeMapLandmark {
  name: string;
  role: string;
}

export interface ModeMapRectZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
}

export interface ModeMapAnchor {
  id: string;
  x: number;
  y: number;
  radius: number;
  weight: number;
}

export interface ModeMapFeature {
  name: string;
  status: MapFeatureStatus;
  gameplayGoal: string;
  implementationNote: string;
}

export interface ModeMapBlueprint {
  modeId: LobbyModeId;
  baseTemplate: "ranked-core-v1";
  worldSize: number;
  mapSignature: string;
  spawnZones: ModeMapRectZone[];
  foodHotspots: ModeMapAnchor[];
  virusAnchors: ModeMapAnchor[];
  safeCorridors: ModeMapRectZone[];
  layout: MapLayoutArchetype;
  scale: MapScaleProfile;
  differentiationGoal: string;
  combatLoop: string;
  resourceFlow: string;
  landmarks: ModeMapLandmark[];
  features: ModeMapFeature[];
  buildOrder: string[];
  acceptanceChecklist: string[];
}

export const MODE_MAP_BLUEPRINTS: Record<LobbyModeId, ModeMapBlueprint> = {
  ranked: {
    modeId: "ranked",
    baseTemplate: "ranked-core-v1",
    worldSize: 6000,
    mapSignature: "ranked-honor-cross-v1",
    spawnZones: [
      { id: "ranked-left-north", x: 1280, y: 1800, width: 880, height: 920, weight: 1 },
      { id: "ranked-left-south", x: 1280, y: 4200, width: 880, height: 920, weight: 1 },
      { id: "ranked-right-north", x: 4720, y: 1800, width: 880, height: 920, weight: 1 },
      { id: "ranked-right-south", x: 4720, y: 4200, width: 880, height: 920, weight: 1 },
    ],
    foodHotspots: [
      { id: "ranked-honor-mid", x: 3000, y: 3000, radius: 900, weight: 3.8 },
      { id: "ranked-left-lane", x: 1850, y: 3000, radius: 660, weight: 2.2 },
      { id: "ranked-right-lane", x: 4150, y: 3000, radius: 660, weight: 2.2 },
      { id: "ranked-top-pivot", x: 3000, y: 1720, radius: 420, weight: 1.1 },
      { id: "ranked-bottom-pivot", x: 3000, y: 4280, radius: 420, weight: 1.1 },
    ],
    virusAnchors: [
      { id: "ranked-mid-left", x: 2500, y: 3000, radius: 160, weight: 1.4 },
      { id: "ranked-mid-right", x: 3500, y: 3000, radius: 160, weight: 1.4 },
      { id: "ranked-left-top", x: 1950, y: 2260, radius: 170, weight: 1 },
      { id: "ranked-left-bottom", x: 1950, y: 3740, radius: 170, weight: 1 },
      { id: "ranked-right-top", x: 4050, y: 2260, radius: 170, weight: 1 },
      { id: "ranked-right-bottom", x: 4050, y: 3740, radius: 170, weight: 1 },
    ],
    safeCorridors: [
      { id: "ranked-left-corridor", x: 1820, y: 3000, width: 760, height: 2460, weight: 1 },
      { id: "ranked-right-corridor", x: 4180, y: 3000, width: 760, height: 2460, weight: 1 },
      { id: "ranked-center-control", x: 3000, y: 3000, width: 1440, height: 980, weight: 1 },
    ],
    layout: "symmetrical-control",
    scale: "standard",
    differentiationGoal:
      "排位赛作为竞技地图底盘，重点是对称、公平、稳定，不能靠随机事件决定胜负。",
    combatLoop:
      "开局平稳发育，中路争夺资源和视野，中后盘围绕双边拉扯与中心控制决胜。",
    resourceFlow:
      "中心高价值、边路稳定、出生区安全，保证强度主要来自运营和操作而不是地图随机性。",
    landmarks: [
      { name: "荣誉中庭", role: "排位主争夺区，承载中心资源和高频碰撞。" },
      { name: "左翼发育廊", role: "给稳健玩家提供侧路成长空间，也能做反打切入。" },
      { name: "右翼发育廊", role: "与左翼保持镜像平衡，避免出生侧强弱差。" },
      { name: "回旋缓冲湾", role: "给劣势方留一个短暂转线和脱战空间。" },
    ],
    features: [
      {
        name: "镜像出生点",
        status: "planned",
        gameplayGoal: "保证双方开局距离、资源密度、扎刺压力一致。",
        implementationNote: "先把排位地图作为所有竞技图的坐标模板。",
      },
      {
        name: "中心控制区",
        status: "planned",
        gameplayGoal: "让排位的核心博弈发生在中区，而不是全图乱撞。",
        implementationNote: "中心资源密度更高，但退出路线必须清晰可读。",
      },
      {
        name: "对称扎刺带",
        status: "planned",
        gameplayGoal: "增加操作上限，同时避免单边刺球数量失衡。",
        implementationNote: "中路和侧路都保留固定刺球锚点，不做随机刺墙。",
      },
    ],
    buildOrder: [
      "先做排位标准底盘：镜像出生、中心争夺区、双边发育廊。",
      "再补资源权重和扎刺锚点，确保对称性。",
      "最后再调优回旋区和终局收口体验。",
    ],
    acceptanceChecklist: [
      "任意出生侧 30 秒资源量差异不能明显偏斜。",
      "中路必须是最高强度争夺点，但不能只有一条撤退路线。",
      "玩家从截图上就能看出这是竞技地图而不是生存地图。",
    ],
  },
  peak: {
    modeId: "peak",
    baseTemplate: "ranked-core-v1",
    worldSize: 6000,
    mapSignature: "peak-funnel-bridge-v1",
    spawnZones: [
      { id: "peak-left-upper", x: 1550, y: 2480, width: 700, height: 720, weight: 1 },
      { id: "peak-left-lower", x: 1550, y: 3520, width: 700, height: 720, weight: 1 },
      { id: "peak-right-upper", x: 4450, y: 2480, width: 700, height: 720, weight: 1 },
      { id: "peak-right-lower", x: 4450, y: 3520, width: 700, height: 720, weight: 1 },
    ],
    foodHotspots: [
      { id: "peak-core", x: 3000, y: 3000, radius: 740, weight: 4.4 },
      { id: "peak-top-bridge", x: 3000, y: 2120, radius: 360, weight: 1.4 },
      { id: "peak-bottom-bridge", x: 3000, y: 3880, radius: 360, weight: 1.4 },
      { id: "peak-left-press", x: 2320, y: 3000, radius: 320, weight: 1.2 },
      { id: "peak-right-press", x: 3680, y: 3000, radius: 320, weight: 1.2 },
    ],
    virusAnchors: [
      { id: "peak-gate-lt", x: 2560, y: 2480, radius: 150, weight: 1.1 },
      { id: "peak-gate-lb", x: 2560, y: 3520, radius: 150, weight: 1.1 },
      { id: "peak-gate-rt", x: 3440, y: 2480, radius: 150, weight: 1.1 },
      { id: "peak-gate-rb", x: 3440, y: 3520, radius: 150, weight: 1.1 },
      { id: "peak-top-lock", x: 3000, y: 2050, radius: 140, weight: 0.9 },
      { id: "peak-bottom-lock", x: 3000, y: 3950, radius: 140, weight: 0.9 },
    ],
    safeCorridors: [
      { id: "peak-left-staging", x: 1710, y: 3000, width: 720, height: 1500, weight: 1 },
      { id: "peak-right-staging", x: 4290, y: 3000, width: 720, height: 1500, weight: 1 },
      { id: "peak-core-bridge", x: 3000, y: 3000, width: 1200, height: 1460, weight: 1 },
    ],
    layout: "compressed-elite",
    scale: "standard",
    differentiationGoal:
      "巅峰赛沿用排位底盘，但要更收、更冷、更高压，让高分局的失误成本明显提高。",
    combatLoop:
      "开局资源偏紧，中盘围绕强制汇聚点拉扯，终局更快收口，强调高压决策和榜位博弈。",
    resourceFlow:
      "总资源略少于排位，中区收益更高，侧路容错更低，鼓励精英玩家主动争核心区域。",
    landmarks: [
      { name: "巅峰焦点台", role: "中区高压争夺点，谁控住这里谁就能掌握节奏。" },
      { name: "冷锋切线道", role: "高风险侧切通道，适合高手做突然转线和包夹。" },
      { name: "终局收口桥", role: "后半局自然形成交火点，放大运营与反应差距。" },
      { name: "观战高光席", role: "保证巅峰局看起来更像焦点赛，更适合观战和复盘。" },
    ],
    features: [
      {
        name: "压缩主战区",
        status: "planned",
        gameplayGoal: "让巅峰赛比排位更早发生高质量交手。",
        implementationNote: "中区面积比排位更小，路线更直，躲避空间更少。",
      },
      {
        name: "高压刺阵门",
        status: "planned",
        gameplayGoal: "让进攻和撤退都更讲究时机，提升终局质量。",
        implementationNote: "在关键窄口放固定刺阵，不做大逃杀那种随机危险区。",
      },
      {
        name: "冷感榜位舞台",
        status: "planned",
        gameplayGoal: "从地图观感上就和排位拉开，建立精英模式氛围。",
        implementationNote: "色调、结构、留白都比排位更克制。",
      },
    ],
    buildOrder: [
      "基于排位底盘做一张收缩版巅峰图，不重新发明底层规则。",
      "优先压缩中区和关键窄口，先把高压感做出来。",
      "最后再做观战表现和终局收口优化。",
    ],
    acceptanceChecklist: [
      "同体量对局下，巅峰的首次强碰撞时间要早于排位。",
      "巅峰地图不能看起来只是排位换了配色。",
      "高手应能通过中区控制和窄口运营拉开差距。",
    ],
  },
  classic: {
    modeId: "classic",
    baseTemplate: "ranked-core-v1",
    worldSize: 6000,
    mapSignature: "classic-growth-ring-v1",
    spawnZones: [
      { id: "classic-north", x: 3000, y: 900, width: 1400, height: 760, weight: 1 },
      { id: "classic-south", x: 3000, y: 5100, width: 1400, height: 760, weight: 1 },
      { id: "classic-west", x: 900, y: 3000, width: 760, height: 1400, weight: 1 },
      { id: "classic-east", x: 5100, y: 3000, width: 760, height: 1400, weight: 1 },
      { id: "classic-nw", x: 1550, y: 1550, width: 780, height: 780, weight: 0.8 },
      { id: "classic-ne", x: 4450, y: 1550, width: 780, height: 780, weight: 0.8 },
      { id: "classic-sw", x: 1550, y: 4450, width: 780, height: 780, weight: 0.8 },
      { id: "classic-se", x: 4450, y: 4450, width: 780, height: 780, weight: 0.8 },
    ],
    foodHotspots: [
      { id: "classic-north-ring", x: 3000, y: 1500, radius: 760, weight: 2.1 },
      { id: "classic-east-ring", x: 4500, y: 3000, radius: 760, weight: 2.1 },
      { id: "classic-south-ring", x: 3000, y: 4500, radius: 760, weight: 2.1 },
      { id: "classic-west-ring", x: 1500, y: 3000, radius: 760, weight: 2.1 },
      { id: "classic-center-oasis", x: 3000, y: 3000, radius: 980, weight: 1.3 },
    ],
    virusAnchors: [
      { id: "classic-nw-cluster", x: 2140, y: 2140, radius: 170, weight: 1 },
      { id: "classic-ne-cluster", x: 3860, y: 2140, radius: 170, weight: 1 },
      { id: "classic-sw-cluster", x: 2140, y: 3860, radius: 170, weight: 1 },
      { id: "classic-se-cluster", x: 3860, y: 3860, radius: 170, weight: 1 },
      { id: "classic-north-pocket", x: 3000, y: 1560, radius: 140, weight: 0.9 },
      { id: "classic-south-pocket", x: 3000, y: 4440, radius: 140, weight: 0.9 },
      { id: "classic-west-pocket", x: 1560, y: 3000, radius: 140, weight: 0.9 },
      { id: "classic-east-pocket", x: 4440, y: 3000, radius: 140, weight: 0.9 },
    ],
    safeCorridors: [
      { id: "classic-center-horizontal", x: 3000, y: 3000, width: 3600, height: 980, weight: 1 },
      { id: "classic-center-vertical", x: 3000, y: 3000, width: 980, height: 3600, weight: 1 },
      { id: "classic-mid-oasis", x: 3000, y: 3000, width: 1400, height: 1400, weight: 1 },
    ],
    layout: "open-growth",
    scale: "standard",
    differentiationGoal:
      "经典模式要回到轻快、熟悉、最有球感的体验，不要给玩家过多模式专属惩罚。",
    combatLoop:
      "前期自由发育，中期围绕开放区域自然碰撞，后期靠体积与路线选择建立优势。",
    resourceFlow:
      "资源分布更平滑，成长路线更圆润，给新手足够呼吸空间，也给老玩家刷纪录的手感。",
    landmarks: [
      { name: "海潮遗迹", role: "主视觉中心，用来承接经典模式的熟悉感。" },
      { name: "外环成长圈", role: "给新手和刷纪录玩家提供稳定发育路线。" },
      { name: "回旋练习区", role: "低风险转线区，降低新手被瞬间打崩的概率。" },
      { name: "自然刺团", role: "保留经典操作空间，但不做高压封锁。" },
    ],
    features: [
      {
        name: "平滑资源环",
        status: "planned",
        gameplayGoal: "让经典模式更适合练球感和稳定成长。",
        implementationNote: "避免排位式中路极端资源集中。",
      },
      {
        name: "低惩罚逃生口",
        status: "planned",
        gameplayGoal: "降低新手在前 90 秒被直接淘汰的挫败感。",
        implementationNote: "保留两到三条明显可读的绕行线。",
      },
      {
        name: "固定刺球团",
        status: "planned",
        gameplayGoal: "提供基础操作空间，但不强迫所有玩家频繁赌刺。",
        implementationNote: "刺球密度低于排位和巅峰，位置更易预判。",
      },
    ],
    buildOrder: [
      "先做一张开放式经典地图，保证移动和发育顺滑。",
      "再调资源环和回旋区，让新手、刷纪录、练手感都舒服。",
      "最后再补视觉锚点和轻量刺球分布。",
    ],
    acceptanceChecklist: [
      "玩家前 60 秒应该明显比排位更安全、更自由。",
      "经典图的主观体验必须是顺滑，而不是高压。",
      "地图读感要一眼看出这是常驻基础模式。",
    ],
  },
  battleRoyale: {
    modeId: "battleRoyale",
    baseTemplate: "ranked-core-v1",
    worldSize: 7600,
    mapSignature: "battle-square-survival-v1",
    spawnZones: [
      { id: "br-north-west", x: 1180, y: 1180, width: 1080, height: 1080, weight: 1 },
      { id: "br-north", x: 3800, y: 920, width: 1540, height: 820, weight: 0.84 },
      { id: "br-north-east", x: 6420, y: 1180, width: 1080, height: 1080, weight: 1 },
      { id: "br-east", x: 6680, y: 3800, width: 820, height: 1540, weight: 0.84 },
      { id: "br-south-east", x: 6420, y: 6420, width: 1080, height: 1080, weight: 1 },
      { id: "br-south", x: 3800, y: 6680, width: 1540, height: 820, weight: 0.84 },
      { id: "br-south-west", x: 1180, y: 6420, width: 1080, height: 1080, weight: 1 },
      { id: "br-west", x: 920, y: 3800, width: 820, height: 1540, weight: 0.84 },
    ],
    foodHotspots: [
      { id: "br-nw-depot", x: 1560, y: 1560, radius: 620, weight: 1.8 },
      { id: "br-ne-depot", x: 6040, y: 1560, radius: 620, weight: 1.8 },
      { id: "br-se-depot", x: 6040, y: 6040, radius: 620, weight: 1.8 },
      { id: "br-sw-depot", x: 1560, y: 6040, radius: 620, weight: 1.8 },
      { id: "br-north-band", x: 3800, y: 1520, radius: 700, weight: 1.25 },
      { id: "br-south-band", x: 3800, y: 6080, radius: 700, weight: 1.25 },
      { id: "br-center-basin", x: 3800, y: 3800, radius: 1180, weight: 1.5 },
    ],
    virusAnchors: [
      { id: "br-upper-left", x: 2860, y: 2440, radius: 200, weight: 1 },
      { id: "br-upper-right", x: 4740, y: 2440, radius: 200, weight: 1 },
      { id: "br-left-mid", x: 2440, y: 3800, radius: 200, weight: 1 },
      { id: "br-right-mid", x: 5160, y: 3800, radius: 200, weight: 1 },
      { id: "br-lower-left", x: 2860, y: 5160, radius: 200, weight: 1 },
      { id: "br-lower-right", x: 4740, y: 5160, radius: 200, weight: 1 },
      { id: "br-north-ridge", x: 3800, y: 1900, radius: 180, weight: 0.9 },
      { id: "br-south-ridge", x: 3800, y: 5700, radius: 180, weight: 0.9 },
    ],
    safeCorridors: [
      { id: "br-vertical-lane", x: 3800, y: 3800, width: 980, height: 5320, weight: 1 },
      { id: "br-horizontal-lane", x: 3800, y: 3800, width: 5320, height: 980, weight: 1 },
      { id: "br-center-basin", x: 3800, y: 3800, width: 1680, height: 1680, weight: 1 },
    ],
    layout: "survival-ring",
    scale: "expanded",
    differentiationGoal:
      "大逃杀不能只是排位图加缩圈，必须把红区、吊刺、护盾、安全圈都做成真正影响路线和生存决策的机制。",
    combatLoop:
      "开局分散搜发育，中期被红区与安全圈挤压转线，后期围绕终圈盆地做生存、反打与收割。",
    resourceFlow:
      "中心高风险高收益，外环保留补给站和护盾点，安全圈迁移要持续改变强弱区。",
    landmarks: [
      { name: "初始安全圈", role: "定义开局第一阶段的安全活动范围，承接现有缩圈逻辑。" },
      { name: "红区轰炸带", role: "高风险区域，逼迫玩家做绕路或强冲选择。" },
      { name: "吊刺峡谷", role: "用吊刺和窄口塑造高压通过点，强化生存感。" },
      { name: "护盾哨站", role: "提供短时护盾资源，形成争夺热点。" },
      { name: "终圈盆地", role: "最后决战区，强调视野、圈边运营和残局判断。" },
    ],
    features: [
      {
        name: "安全圈与圈外灼烧",
        status: "ready",
        gameplayGoal: "保证大逃杀的核心收缩压力已经成立。",
        implementationNote: "当前已有缩圈和圈外持续掉血逻辑，可直接作为第一版底座。",
      },
      {
        name: "红区轰炸",
        status: "planned",
        gameplayGoal: "让地图不只是缩圈，还要有阶段性高危区域切分路线。",
        implementationNote: "建议先做固定时段、固定形状的红区，再扩展到随机批次。",
      },
      {
        name: "吊刺区",
        status: "planned",
        gameplayGoal: "在桥口、峡谷和补给路线上做强风险通道。",
        implementationNote: "先用固定吊刺链做窄口压力，不要一开始就铺满全图。",
      },
      {
        name: "护盾哨站",
        status: "planned",
        gameplayGoal: "给劣势方一个抢机制翻盘的机会，也制造资源争夺热点。",
        implementationNote: "优先做短时护盾和明显视觉提示，避免变成无脑必拿点。",
      },
      {
        name: "终圈高光区",
        status: "planned",
        gameplayGoal: "让最后一分钟的地图体验和其他模式完全不同。",
        implementationNote: "终圈盆地要保证可观战、可复盘、可形成残局故事。",
      },
    ],
    buildOrder: [
      "先在现有安全圈逻辑上做一张大尺度生存地图，不要沿用排位小尺度结构。",
      "第一阶段优先补红区和终圈盆地，把生存感立住。",
      "第二阶段再补吊刺区和护盾哨站，形成路线和资源博弈。",
    ],
    acceptanceChecklist: [
      "玩家第一眼就能看出这是生存地图，而不是竞技对称图。",
      "前中后期至少各有一个模式专属决策点：进圈、避红区、抢护盾、打终圈。",
      "大逃杀地图的危险感必须明显高于排位、巅峰、经典。",
    ],
  },
};

export const MAP_BLUEPRINT_DEVELOPMENT_ORDER: LobbyModeId[] = [
  "ranked",
  "classic",
  "peak",
  "battleRoyale",
];

export function getModeMapBlueprint(modeId: LobbyModeId): ModeMapBlueprint {
  return MODE_MAP_BLUEPRINTS[modeId] ?? MODE_MAP_BLUEPRINTS.classic;
}
