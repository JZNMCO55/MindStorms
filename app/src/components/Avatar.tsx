import type { ReactNode } from "react";
import type { AvatarKind } from "../types/council";

const SHAPES: Record<AvatarKind, ReactNode> = {
  crystal: (
    <>
      <polygon points="50,12 84,32 84,68 50,88 16,68 16,32" />
      <path d="M50,12 L50,88 M16,32 L84,68 M84,32 L16,68 M16,32 L84,32 M16,68 L84,68" />
    </>
  ),
  pyramid: (
    <>
      <polygon points="50,16 86,82 14,82" />
      <path d="M50,16 L50,82 M50,16 L34,82 M50,16 L66,82" />
    </>
  ),
  heart: (
    <path d="M50,84 C18,60 14,34 32,26 C45,20 50,33 50,40 C50,33 55,20 68,26 C86,34 82,60 50,84 Z" />
  ),
  hourglass: (
    <>
      <path d="M28,18 L72,18 L50,50 Z" />
      <path d="M28,82 L72,82 L50,50 Z" />
      <path d="M26,18 L74,18 M26,82 L74,82" />
    </>
  ),
  orb: (
    <>
      <circle cx="50" cy="50" r="30" />
      <polygon points="50,24 73,38 73,62 50,76 27,62 27,38" />
      <circle cx="50" cy="50" r="11" />
    </>
  ),
};

export default function Avatar({
  type,
  accent,
  size = 64,
  speaking = false,
}: {
  type: AvatarKind;
  accent: string;
  size?: number;
  speaking?: boolean;
}) {
  return (
    <div className={`avatar${speaking ? " speaking" : ""}`} style={{ width: size, height: size }}>
      <span className="avatar-ring" style={{ borderColor: `${accent}55` }} />
      {speaking && <span className="avatar-pulse" style={{ borderColor: `${accent}` }} />}
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        stroke={accent}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 ${speaking ? 10 : 5}px ${accent}aa)` }}
      >
        <g fill={`${accent}1f`}>{SHAPES[type]}</g>
      </svg>
    </div>
  );
}
