import type { CardSource } from "./card";
import type { Mode } from "./session";

export type AvatarKind = "crystal" | "pyramid" | "heart" | "hourglass" | "orb";

/**
 * A parallel-world self: a version of "you" that branched off the main world.
 * Personality is a *property* of the world (born from its backstory), not a
 * separate axis. The main-world you (Universe-Prime) is the anchor they diverge
 * from and the one who ultimately decides.
 */
export interface CouncilMember {
  id: string;
  worldId: string; // 世界编号, e.g. "C-17"
  nameEn: string;
  nameZh: string;
  source: CardSource;
  accent: string; // 6-digit hex
  avatar: AvatarKind;
  backstory: string; // 经历:这个世界的我发生了什么
  resonance: number; // 共鸣度 0–100:这个世界与主世界的你有多共振
  utilityTitle: string;
  utilityDesc: string;
  timeHorizon: string;
  timeHorizonDesc: string;
  catchphrase: string;
  voiceTags: string[];
  provenanceLabel?: string;
  corrections?: string[]; // 纠错回路：用户对这张卡的纠正记录
  saved?: boolean; // true=已收入卡池(常驻); falsy=本场访客(临时召唤,未入库)
}

export interface DebateMessage {
  id: string;
  memberId: string; // 或特殊值 "__user__" / "__sys__" / "__crux__"
  text: string;
  time: string;
  cardName?: string;
  replyTo?: string; // 群聊式引用：这条在回应的那条消息 id（可空＝不引用）
}

/** A past or current conversation; carries its own cast and transcript. */
export interface Conversation {
  id: string;
  topic: string;
  date: string;
  mode: Mode;
  round: number;
  totalRounds: number;
  speakingId?: string;
  memberIds: string[];
  messages: DebateMessage[];
}
