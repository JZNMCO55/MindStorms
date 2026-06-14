// Cyberpunk ambience: deep gradient + neon color glows + a synthwave perspective
// floor grid + faint scanlines. All CSS (see .bg-* rules) — no assets.
export default function Background() {
  return (
    <div className="bg" aria-hidden>
      <div className="bg-glow bg-glow-a" />
      <div className="bg-glow bg-glow-b" />
      <div className="bg-glow bg-glow-c" />
      <div className="bg-floor" />
      <div className="bg-scan" />
    </div>
  );
}
