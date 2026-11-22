import React from "react";
import { BrandMark, IconDoc, IconOpen } from "./Icons";
import { RecentItem, relativeTime } from "../lib/recents";
import { humanSize } from "../lib/tauri";

type Props = {
  recents: RecentItem[];
  onOpenPicker: () => void;
  onOpenRecent: (item: RecentItem) => void;
  busy: boolean;
};

export default function Welcome({ recents, onOpenPicker, onOpenRecent, busy }: Props) {
  const cards = recents.slice(0, 8);

  return (
    <div className="welcome">
      <aside className="welcome-rail">
        <div className="welcome-brand">
          <BrandMark size={40} />
          <div>
            <h1>Voluma</h1>
            <p>PDF 工作台</p>
          </div>
        </div>

        <div className="welcome-actions">
          <button className="btn btn-primary" onClick={onOpenPicker} disabled={busy}>
            <IconOpen size={18} />
            {busy ? "正在打开…" : "打开 PDF"}
          </button>
        </div>

        <section className="welcome-recent" aria-label="最近文件">
          <h2>最近文件</h2>
          {recents.length === 0 && (
            <div className="welcome-empty">
              还没有打开过文件。
              <br />
              按 Ctrl+O 选一份 PDF 开始。
            </div>
          )}
          {recents.map((r) => (
            <button key={r.path} className="recent-row" onClick={() => onOpenRecent(r)} title={r.path}>
              <span className="mini">
                {r.cover ? <img src={r.cover} alt="" draggable={false} /> : <IconDoc size={16} />}
              </span>
              <span className="meta">
                <span className="nm">{r.name}</span>
                <span className="pg">
                  读到 {r.lastPage}/{r.pages || "?"} 页 · {relativeTime(r.updatedAt)}
                </span>
              </span>
            </button>
          ))}
        </section>

        <div className="welcome-foot">
          <span>本地优先 · 零账号</span>
          <span>v0.1.0</span>
        </div>
      </aside>

      <main className="welcome-main">
        <div className="welcome-hero">
          <h2>
            看 PDF、标重点、<em>交出去</em>——
            <br />
            不用再装 Acrobat。
          </h2>
          <p>
            阅读、注释、页面管理、表单、打印，五件事做到顺手。文件只留在你自己这台电脑上。
          </p>
        </div>

        {cards.length === 0 ? (
          <div className="card-wall-empty">
            最近打开的 PDF 会出现在这里。
            <br />
            封面取自第一页，进度会记到关闭前的那一页。
          </div>
        ) : (
          <div className="card-wall">
            {cards.map((r, i) => (
              <button
                key={r.path}
                className="pdf-card"
                style={{ animationDelay: `${i * 40}ms` }}
                onClick={() => onOpenRecent(r)}
                title={r.path}
              >
                <span className="cover">
                  {r.cover ? (
                    <img src={r.cover} alt="" draggable={false} />
                  ) : (
                    <BrandMark size={44} />
                  )}
                </span>
                <span className="info">
                  <span className="t">{r.name}</span>
                  <span className="s">
                    {r.pages ? `${r.pages} 页` : "页数未知"} · {humanSize(r.size)}
                  </span>
                  <span className="bar">
                    <i
                      style={{
                        width: `${r.pages ? Math.min(100, Math.max(2, (r.lastPage / r.pages) * 100)) : 2}%`,
                      }}
                    />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
