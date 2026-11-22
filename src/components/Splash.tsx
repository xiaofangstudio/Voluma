import React from "react";
import { BrandMark } from "./Icons";

export default function Splash({ fading }: { fading: boolean }) {
  return (
    <div className={`splash${fading ? " fade" : ""}`} role="status" aria-label="Voluma 正在启动">
      <div className="splash-inner">
        <BrandMark size={96} className="splash-logo" />
        <div className="splash-word">Voluma</div>
        <div className="splash-sub">PDF 工作台 · 小方工作室</div>
        <div className="splash-progress">
          <i />
        </div>
      </div>
    </div>
  );
}
