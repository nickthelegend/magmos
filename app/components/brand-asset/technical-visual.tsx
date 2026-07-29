import { MagmosMark } from "./magmos-mark";

type TechnicalVisualVariant = "rings" | "cube" | "diagram";

export function TechnicalVisual({ variant }: { variant: TechnicalVisualVariant }) {
  return (
    <div className={`brand-tech-visual brand-tech-${variant}`}>
      {variant === "diagram" ? (
        <DiagramVisual />
      ) : (
        <WireframeVisual variant={variant} />
      )}
    </div>
  );
}

function DiagramVisual() {
  return (
    <>
      <span className="brand-diagram-node brand-diagram-user">USER</span>
      <span className="brand-diagram-node brand-diagram-app">APP</span>
      <span className="brand-diagram-node brand-diagram-auth">AUTH PROVIDER</span>
      <span className="brand-diagram-node brand-diagram-salt">SALT SERVICE</span>
      <span className="brand-diagram-node brand-diagram-zk">ZK PROVING SERVICE</span>
      <span className="brand-diagram-node brand-diagram-mark">
        <MagmosMark light />
      </span>
      <span className="brand-diagram-line brand-diagram-line-a" />
      <span className="brand-diagram-line brand-diagram-line-b" />
      <span className="brand-diagram-line brand-diagram-line-c" />
      <small>----- Generating Item &nbsp;&nbsp;&nbsp;&nbsp; Sending Item</small>
    </>
  );
}

function WireframeVisual({ variant }: { variant: "rings" | "cube" }) {
  return (
    <>
      <span className="brand-tech-grid-line brand-tech-grid-one" />
      <span className="brand-tech-grid-line brand-tech-grid-two" />
      <span className="brand-tech-grid-line brand-tech-grid-three" />
      <span className="brand-tech-blue-plane" />
      <span className="brand-tech-wire brand-tech-wire-a" />
      <span className="brand-tech-wire brand-tech-wire-b" />
      <span className="brand-tech-wire brand-tech-wire-c" />
      {variant === "cube" ? (
        <span className="brand-tech-cube" />
      ) : (
        <span className="brand-tech-disc" />
      )}
    </>
  );
}
