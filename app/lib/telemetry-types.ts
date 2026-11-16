export interface TeamUnitInfo {
  slot: number;
  unit_id?: string;
  name: string;
  level: number;
  rarity?: string;
  trait?: string;
  traits?: string[];
  shiny?: boolean;
}

export interface PortalSummary {
  name: string;
  tier?: number;
  count: number;
  item_id?: string;
}

export interface PlacedUnitSummary {
  count: number;
  name: string;
  kills: number;
  upg_cur: number;
  upg_max: number;
}

export interface BaselineStats {
  gems: number;
  gold: number;
  summer_pearls: number;
  rerolls: number;
  level: number;
  wins: number;
  captured_at: number;
}

export interface MatchLogEntry {
  id: string;
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  device_name?: string;
  level: number;
  player_xp?: number;
  gems: number;
  gold: number;
  summer_pearls: number;
  rerolls: number;
  rewards: string[];
  portals: PortalSummary[];
  units: PlacedUnitSummary[];
  team?: TeamUnitInfo[];
  result: "VICTORY" | "DEFEAT";
  duration: string;
  wave: number;
  map_name: string;
  difficulty?: string;
  kills: number;
  damage: number;
  logged_at: number;
}
