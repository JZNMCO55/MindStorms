// The universal primitive. Every council member — your facets, your parallel
// selves, the mirror-self, your models of friends, public figures — is a Card.
// See docs/CONCEPT.md §2.

export type CardSource =
  | "self_facet" // 横切:当下你的内部切面(理性/感性/野心/保守)
  | "self_parallel" // 纵切:平行宇宙的你
  | "self_mirror" // 镜子:全部语料整合出的最高保真的你;只问不答
  | "relation" // 关系切:你印象里的他人
  | "figure"; // 名人/历史人物

export type Fidelity = "high" | "mid" | "low";

export type PublishPolicy = "freely" | "abstract_only" | "gated";

export interface Card {
  id: string;
  name: string;
  source: CardSource;
  /** Drives weighting / publish gating / default mode. Not just a label. */
  fidelity: Fidelity;
  /** self_parallel only: where this life branched off. */
  divergencePoint?: string;
  competence: string[];
  /** What it optimizes for, and what it's willing to sacrifice. */
  utility: string;
  timeHorizon?: string;
  voice: string;
  /** Anchor quotes mined from the user's own text (high-fidelity, local-only). */
  grounding: string[];
  provenanceLabel: string;
  publishPolicy: PublishPolicy;
}
