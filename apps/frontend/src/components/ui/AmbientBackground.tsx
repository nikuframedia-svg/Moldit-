// ═══════════════════════════════════════════════════════════
//  AmbientBackground — Fixed ambient glow decoration
//
//  2 radial gradients: violet (top-right), cyan (bottom-left)
//  Renders behind all content as first child of layout.
// ═══════════════════════════════════════════════════════════

export function AmbientBackground() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
    >
      {/* Violet glow — top right */}
      <div
        style={{
          position: 'absolute',
          top: '-15%',
          right: '-10%',
          width: '50vw',
          height: '50vh',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(129,140,248,0.06) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
      {/* Cyan glow — bottom left */}
      <div
        style={{
          position: 'absolute',
          bottom: '-10%',
          left: '-10%',
          width: '45vw',
          height: '45vh',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(34,211,238,0.04) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
    </div>
  );
}
