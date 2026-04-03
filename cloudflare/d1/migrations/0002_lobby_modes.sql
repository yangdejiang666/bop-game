CREATE TABLE IF NOT EXISTS game_modes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kicker TEXT,
    subtitle TEXT,
    icon TEXT,
    theme TEXT,
    status TEXT,
    bg_image_url TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO game_modes (id, name, kicker, subtitle, icon, theme, status, bg_image_url, sort_order)
VALUES 
('ranked', '排位赛', '竞技模式', '向最高荣誉发起冲锋', 'trophy', 'gold', '已开放', '/assets/images/ranked_bg.png', 1),
('peak', '巅峰赛', '精英模式', '冷感冲榜，争夺更高席位', 'military_tech', 'violet', '已开放', '/assets/images/peak_bg.png', 2),
('classic', '经典模式', '经典模式', '主球体舞台，轻快又熟悉', 'view_cozy', 'cyan', '已开放', '/assets/images/classic_bg.png', 3),
('battleRoyale', '大逃杀', '生存模式', '缩圈压迫，活到最后', 'local_fire_department', 'red', '已开放', '/assets/images/royale_bg.png', 4)
ON CONFLICT (id) DO UPDATE
SET 
    name = EXCLUDED.name,
    kicker = EXCLUDED.kicker,
    subtitle = EXCLUDED.subtitle,
    icon = EXCLUDED.icon,
    theme = EXCLUDED.theme,
    status = EXCLUDED.status,
    bg_image_url = EXCLUDED.bg_image_url,
    sort_order = EXCLUDED.sort_order,
    updated_at = datetime('now');
