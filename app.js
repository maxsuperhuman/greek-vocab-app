const { useState, useEffect, useMemo, useCallback } = React;

function shuf(a) { return [...a].sort(() => Math.random() - 0.5); }
function norm(s) {
  return s.toLowerCase().trim()
    .replace(/ά/g,"α").replace(/έ/g,"ε").replace(/ή/g,"η")
    .replace(/ί/g,"ι").replace(/ό/g,"ο").replace(/ύ/g,"υ").replace(/ώ/g,"ω");
}

// ─── Mastery system ────────────────────────────────────────────────
// Level 0 = unseen
// Level 1 = flashcard cleared  (Know it clicked, ok>fail)
// Level 2 = quiz Greek→English cleared
// Level 3 = quiz English→Greek cleared
// Level 4 = tile spelling cleared
// Level 5 = full mastered (all 4 modes cleared a 2nd time = streak5 ≥ 1)
// frozen  = level 5 reached 3 times → never decays
// Decay   = level 5 → 4 after 7 days no activity (unless frozen)
// Error   = if mode had been cleared and now accuracy drops below 50% → level recalculated down

function initMastery() {
  const o = {};
  WORDS.forEach(w => {
    o[w[0]] = {
      level:   0,
      streak5: 0,      // times reached level 5
      frozen:  false,
      lastSeen: null,  // timestamp ms
      modes: {
        flash:      { ok:0, fail:0, cleared:false },
        quiz_gr_en: { ok:0, fail:0, cleared:false },
        quiz_en_gr: { ok:0, fail:0, cleared:false },
        tile:       { ok:0, fail:0, cleared:false },
      },
    };
  });
  return o;
}

// A mode is "cleared" when it has been answered and accuracy > 50%
function checkCleared(m) {
  const tot = m.ok + m.fail;
  return tot > 0 && m.ok / tot > 0.5;
}

function computeLevel(e) {
  if (e.frozen) return 5;
  const ms = e.modes;
  const fl = ms.flash.cleared, q1 = ms.quiz_gr_en.cleared,
        q2 = ms.quiz_en_gr.cleared, ti = ms.tile.cleared;
  if (fl && q1 && q2 && ti) return e.streak5 >= 1 ? 5 : 4;
  if (fl && q1 && q2) return 3;
  if (fl && q1) return 2;
  if (fl) return 1;
  return 0;
}

// Record an answer: mode = "flash"|"quiz_gr_en"|"quiz_en_gr"|"tile"
function applyAnswer(mastery, wordKey, mode, ok) {
  const prev = mastery[wordKey];
  if (!prev) return mastery;
  const pm = prev.modes[mode];
  if (!pm) return mastery;
  const newM = { ...pm, ok: pm.ok + (ok?1:0), fail: pm.fail + (ok?0:1) };
  newM.cleared = checkCleared(newM);
  const newModes = { ...prev.modes, [mode]: newM };
  const newEntry = { ...prev, modes: newModes, lastSeen: Date.now() };
  // compute new level
  const oldLevel = prev.level;
  newEntry.level = computeLevel(newEntry);
  // check if just hit level 5 for first/nth time
  if (newEntry.level === 5 && oldLevel < 5) {
    newEntry.streak5 = (newEntry.streak5 || 0) + 1;
    if (newEntry.streak5 >= 3) newEntry.frozen = true;
  }
  return { ...mastery, [wordKey]: newEntry };
}

// Decay: level 5 → 4 if unseen 7+ days (unless frozen)
function applyDecay(mastery) {
  const now = Date.now();
  const out = {};
  Object.keys(mastery).forEach(k => {
    const e = mastery[k];
    if (!e.frozen && e.level === 5 && e.lastSeen && (now - e.lastSeen) > 7*86400000) {
      // decay: reset all modes' cleared flags so they need re-clearing
      const newModes = {};
      Object.keys(e.modes).forEach(m => { newModes[m] = { ...e.modes[m], cleared:false }; });
      out[k] = { ...e, level:4, modes:newModes };
    } else {
      out[k] = e;
    }
  });
  return out;
}

const LEVEL_INFO = [
  { label:"Unseen",     color:"#bbb",    bg:"#f5f5f5", icon:"○" },
  { label:"Flashcard",  color:"#7F77DD", bg:"#EEEDFE", icon:"◐" },
  { label:"Quiz GR→EN", color:"#BA7517", bg:"#FFF3CD", icon:"◑" },
  { label:"Quiz EN→GR", color:"#E87F2A", bg:"#FFE8CC", icon:"◕" },
  { label:"Spelling",   color:"#1D9E75", bg:"#E1F5EE", icon:"●" },
  { label:"Mastered ★", color:"#0F6E56", bg:"#C6F0E2", icon:"★" },
];
const lv = l => LEVEL_INFO[Math.min(l,5)];

// ─── UI atoms ──────────────────────────────────────────────────────
const Chip = ({ label, on, onClick }) => (
  <button onClick={onClick} style={{ padding:"3px 10px", borderRadius:20, fontSize:12, cursor:"pointer", fontFamily:"inherit", border: on?"0.5px solid #7F77DD":"0.5px solid #ccc", background:on?"#EEEDFE":"transparent", color:on?"#3C3489":"#888" }}>{label}</button>
);
const Pill = ({ children }) => (
  <span style={{ background:"#EEEDFE", color:"#3C3489", padding:"3px 10px", borderRadius:12, fontSize:12, fontWeight:500 }}>{children}</span>
);
const Btn = ({ onClick, children, style }) => (
  <button onClick={onClick} style={{ padding:"9px 22px", border:"0.5px solid #ccc", borderRadius:8, background:"transparent", fontSize:13, cursor:"pointer", fontFamily:"inherit", ...style }}>{children}</button>
);
const MCard = ({ title, on, onClick }) => (
  <button onClick={onClick} style={{ padding:"10px 12px", border:on?"1.5px solid #7F77DD":"0.5px solid #ccc", borderRadius:10, cursor:"pointer", background:on?"#EEEDFE":"transparent", textAlign:"left", fontFamily:"inherit", width:"100%" }}>
    <span style={{ fontSize:13, fontWeight:500, color:on?"#3C3489":"#333" }}>{title}</span>
  </button>
);
const Bar = ({ pct, h=4, color="#7F77DD" }) => (
  <div style={{ height:h, background:"#eee", borderRadius:h/2, overflow:"hidden" }}>
    <div style={{ height:h, width:`${pct}%`, background:color, borderRadius:h/2, transition:"width .3s" }} />
  </div>
);
const ResBox = ({ score, total, onRetry, onFlip, flipLabel }) => {
  const pct = Math.round(score/total*100);
  const msg = pct<50?"Keep practising!":pct<70?"Not bad!":pct<85?"Good result!":pct<100?"Excellent!":"Perfect! 🎉";
  return (
    <div style={{ background:"#f8f8f8", borderRadius:12, padding:"2rem", textAlign:"center" }}>
      <div style={{ fontSize:15, fontWeight:500 }}>Result</div>
      <div style={{ fontSize:44, fontWeight:500, color:"#534AB7", margin:".6rem 0" }}>{score}/{total}</div>
      <div style={{ fontSize:13, color:"#888", marginBottom:"1.2rem" }}>{msg}</div>
      <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
        <Btn onClick={onRetry}>↺ Try again</Btn>
        {onFlip && (
          <Btn onClick={onFlip} style={{ borderColor:"#7F77DD", color:"#3C3489", background:"#EEEDFE" }}>
            ⇄ {flipLabel || "Flip"}
          </Btn>
        )}
      </div>
    </div>
  );
};

// ─── Word detail modal (AI) ────────────────────────────────────────
function WordModal({ word, onClose }) {
  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const key = word ? word[0] : null;

  useEffect(() => {
    if (!key) return;
    setText(null); setError(null); setLoading(true);
    const prompt = `You are a Greek language teacher. Write a concise reference card for: "${word[0]}" (transcription: ${word[1]}, English: ${word[2]}).

Use exactly these four section headers with ## prefix:

## Part of speech
One line: noun / verb / adjective / adverb / phrase / expression.

## Forms
Verb: conjugate present tense — εγώ / εσύ / αυτός / εμείς / εσείς / αυτοί with transcription on same line.
Noun: article + singular + plural, note gender.
Adjective: masculine / feminine / neuter.
Phrase: write — Fixed expression, no inflection.

## Examples
Exactly 3 sentences:
🇬🇷 [Greek]
📢 [transcription]
🇬🇧 [English]

## Notes
1-2 sentences on register, context, or common mistake.`;

    // Check online status before calling API
    if (!navigator.onLine) {
      setError("offline");
      setLoading(false);
      return;
    }

    // Try a quick preflight to see if API is reachable from this context
    // (Mobile app iframe blocks cross-origin requests)
    fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:900, messages:[{role:"user",content:prompt}] }),
    })
      .then(r => {
        if (!r.ok && r.status !== 401) throw new Error("blocked");
        return r.json();
      })
      .then(d => {
        // 401 = API key missing (expected in artifact) but request went through
        // error.type = "authentication_error" means we're in browser context — show message
        if (d.error) {
          if (d.error.type === "authentication_error") {
            setError("browser_only");
          } else {
            throw new Error("api_error");
          }
          return;
        }
        const t = (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
        if (!t) throw new Error("empty");
        setText(t);
      })
      .catch(e => {
        if (e.message === "blocked" || e.message === "Failed to fetch") {
          setError("app_blocked");
        } else {
          setError("network");
        }
      })
      .finally(() => setLoading(false));
  }, [key]);

  if (!word) return null;

  function renderSections(raw) {
    return raw.split(/^(?=## )/m).filter(c=>c.trim()).map(chunk => {
      const lines = chunk.split("\n");
      const title = lines[0].replace(/^## /,"").trim();
      const body  = lines.slice(1).join("\n").trim();
      if (title === "Examples") {
        const exs = []; let cur = {};
        body.split("\n").forEach(l => {
          const t = l.trim();
          if (t.startsWith("🇬🇷"))      { cur = { gr: t.slice(2).trim() }; }
          else if (t.startsWith("📢") && cur.gr) { cur.tr = t.slice(1).trim(); }
          else if (t.startsWith("🇬🇧") && cur.gr) { cur.en = t.slice(2).trim(); exs.push({...cur}); cur={}; }
        });
        return (
          <div key={title} style={{ marginBottom:"1rem" }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"#534AB7", marginBottom:7 }}>{title}</div>
            {exs.map((ex,i) => (
              <div key={i} style={{ background:"#f7f7ff", borderRadius:8, padding:"10px 12px", marginBottom:6, borderLeft:"3px solid #AFA9EC" }}>
                <div style={{ fontSize:14, fontWeight:500, marginBottom:2 }}>{ex.gr}</div>
                <div style={{ fontSize:12, color:"#888", fontStyle:"italic", marginBottom:2 }}>{ex.tr}</div>
                <div style={{ fontSize:12, color:"#444" }}>{ex.en}</div>
              </div>
            ))}
          </div>
        );
      }
      const bLines = body.split("\n").map(l=>l.replace(/^[-–•]\s*/,"").trim()).filter(Boolean);
      return (
        <div key={title} style={{ marginBottom:"1rem" }}>
          <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"#534AB7", marginBottom:7 }}>{title}</div>
          <div style={{ background:"#f8f8f8", borderRadius:8, padding:"10px 12px" }}>
            {bLines.map((l,i) => (
              <div key={i} style={{ fontSize:13, color:"#333", lineHeight:1.6, padding:"2px 0", borderBottom:i<bLines.length-1?"0.5px solid #eee":"none" }}>{l}</div>
            ))}
          </div>
        </div>
      );
    });
  }

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"16px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"white", borderRadius:16, width:"100%", maxWidth:500, boxShadow:"0 8px 40px rgba(0,0,0,0.2)", marginTop:4 }}>
        <div style={{ background:"#EEEDFE", borderRadius:"16px 16px 0 0", padding:"16px 18px", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
          <div>
            <div style={{ fontSize:22, fontWeight:700, color:"#26215C", marginBottom:2 }}>{word[0]}</div>
            <div style={{ fontSize:13, color:"#7F77DD", fontStyle:"italic" }}>{word[1]}</div>
            <div style={{ fontSize:13, color:"#534AB7", marginTop:2 }}>{word[2]}</div>
          </div>
          <div style={{ display:"flex", gap:6, flexShrink:0 }}>
            <button onClick={async () => {
              setCard(null); setLoading(true); setError(null);
              // Clear cache for this word
              try {
                const db = await openDB();
                const tx = db.transaction(DB_STORE, "readwrite");
                tx.objectStore(DB_STORE).delete(CARD_CACHE_PREFIX + word[0]);
              } catch {}
              fetchWordCard(word[0], word[1], word[2], word[3])
                .then(r => { if(r) setCard(r); else setError("Could not load."); })
                .finally(() => setLoading(false));
            }} style={{ background:"white", border:"0.5px solid #AFA9EC", borderRadius:8, padding:"4px 10px", fontSize:14, cursor:"pointer", color:"#534AB7", fontFamily:"inherit" }} title="Refresh">🔄</button>
            <button onClick={onClose} style={{ background:"white", border:"0.5px solid #AFA9EC", borderRadius:8, padding:"4px 10px", fontSize:16, cursor:"pointer", color:"#534AB7", fontFamily:"inherit" }}>✕</button>
          </div>
        </div>
        <div style={{ padding:"18px" }}>
          {loading && <div style={{ textAlign:"center", padding:"2rem", color:"#888", fontSize:13 }}>Generating reference card…</div>}
          {error === "offline" && (
            <div style={{ textAlign:"center", padding:"1.5rem" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📵</div>
              <div style={{ fontSize:14, fontWeight:500, color:"#333", marginBottom:4 }}>You're offline</div>
              <div style={{ fontSize:13, color:"#888" }}>Reference cards require internet. All exercises work offline!</div>
            </div>
          )}
          {error === "app_blocked" && (
            <div style={{ textAlign:"center", padding:"1.5rem" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📱</div>
              <div style={{ fontSize:14, fontWeight:500, color:"#333", marginBottom:6 }}>Not available in the app</div>
              <div style={{ fontSize:13, color:"#888", lineHeight:1.5 }}>
                AI reference cards only work in the browser version of Claude.<br/>
                Open <strong>claude.ai</strong> in Safari or Chrome to use this feature.
              </div>
              <div style={{ marginTop:12, fontSize:12, color:"#aaa" }}>All exercises (flashcards, quiz, spelling) work fine in the app ✓</div>
            </div>
          )}
          {error === "browser_only" && (
            <div style={{ textAlign:"center", padding:"1.5rem" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🔑</div>
              <div style={{ fontSize:14, fontWeight:500, color:"#333", marginBottom:4 }}>API key required</div>
              <div style={{ fontSize:13, color:"#888" }}>Open this artifact on claude.ai to use AI reference cards.</div>
            </div>
          )}
          {error === "network" && (
            <div style={{ textAlign:"center", padding:"1.5rem" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>⚠️</div>
              <div style={{ fontSize:13, color:"#E24B4A" }}>Could not load — please try again.</div>
            </div>
          )}
          {text    && renderSections(text)}
        </div>
      </div>
    </div>
  );
}

// ─── Dictionary ────────────────────────────────────────────────────
function DictTab({ mastery }) {
  const [q, setQ]           = useState("");
  const [topic, setTopic]   = useState("All");
  const [selected, setSel]  = useState(null);
  function wStats(w) {
    const e = mastery[w[0]];
    if (!e) return { ok:0, fail:0, level:0 };
    const ok   = Object.values(e.modes).reduce((a,m)=>a+m.ok,0);
    const fail = Object.values(e.modes).reduce((a,m)=>a+m.fail,0);
    return { ok, fail, level:e.level, frozen:e.frozen };
  }

  const rows = useMemo(() =>
    WORDS.filter(w => (topic==="All"||w[3]===topic) && (!q||(w[0]+w[1]+w[2]).toLowerCase().includes(q.toLowerCase()))),
    [q, topic]
  );

  // Per-topic stats for the progress bar
  const topicStats = useMemo(() => {
    const wordsInTopic = topic==="All" ? WORDS : WORDS.filter(w=>w[3]===topic);
    const total = wordsInTopic.length;
    const mastered = wordsInTopic.filter(w=>{
      const e = mastery[w[0]]; return e && (e.level>=5||e.frozen);
    }).length;
    const learning = wordsInTopic.filter(w=>{
      const e = mastery[w[0]]; return e && e.level>0 && e.level<5 && !e.frozen;
    }).length;
    const pct = total ? Math.round(mastered/total*100) : 0;
    return { total, mastered, learning, pct };
  }, [topic, mastery]);

  return (
    <div style={{ position:"relative" }}>
      <CardDetail word={selected} onClose={()=>setSel(null)} />
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search…" style={{ width:"100%", padding:"7px 11px", border:"0.5px solid #ccc", borderRadius:8, fontSize:13, marginBottom:".8rem", background:"transparent", fontFamily:"inherit" }} />

      {/* Topic chips with word counts */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:"1rem" }}>
        <span style={{ fontSize:12, color:"#888", fontWeight:500 }}>Topic:</span>
        {TOPICS.map(t => {
          const cnt = t==="All" ? WORDS.length : WORDS.filter(w=>w[3]===t).length;
          const mst = t==="All"
            ? WORDS.filter(w=>{ const e=mastery[w[0]]; return e&&(e.level>=5||e.frozen); }).length
            : WORDS.filter(w=>w[3]===t&&(()=>{ const e=mastery[w[0]]; return e&&(e.level>=5||e.frozen); })()).length;
          return (
            <button key={t} onClick={()=>setTopic(t)} style={{
              padding:"4px 10px", borderRadius:20, fontSize:12, cursor:"pointer", fontFamily:"inherit",
              border: topic===t ? "0.5px solid #7F77DD" : "0.5px solid #ccc",
              background: topic===t ? "#EEEDFE" : "transparent",
              color: topic===t ? "#3C3489" : "#888",
              display:"flex", alignItems:"center", gap:5,
            }}>
              <span>{t}</span>
              <span style={{ fontSize:10, opacity:0.7 }}>{mst}/{cnt}</span>
            </button>
          );
        })}
      </div>

      {/* Topic progress bar */}
      <div style={{ background:"#f8f8f8", borderRadius:10, padding:"10px 14px", marginBottom:"1rem", border:"0.5px solid #eee" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
          <span style={{ fontSize:12, fontWeight:500, color:"#333" }}>
            {topic==="All" ? "All topics" : topic}
          </span>
          <div style={{ display:"flex", gap:12, fontSize:11, color:"#888" }}>
            <span>📚 {topicStats.total} words</span>
            <span style={{ color:"#BA7517" }}>◑ {topicStats.learning} learning</span>
            <span style={{ color:"#1D9E75" }}>★ {topicStats.mastered} mastered</span>
          </div>
        </div>
        <div style={{ height:8, background:"#e5e5e5", borderRadius:4, overflow:"hidden" }}>
          <div style={{
            height:8,
            width:`${topicStats.pct}%`,
            background: topicStats.pct>=80?"#1D9E75":topicStats.pct>=40?"#BA7517":"#7F77DD",
            borderRadius:4, transition:"width .4s",
          }}/>
        </div>
        <div style={{ fontSize:10, color:"#aaa", marginTop:4, textAlign:"right" }}>{topicStats.pct}% mastered</div>
      </div>

      <div style={{ fontSize:11, color:"#bbb", marginBottom:".6rem" }}>Tap any row for a detailed AI reference card</div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead>
            <tr>
              {["Greek","Transcription","English","Progress"].map((h,i) => (
                <th key={h} style={{ padding:"6px 8px", fontSize:11, fontWeight:500, color:"#888", borderBottom:"0.5px solid #e5e5e5", textAlign:"left", textTransform:"uppercase", letterSpacing:".04em", width:i===3?90:"auto" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((w,i) => {
              const s   = wStats(w);
              const tot = s.ok + s.fail;
              const pct = tot ? Math.round(s.ok/tot*100) : 0;
              const lvl = s.level||0;
              const col = lv(lvl).color;
              const ok  = lvl >= 5 || s.frozen;
              return (
                <tr key={i} onClick={()=>setSel(w)} style={{ cursor:"pointer" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#f5f4ff"}
                  onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <td style={{ padding:"8px", borderBottom:"0.5px solid #f0f0f0", fontSize:14 }}>
                    {ok && <span style={{ color:"#1D9E75", marginRight:4, fontSize:11 }}>✓</span>}{w[0]}
                  </td>
                  <td style={{ padding:"8px", borderBottom:"0.5px solid #f0f0f0", color:"#888", fontStyle:"italic", fontSize:12 }}>{w[1]}</td>
                  <td style={{ padding:"8px", borderBottom:"0.5px solid #f0f0f0" }}>{w[2]}</td>
                  <td style={{ padding:"8px", borderBottom:"0.5px solid #f0f0f0" }}>
                    {tot > 0 ? (
                      <div>
                        <Bar pct={pct} color={col} />
                        <div style={{ fontSize:10, color:"#aaa", textAlign:"right", marginTop:2 }}>{s.ok}/{tot} · {pct}% · lv{lvl}</div>
                      </div>
                    ) : <span style={{ fontSize:10, color:"#ccc" }}>—</span>}
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={4} style={{ padding:"2rem", textAlign:"center", color:"#888" }}>Not found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Flashcards ────────────────────────────────────────────────────

// ─── AI-powered word card panel ────────────────────────────────────
function CardDetail({ word, onClose }) {
  if (!word) return null;
  const [card, setCard] = React.useState(CARDS[word[0]] || null);
  const [loading, setLoading] = React.useState(!CARDS[word[0]]);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (card) return; // already have card (from CARDS or cache)
    setLoading(true);
    setError(null);
    fetchWordCard(word[0], word[1], word[2], word[3])
      .then(result => {
        if (result) setCard(result);
        else setError("Could not load. Check connection.");
      })
      .catch(() => setError("Could not load."))
      .finally(() => setLoading(false));
  }, [word[0]]);

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"white", borderRadius:"16px 16px 0 0", width:"100%", maxWidth:540, maxHeight:"75vh", overflowY:"auto", boxShadow:"0 -4px 30px rgba(0,0,0,0.2)" }}>
        {/* header */}
        <div style={{ background:"#EEEDFE", borderRadius:"16px 16px 0 0", padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"flex-start", position:"sticky", top:0 }}>
          <div>
            <div style={{ fontSize:22, fontWeight:700, color:"#26215C" }}>{word[0]}</div>
            <div style={{ fontSize:13, color:"#7F77DD", fontStyle:"italic" }}>{word[1]}</div>
            <div style={{ fontSize:13, color:"#534AB7" }}>{word[2]}</div>
          </div>
          <div style={{ display:"flex", gap:6, flexShrink:0 }}>
            <button onClick={async () => {
              setCard(null); setLoading(true); setError(null);
              // Clear cache for this word
              try {
                const db = await openDB();
                const tx = db.transaction(DB_STORE, "readwrite");
                tx.objectStore(DB_STORE).delete(CARD_CACHE_PREFIX + word[0]);
              } catch {}
              fetchWordCard(word[0], word[1], word[2], word[3])
                .then(r => { if(r) setCard(r); else setError("Could not load."); })
                .finally(() => setLoading(false));
            }} style={{ background:"white", border:"0.5px solid #AFA9EC", borderRadius:8, padding:"4px 10px", fontSize:14, cursor:"pointer", color:"#534AB7", fontFamily:"inherit" }} title="Refresh">🔄</button>
            <button onClick={onClose} style={{ background:"white", border:"0.5px solid #AFA9EC", borderRadius:8, padding:"4px 10px", fontSize:16, cursor:"pointer", color:"#534AB7", fontFamily:"inherit" }}>✕</button>
          </div>
        </div>
        <div style={{ padding:"16px 18px" }}>
          {loading && (
            <div style={{ textAlign:"center", padding:"2rem", color:"#888" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>⏳</div>
              <div style={{ fontSize:13 }}>Loading card from Claude AI…</div>
            </div>
          )}
          {error && !loading && (
            <div style={{ textAlign:"center", padding:"2rem", color:"#E24B4A" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>⚠️</div>
              <div style={{ fontSize:13 }}>{error}</div>
            </div>
          )}
          {!card && !loading ? (
            <div style={{ textAlign:"center", padding:"2rem", color:"#888" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>📖</div>
              <div style={{ fontSize:13 }}>No reference card yet for this word.</div>
            </div>
          ) : (
            <>
              {/* Part of speech */}
              <div style={{ marginBottom:"1rem" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"#534AB7", marginBottom:5 }}>Part of speech</div>
                <div style={{ fontSize:13, color:"#333", background:"#f8f8f8", borderRadius:8, padding:"8px 12px" }}>{(card.p || card.pos)}</div>
              </div>

              {/* Examples */}
              <div style={{ marginBottom:"1rem" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"#534AB7", marginBottom:5 }}>Examples</div>
                {(card.ex || card.examples || []).map((ex,i) => (
                  <div key={i} style={{ background:"#f7f7ff", borderRadius:8, padding:"10px 12px", marginBottom:6, borderLeft:"3px solid #AFA9EC" }}>
                    <div style={{ fontSize:14, fontWeight:500, marginBottom:2 }}>{ex.gr}</div>
                    <div style={{ fontSize:12, color:"#888", fontStyle:"italic", marginBottom:2 }}>{ex.tr}</div>
                    <div style={{ fontSize:12, color:"#444" }}>{ex.en}</div>
                  </div>
                ))}
              </div>
              {/* Notes */}
              <div style={{ marginBottom:"1rem" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"#534AB7", marginBottom:5 }}>Notes</div>
                <div style={{ fontSize:13, color:"#555", background:"#FFF3CD", borderRadius:8, padding:"8px 12px", borderLeft:"3px solid #BA7517" }}>{card.n || card.notes}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FlashTab({ mastery, rec }) {
  const [face, setFace]         = useState(0);
  const [topic, setTopic]       = useState("All");
  const [hardOnly, setHardOnly] = useState(false);
  const [deck, setDeck]         = useState(() => shuf(WORDS));
  const [idx, setIdx]           = useState(0);
  const [flipped, setFlipped]   = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showDetail, setShowDetail] = useState(false);

  // Speak Greek text using Web Speech API
  function speak(text, times = 1) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setSpeaking(true);
    let count = 0;
    function sayOnce() {
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = "el-GR";
      utt.rate = 0.85;
      utt.pitch = 1;
      utt.onend = () => {
        count++;
        if (count < times) {
          setTimeout(sayOnce, 1200);
        } else {
          setSpeaking(false);
        }
      };
      utt.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utt);
    }
    sayOnce();
  }

  function build(f, t, hard) {
    let p = WORDS.filter(w => t==="All" || w[3]===t);
    if (hard) { const h=p.filter(w=>{ const e=mastery[w[0]]; if(!e) return false; const mf=Object.values(e.modes).reduce((a,m)=>a+m.fail,0); const mo=Object.values(e.modes).reduce((a,m)=>a+m.ok,0); return mf>mo; }); if(h.length)p=h; }
    setDeck(shuf(p)); setIdx(0); setFlipped(false);
    window.speechSynthesis && window.speechSynthesis.cancel();
  }

  const w = deck[idx] || WORDS[0];
  const views = [
    { front:w[0], fsub:w[1], back:w[2], bsub:w[1], fl:"Greek", bl:"English", greekOnBack: false },
    { front:w[2], fsub:"",   back:w[0], bsub:w[1], fl:"English", bl:"Greek", greekOnBack: true },
    { front:w[1], fsub:"",   back:w[0], bsub:w[2], fl:"Transcription", bl:"Greek", greekOnBack: true },
  ];
  const v = views[face];

  function flipCard() {
    const newFlipped = !flipped;
    setFlipped(newFlipped);
    // When flipping to back — speak the Greek word 2 times if autoSpeak is on
    if (newFlipped && autoSpeak) {
      // Always speak the Greek word (w[0])
      setTimeout(() => speak(w[0], 2), 300); // wait for flip animation
    }
  }

  function rate(ok) {
    window.speechSynthesis && window.speechSynthesis.cancel();
    rec(w[0], 'flash', ok);
    if (ok) { setIdx((idx+1)%deck.length); }
    else { const nd=[...deck]; nd.splice(idx,1); nd.splice(Math.min(idx+2,nd.length),0,w); setDeck(nd); setIdx(idx>=nd.length?0:idx); }
    setFlipped(false);
  }

  return (
    <div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:".5rem" }}>
        <span style={{ fontSize:12, color:"#888", fontWeight:500 }}>Topic:</span>
        {TOPICS.map(t=><Chip key={t} label={t} on={topic===t} onClick={()=>{setTopic(t);build(face,t,hardOnly);}}/>)}
      </div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:".8rem" }}>
        <span style={{ fontSize:12, color:"#888", fontWeight:500 }}>Front:</span>
        {["Greek","English","Transcription"].map((l,i)=><Chip key={l} label={l} on={face===i} onClick={()=>{setFace(i);build(i,topic,hardOnly);}}/>)}
        <span style={{ fontSize:12, color:"#888", fontWeight:500, marginLeft:6 }}>Mode:</span>
        <Chip label="All" on={!hardOnly} onClick={()=>{setHardOnly(false);build(face,topic,false);}}/>
        <Chip label="Hard only" on={hardOnly} onClick={()=>{setHardOnly(true);build(face,topic,true);}}/>
      </div>

      {/* top row: restart / counter / audio toggle */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".6rem" }}>
        <button onClick={()=>build(face,topic,hardOnly)} style={{ fontSize:13, color:"#888", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", padding:0 }}>↺ Restart</button>
        <span style={{ fontSize:13, color:"#888" }}>{idx+1} / {deck.length}</span>
        <button onClick={()=>setAutoSpeak(a=>!a)} style={{
          fontSize:12, padding:"3px 10px", borderRadius:20, cursor:"pointer", fontFamily:"inherit",
          border: autoSpeak?"0.5px solid #7F77DD":"0.5px solid #ccc",
          background: autoSpeak?"#EEEDFE":"transparent",
          color: autoSpeak?"#3C3489":"#888",
        }}>
          {speaking ? "🔊 …" : autoSpeak ? "🔊 Auto" : "🔇 Mute"}
        </button>
      </div>

      {/* card */}
      <div onClick={flipCard} style={{ perspective:800, width:"100%", maxWidth:420, height:170, margin:"0 auto 1.2rem", cursor:"pointer" }}>
        <div style={{ width:"100%", height:"100%", position:"relative", transformStyle:"preserve-3d", transition:"transform .4s", transform:flipped?"rotateY(180deg)":"none" }}>
          {[false,true].map(back => (
            <div key={String(back)} style={{ position:"absolute", width:"100%", height:"100%", backfaceVisibility:"hidden", transform:back?"rotateY(180deg)":"none", border:"0.5px solid #e0e0e0", borderRadius:12, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"1.4rem", background:back?"#f8f8f8":"white" }}>
              <div style={{ fontSize:11, color:"#aaa", textTransform:"uppercase", letterSpacing:".06em", marginBottom:7 }}>{back?v.bl:v.fl}</div>
              <div style={{ fontSize:22, fontWeight:500, textAlign:"center", lineHeight:1.3 }}>{back?v.back:v.front}</div>
              <div style={{ fontSize:12, color:"#aaa", marginTop:6, fontStyle:"italic" }}>{back?v.bsub:v.fsub}</div>
              {!back && <div style={{ fontSize:11, color:"#ccc", marginTop:8 }}>Tap to flip</div>}
              {back && CARDS[w[0]] && (
                <button
                  onClick={e=>{ e.stopPropagation(); setShowDetail(true); }}
                  style={{ marginTop:10, padding:"5px 14px", borderRadius:20, border:"0.5px solid #7F77DD", background:"#EEEDFE", color:"#3C3489", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                  📖 More
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* card detail bottom sheet */}
      {showDetail && <CardDetail word={w} onClose={()=>setShowDetail(false)}/>}

      {/* speak button + nav */}
      <div style={{ display:"flex", gap:8, justifyContent:"center", alignItems:"center", marginBottom:"1rem", flexWrap:"wrap" }}>
        <button onClick={()=>rate(0)} style={{ padding:"8px 16px", border:"0.5px solid #E24B4A", borderRadius:8, background:"#FCEBEB", color:"#501313", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✕ Don't know</button>
        <button onClick={()=>speak(w[0], 2)} disabled={speaking} style={{
          padding:"8px 14px", borderRadius:8, border:"0.5px solid #7F77DD",
          background: speaking?"#EEEDFE":"white", color:"#534AB7",
          fontSize:16, cursor:speaking?"default":"pointer", fontFamily:"inherit",
        }} title="Pronounce">
          {speaking ? "🔊" : "🔈"}
        </button>
        <button onClick={()=>rate(1)} style={{ padding:"8px 16px", border:"0.5px solid #1D9E75", borderRadius:8, background:"#E1F5EE", color:"#085041", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>✓ Know it</button>
      </div>
      <div style={{ textAlign:"center" }}><Btn onClick={()=>build(face,topic,hardOnly)}>↺ Shuffle</Btn></div>
    </div>
  );
}

// ─── Quiz ──────────────────────────────────────────────────────────
function QuizTab({ mastery, rec }) {
  const [mi, setMi]       = useState(0);
  const [cnt, setCnt]     = useState("20");
  const [topic, setTopic] = useState("All");
  const [phase, setPhase] = useState("setup");
  const [qs, setQs]       = useState([]);
  const [qi, setQi]       = useState(0);
  const [score, setScore] = useState(0);
  const [locked, setLocked] = useState(false);
  const [chosen, setChosen] = useState(null);
  const [opts, setOpts]   = useState([]);
  const [showHint, setShowHint] = useState(false);

  // TTS helper — speak Greek word once
  function speakGreek(text) {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "el-GR";
    utt.rate = 0.85;
    window.speechSynthesis.speak(utt);
  }

  function makeOpts(pool, i, m) {
    const w=pool[i], c=QM[m].a(w);
    const modeIdx = QM.indexOf(m) !== -1 ? QM.indexOf(m) : m;

    // Smart distractors: prefer same topic, then same "shape"
    // For Greek→English or EN→Greek: pick words from same topic first
    const sameTopic  = WORDS.filter(x => x[3]===w[3] && QM[m].a(x)!==c);
    const otherWords = WORDS.filter(x => x[3]!==w[3] && QM[m].a(x)!==c);

    // Also filter by similar word type using CARDS part-of-speech
    // e.g. if correct is a verb, prefer verb distractors
    const correctCard = CARDS[w[0]];
    const correctPos  = correctCard ? correctCard.p.toLowerCase() : "";
    const isVerb      = correctPos.includes("verb");
    const isNoun      = correctPos.includes("noun");
    const isAdj       = correctPos.includes("adj");

    const samePos = (candidate) => {
      const card = CARDS[candidate[0]];
      if (!card) return false;
      const p = card.p.toLowerCase();
      if (isVerb) return p.includes("verb");
      if (isNoun) return p.includes("noun");
      if (isAdj)  return p.includes("adj");
      return true;
    };

    // Priority: same topic + same pos → same topic → same pos → anything
    const tier1 = shuf(sameTopic.filter(samePos));
    const tier2 = shuf(sameTopic.filter(x=>!samePos(x)));
    const tier3 = shuf(otherWords.filter(samePos));
    const tier4 = shuf(otherWords);

    const candidates = [...tier1, ...tier2, ...tier3, ...tier4];
    // Deduplicate by answer value
    const seen = new Set([c]);
    const dis = [];
    for (const x of candidates) {
      const a = QM[m].a(x);
      if (!seen.has(a)) { seen.add(a); dis.push(a); }
      if (dis.length === 3) break;
    }
    // Pad if not enough
    while (dis.length < 3) {
      const fallback = WORDS.find(x => !seen.has(QM[m].a(x)));
      if (!fallback) break;
      seen.add(QM[m].a(fallback));
      dis.push(QM[m].a(fallback));
    }
    setOpts(shuf([c, ...dis]));
  }
  function start() {
    const pool0 = topic==="All"?WORDS:WORDS.filter(w=>w[3]===topic);
    const n = cnt==="all"?pool0.length:+cnt;
    const pool = shuf(pool0).slice(0,Math.min(n,pool0.length));
    setQs(pool); setQi(0); setScore(0); setLocked(false); setChosen(null); setShowHint(false);
    makeOpts(pool,0,mi); setPhase("game");
  }
  function pick(o) {
    if (locked) return;
    const correct=QM[mi].a(qs[qi]), ok=o===correct;
    setLocked(true); setChosen(o);
    if(ok) setScore(s=>s+1);
    const modeKey = mi===0?"quiz_gr_en":mi===1?"quiz_en_gr":mi===2?"quiz_gr_en":"quiz_gr_en";
    rec(qs[qi][0], modeKey, ok);
    // Speak Greek word when answer is shown (feedback moment)
    speakGreek(qs[qi][0]);
    setTimeout(()=>{
      const next=qi+1;
      if(next>=qs.length){setPhase("result");return;}
      setQi(next); setLocked(false); setChosen(null); setShowHint(false);
      makeOpts(qs,next,mi);
    }, ok?500:1000);
  }

  if (phase==="setup") return (
    <div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:"1rem" }}>
        <span style={{ fontSize:12, color:"#888", fontWeight:500 }}>Topic:</span>
        {TOPICS.map(t=><Chip key={t} label={t} on={topic===t} onClick={()=>setTopic(t)}/>)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:"1rem" }}>
        {QM.map((m,i)=><MCard key={i} title={m.label} on={mi===i} onClick={()=>setMi(i)}/>)}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"center", marginBottom:"1rem" }}>
        <span style={{ fontSize:13, color:"#888" }}>Questions:</span>
        <select value={cnt} onChange={e=>setCnt(e.target.value)} style={{ padding:"4px 8px", border:"0.5px solid #ccc", borderRadius:8, background:"transparent", fontSize:13, fontFamily:"inherit" }}>
          {["10","20","30","all"].map(v=><option key={v}>{v}</option>)}
        </select>
      </div>
      <div style={{ textAlign:"center" }}><Btn onClick={start}>Start →</Btn></div>
    </div>
  );
  // Determine flip mode: swap direction of current mode
  const flipMi = mi===0?1 : mi===1?0 : mi===2?3 : mi===3?2 : 0;
  const flipLabel = QM[flipMi].label;

  function doRetry(newMi) {
    const reshuffled = shuf([...qs]);
    setMi(newMi);
    setQs(reshuffled); setQi(0); setScore(0); setLocked(false); setChosen(null); setShowHint(false);
    makeOpts(reshuffled, 0, newMi);
    setPhase("game");
  }

  if (phase==="result") return <ResBox
    score={score} total={qs.length}
    onRetry={()=>doRetry(mi)}
    onFlip={()=>doRetry(flipMi)}
    flipLabel={flipLabel}
  />;

  const w=qs[qi], m=QM[mi], correct=m.a(w);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
        <button onClick={()=>setPhase("setup")} style={{ fontSize:13, color:"#888", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", padding:0 }}>← Back</button>
        <span style={{ fontSize:13, color:"#888" }}>{qi+1}/{qs.length}</span>
        <Pill>{score} correct</Pill>
      </div>
      <Bar pct={Math.round((qi+1)/qs.length*100)} h={4}/>
      <div style={{ marginBottom:"1.4rem" }}/>
      <div style={{ textAlign:"center" }}>
        <div
          onClick={() => { if (mi === 0 || mi === 2 || mi === 3) { const next = !showHint; setShowHint(next); if(next) speakGreek(w[0]); } }}
          style={{ fontSize:28, fontWeight:600, marginBottom:6, cursor: (mi===0||mi===2||mi===3) ? "pointer" : "default", display:"inline-block", padding:"6px 12px", borderRadius:8, transition:"background .15s" }}
          title={mi===0||mi===2||mi===3 ? "Tap to see transcription" : ""}
        >{m.q(w)}</div>
        <div style={{ height:22, marginBottom:6, display:"flex", alignItems:"center", justifyContent:"center" }}>
          {showHint && (mi===0||mi===2||mi===3)
            ? <span style={{ fontSize:13, color:"#7F77DD", fontStyle:"italic", animation:"fadeIn .2s" }}>{w[1]}</span>
            : (mi===0||mi===2||mi===3)
              ? <span style={{ fontSize:11, color:"#ccc" }}>tap word for transcription</span>
              : null
          }
        </div>
        <div style={{ fontSize:15, color:"#888", marginBottom:"1.6rem" }}>{m.h}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {opts.map(o => {
            const isC=o===correct, isP=o===chosen;
            let bg="transparent", border="0.5px solid #ccc", color="#333";
            if(locked){if(isC){bg="#E1F5EE";border="0.5px solid #1D9E75";color="#085041";}else if(isP){bg="#FCEBEB";border="0.5px solid #E24B4A";color="#501313";}}
            return <button key={o} disabled={locked} onClick={()=>pick(o)} style={{ padding:"16px 12px", border, borderRadius:10, background:bg, color, fontSize:16, cursor:locked?"default":"pointer", textAlign:"center", lineHeight:1.3, fontFamily:"inherit", transition:"background .15s" }}>{o}</button>;
          })}
        </div>
      </div>
    </div>
  );
}

// ─── helpers for tile puzzle ───────────────────────────────────────
function makeTiles(answer) {
  // Split answer into chars (letters only, spaces kept as space tiles)
  const chars = answer.split("").filter(c => c !== " ");
  // Add ~40% extra random letters from the same alphabet (greek or latin)
  const greekPool = "αβγδεζηθικλμνξοπρστυφχψω";
  const latinPool  = "abcdefghijklmnoprstuvwxyz";
  const isGreek    = /[\u0370-\u03ff]/.test(answer);
  const pool       = isGreek ? greekPool : latinPool;
  const extraCount = Math.max(2, Math.floor(chars.length * 0.5));
  const extras     = Array.from({length: extraCount}, () => pool[Math.floor(Math.random()*pool.length)]);
  return shuf([...chars, ...extras].map((ch, i) => ({ id:i, ch, used:false })));
}

// ─── Type (Tobo-style tile puzzle) ────────────────────────────────
function TypeTab({ mastery, rec }) {
  const [topic, setTopic] = useState("All");
  const [cnt, setCnt]     = useState("20");
  const [mode, setMode]   = useState("gr"); // "gr"=show EN→type Greek, "tr"=show EN→type Transcription
  const [phase, setPhase] = useState("setup");
  const [qs, setQs]       = useState([]);
  const [qi, setQi]       = useState(0);
  const [score, setScore] = useState(0);

  // tile state
  const [tiles, setTiles]     = useState([]); // {id, ch, used}
  const [picked, setPicked]   = useState([]); // [{id, ch}] — slots filled so far
  const [res, setRes]         = useState(null); // null|"ok"|"bad"
  const [hintCount, setHintCount] = useState(0); // letters revealed by hint

  function getAnswer(w) { return mode==="gr" ? w[0].replace(/\s/g,"") : w[1].replace(/\s/g,""); }
  function getQuestion(w) { return w[2]; } // always show English

  function initRound(pool, i) {
    const w = pool[i];
    const answer = getAnswer(w);
    setTiles(makeTiles(answer));
    setPicked([]);
    setRes(null);
    setHintCount(0);
  }

  function start() {
    const pool0 = topic==="All" ? WORDS : WORDS.filter(w=>w[3]===topic);
    const n = cnt==="all" ? pool0.length : +cnt;
    const pool = shuf(pool0).slice(0, Math.min(n, pool0.length));
    setQs(pool); setQi(0); setScore(0);
    initRound(pool, 0);
    setPhase("game");
  }

  function tapTile(tile) {
    if (res || tile.used) return;
    const newPicked = [...picked, { id:tile.id, ch:tile.ch }];
    setTiles(prev => prev.map(t => t.id===tile.id ? {...t, used:true} : t));
    setPicked(newPicked);
    // auto-check when enough letters placed
    const answer = getAnswer(qs[qi]);
    if (newPicked.length === answer.length) {
      const typed = newPicked.map(p=>p.ch).join("");
      const ok = norm(typed) === norm(answer);
      setRes(ok ? "ok" : "bad");
      if (ok) setScore(s=>s+1);
      rec(qs[qi][0], 'tile', ok);
    }
  }

  function removeLast() {
    if (res || picked.length===0) return;
    const last = picked[picked.length-1];
    setTiles(prev => prev.map(t => t.id===last.id ? {...t, used:false} : t));
    setPicked(prev => prev.slice(0,-1));
  }

  function hint() {
    if (res) return;
    const answer = getAnswer(qs[qi]);
    const nextPos = hintCount; // reveal this index
    if (nextPos >= answer.length) return;
    const neededCh = answer[nextPos];
    // Remove any wrong picked letters beyond nextPos first
    // Clear everything and re-reveal up to nextPos+1
    const newHint = nextPos + 1;
    // Find tile ids that match needed chars in order
    const needed = answer.slice(0, newHint).split("");
    const used = [];
    const newTiles = tiles.map(t => ({...t, used:false}));
    const newPicked = [];
    for (const ch of needed) {
      const tile = newTiles.find(t => !t.used && norm(t.ch)===norm(ch));
      if (tile) { tile.used = true; used.push(tile); newPicked.push({id:tile.id, ch:tile.ch}); }
    }
    setTiles(newTiles);
    setPicked(newPicked);
    setHintCount(newHint);
    // auto-check if complete
    if (newHint === answer.length) {
      const ok = true;
      setRes("ok");
      setScore(s=>s+1);
      rec(qs[qi][0], 'tile', ok);
    }
  }

  function next() {
    const nextQi = qi+1;
    if (nextQi >= qs.length) { setPhase("result"); return; }
    setQi(nextQi);
    initRound(qs, nextQi);
  }

  function retry() {
    // Reset the current word without counting as new attempt
    initRound(qs, qi);
  }

  // ── setup screen ──
  if (phase==="setup") return (
    <div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:"1rem" }}>
        <span style={{ fontSize:12, color:"#888", fontWeight:500 }}>Topic:</span>
        {TOPICS.map(t=><Chip key={t} label={t} on={topic===t} onClick={()=>setTopic(t)}/>)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:"1rem" }}>
        <MCard title="English → Greek letters" on={mode==="gr"} onClick={()=>setMode("gr")}/>
        <MCard title="English → Transcription" on={mode==="tr"} onClick={()=>setMode("tr")}/>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"center", marginBottom:"1rem" }}>
        <span style={{ fontSize:13, color:"#888" }}>Words:</span>
        <select value={cnt} onChange={e=>setCnt(e.target.value)} style={{ padding:"4px 8px", border:"0.5px solid #ccc", borderRadius:8, background:"transparent", fontSize:13, fontFamily:"inherit" }}>
          {["10","20","30","all"].map(v=><option key={v}>{v}</option>)}
        </select>
      </div>
      <div style={{ textAlign:"center" }}><Btn onClick={start}>Start →</Btn></div>
    </div>
  );
  if (phase==="result") return <ResBox score={score} total={qs.length} onRetry={()=>{
    const reshuffled = shuf([...qs]);
    setQs(reshuffled); setQi(0); setScore(0);
    initRound(reshuffled, 0);
    setPhase("game");
  }}/>;

  // ── game screen ──
  const w = qs[qi];
  const answer = getAnswer(w);
  const slots = answer.length;
  const bgMain = res==="ok" ? "#E1F5EE" : res==="bad" ? "#FFF0F0" : "#f7f7ff";
  const accentColor = res==="ok" ? "#1D9E75" : res==="bad" ? "#E24B4A" : "#534AB7";

  return (
    <div style={{ background:bgMain, borderRadius:16, padding:"1.2rem", transition:"background .3s" }}>
      {/* progress */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
        <button onClick={()=>setPhase("setup")} style={{ fontSize:13, color:"#888", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", padding:0 }}>← Back</button>
        <span style={{ fontSize:13, color:"#888" }}>{qi+1}/{qs.length}</span>
        <Pill>{score} correct</Pill>
      </div>
      <Bar pct={Math.round((qi+1)/qs.length*100)} h={4}/>
      <div style={{ marginBottom:"1.4rem" }}/>

      {/* question */}
      <div style={{ textAlign:"center", marginBottom:"1.4rem" }}>
        <div style={{ fontSize:26, fontWeight:600, color:"#222", marginBottom:4 }}>{getQuestion(w)}</div>
        <div style={{ fontSize:12, color:"#aaa" }}>{mode==="gr" ? "Spell in Greek" : "Write transcription"}</div>
      </div>

      {/* answer slots */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", minHeight:52, marginBottom:"1.2rem", padding:"8px 0" }}>
        {Array.from({length:slots}).map((_,i) => {
          const p = picked[i];
          const isHinted = i < hintCount;
          return (
            <div key={i} onClick={()=>{ if(p && !res && !isHinted){ setTiles(prev=>prev.map(t=>t.id===p.id?{...t,used:false}:t)); setPicked(prev=>prev.filter((_,pi)=>pi!==i)); }}}
              style={{ minWidth:38, height:44, borderRadius:8, border:`2px solid ${p ? accentColor : "#ccc"}`, background: p ? (isHinted?"#FFF3CD":accentColor==="rgb(29,158,117)"?"#E1F5EE":"white") : "white", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:600, color: p ? accentColor : "#ddd", cursor: p&&!isHinted&&!res?"pointer":"default", transition:"all .15s", padding:"0 6px" }}>
              {p ? p.ch : ""}
            </div>
          );
        })}
      </div>

      {/* feedback */}
      {res && (
        <div style={{ textAlign:"center", marginBottom:"1rem", fontSize:14, fontWeight:500, color:accentColor }}>
          {res==="ok" ? "✓ Correct!" : `✗ Answer: ${answer}`}
        </div>
      )}

      {/* tile keyboard */}
      {!res && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginBottom:"1.2rem" }}>
          {tiles.map(tile => (
            <button key={tile.id} onClick={()=>tapTile(tile)} disabled={tile.used}
              style={{ minWidth:44, height:52, borderRadius:10, border:"1.5px solid #ccc", background:tile.used?"#eee":"white", color:tile.used?"#ccc":"#222", fontSize:20, fontWeight:600, cursor:tile.used?"default":"pointer", fontFamily:"inherit", transition:"all .12s", padding:"0 8px", boxShadow:tile.used?"none":"0 2px 4px rgba(0,0,0,0.08)" }}>
              {tile.ch}
            </button>
          ))}
        </div>
      )}

      {/* action buttons */}
      <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
        {!res ? (
          <>
            <button onClick={removeLast} style={{ padding:"10px 18px", borderRadius:10, border:"1.5px solid #ccc", background:"white", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>⌫ Delete</button>
            <button onClick={hint} disabled={hintCount>=slots}
              style={{ padding:"10px 18px", borderRadius:10, border:"1.5px solid #BA7517", background:"#FFF3CD", color:"#7A4F00", fontSize:13, cursor:hintCount>=slots?"default":"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:5 }}>
              💡 Hint ({slots-hintCount} left)
            </button>
          </>
        ) : res==="bad" ? (
          <>
            <button onClick={retry}
              style={{ padding:"12px 24px", borderRadius:10, border:"1.5px solid #BA7517", background:"#FFF3CD", color:"#7A4F00", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
              ↺ Retry
            </button>
            <button onClick={next}
              style={{ padding:"12px 24px", borderRadius:10, border:"none", background:"#ccc", color:"white", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
              Skip →
            </button>
          </>
        ) : (
          <button onClick={next}
            style={{ padding:"12px 32px", borderRadius:10, border:"none", background:accentColor, color:"white", fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}


// ─── Sentences Tab (Duolingo-style sentence builder) ──────────────
function SentencesTab({ rec }) {
  const [phase, setPhase]     = useState("setup");
  const [topic, setTopic]     = useState("all"); // "all" or verb filter
  const [qs, setQs]           = useState([]);
  const [qi, setQi]           = useState(0);
  const [picked, setPicked]   = useState([]); // words chosen so far
  const [tiles, setTiles]     = useState([]); // {id, word, used}
  const [result, setResult]   = useState(null); // null | "ok" | "bad"
  const [score, setScore]     = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  function buildTiles(s) {
    const all = shuf([...s.gr.map((w,i)=>({id:`g${i}`,word:w,used:false})),
                      ...s.ex.map((w,i)=>({id:`e${i}`,word:w,used:false}))]);
    setTiles(all);
    setPicked([]);
    setResult(null);
    setShowAnswer(false);
  }

  function start() {
    const pool = shuf(SENTENCES);
    setQs(pool); setQi(0); setScore(0);
    buildTiles(pool[0]);
    setPhase("game");
  }

  function tapTile(tile) {
    if (result || tile.used) return;
    setTiles(prev => prev.map(t => t.id===tile.id ? {...t,used:true} : t));
    const newPicked = [...picked, tile];
    setPicked(newPicked);
    // Auto-check when picked count matches answer length
    const s = qs[qi];
    if (newPicked.length === s.gr.length) {
      const typed = newPicked.map(t=>t.word).join(" ");
      const correct = s.gr.join(" ");
      const ok = typed === correct;
      setResult(ok ? "ok" : "bad");
      if (ok) setScore(sc=>sc+1);
    }
  }

  function removePicked(idx) {
    if (result) return;
    const tile = picked[idx];
    setTiles(prev => prev.map(t => t.id===tile.id ? {...t,used:false} : t));
    setPicked(prev => prev.filter((_,i)=>i!==idx));
  }

  function next() {
    const nextQi = qi+1;
    if (nextQi >= qs.length) { setPhase("result"); return; }
    setQi(nextQi);
    buildTiles(qs[nextQi]);
  }

  function showHint() {
    const s = qs[qi];
    // Reset and reveal full answer
    const newTiles = tiles.map(t=>({...t,used:false}));
    const newPicked = [];
    for (const word of s.gr) {
      const tile = newTiles.find(t=>!t.used&&t.word===word);
      if (tile) { tile.used=true; newPicked.push(tile); }
    }
    setTiles(newTiles);
    setPicked(newPicked);
    setResult("hint");
    setShowAnswer(true);
  }

  if (phase==="setup") return (
    <div style={{textAlign:"center",padding:"1rem 0"}}>
      <div style={{fontSize:15,fontWeight:500,marginBottom:8}}>Sentence Builder</div>
      <div style={{fontSize:13,color:"#888",marginBottom:"1.4rem",lineHeight:1.6}}>
        Read the English sentence.<br/>Tap the Greek words in the correct order.
      </div>
      <div style={{background:"#f8f8f8",borderRadius:12,padding:"1rem 1.4rem",marginBottom:"1.4rem",textAlign:"left"}}>
        <div style={{fontSize:12,color:"#888",marginBottom:6}}>How it works:</div>
        <div style={{fontSize:13,color:"#333",lineHeight:1.8}}>
          🇬🇧 English sentence shown above<br/>
          🟦 Tap Greek word tiles to build translation<br/>
          ✓ Auto-checks when last word placed<br/>
          💡 Hint reveals the full answer
        </div>
      </div>
      <div style={{fontSize:12,color:"#aaa",marginBottom:"1.4rem"}}>{SENTENCES.length} sentences · from verb exercises</div>
      <Btn onClick={start}>Start →</Btn>
    </div>
  );

  if (phase==="result") return (
    <ResBox
      score={score} total={qs.length}
      onRetry={()=>{
        const reshuffled = shuf([...qs]);
        setQs(reshuffled); setQi(0); setScore(0);
        buildTiles(reshuffled[0]);
        setPhase("game");
      }}
    />
  );

  const s = qs[qi];
  const bgMain = result==="ok" ? "#E8F8F2" : result==="bad" ? "#FFF0F0" : result==="hint" ? "#FFF8E8" : "white";
  const accentColor = result==="ok" ? "#1D9E75" : result==="bad" ? "#E24B4A" : result==="hint" ? "#BA7517" : "#534AB7";

  return (
    <div style={{background:bgMain, borderRadius:16, padding:"1.2rem", transition:"background .3s", minHeight:400}}>
      {/* Progress */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
        <button onClick={()=>setPhase("setup")} style={{fontSize:13,color:"#888",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}>← Back</button>
        <span style={{fontSize:13,color:"#888"}}>{qi+1}/{qs.length}</span>
        <Pill>{score} correct</Pill>
      </div>
      <Bar pct={Math.round((qi+1)/qs.length*100)} h={4}/>
      <div style={{marginBottom:"1.4rem"}}/>

      {/* English prompt */}
      <div style={{textAlign:"center",marginBottom:"1.6rem"}}>
        <div style={{fontSize:11,color:"#aaa",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Translate to Greek</div>
        <div style={{fontSize:26,fontWeight:700,color:"#222",lineHeight:1.3}}>{s.en}</div>
      </div>

      {/* Answer slots */}
      <div style={{minHeight:52,marginBottom:"1.2rem",display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",padding:"10px 4px",background:"rgba(0,0,0,0.04)",borderRadius:10,border:`1.5px dashed ${result ? accentColor : "#ddd"}`}}>
        {picked.length === 0 && (
          <span style={{fontSize:13,color:"#bbb",alignSelf:"center"}}>Tap words below…</span>
        )}
        {picked.map((tile,i) => (
          <button key={tile.id} onClick={()=>removePicked(i)} disabled={!!result}
            style={{padding:"11px 18px",borderRadius:10,border:`1.5px solid ${accentColor}`,
              background:"white",color:accentColor,fontSize:18,fontWeight:500,
              cursor:result?"default":"pointer",fontFamily:"inherit",
              boxShadow:"0 1px 3px rgba(0,0,0,0.1)"}}>
            {tile.word}
          </button>
        ))}
      </div>

      {/* Feedback */}
      {result && (
        <div style={{textAlign:"center",marginBottom:"1rem",fontSize:14,fontWeight:600,color:accentColor}}>
          {result==="ok"   && "✓ Correct!"}
          {result==="bad"  && `✗ Correct answer: ${s.gr.join(" ")}`}
          {result==="hint" && `💡 Answer: ${s.gr.join(" ")}`}
        </div>
      )}

      {/* Word tiles */}
      {!result && (
        <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",marginBottom:"1.2rem"}}>
          {tiles.map(tile => (
            <button key={tile.id} onClick={()=>tapTile(tile)} disabled={tile.used}
              style={{padding:"14px 20px",borderRadius:12,
                border: tile.used ? "1.5px solid #eee" : "1.5px solid #7F77DD",
                background: tile.used ? "#f5f5f5" : "white",
                color: tile.used ? "#ccc" : "#3C3489",
                fontSize:18,fontWeight:600,cursor:tile.used?"default":"pointer",
                fontFamily:"inherit",transition:"all .12s",
                boxShadow:tile.used?"none":"0 2px 6px rgba(127,119,221,0.15)"}}>
              {tile.word}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div style={{display:"flex",gap:8,justifyContent:"center"}}>
        {!result ? (
          <>
            <button onClick={()=>{setPicked([]); setTiles(prev=>prev.map(t=>({...t,used:false})))}}
              style={{padding:"9px 16px",borderRadius:10,border:"1.5px solid #ccc",background:"white",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              ⌫ Clear
            </button>
            <button onClick={showHint}
              style={{padding:"9px 16px",borderRadius:10,border:"1.5px solid #BA7517",background:"#FFF3CD",color:"#7A4F00",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              💡 Hint
            </button>
          </>
        ) : (
          <button onClick={next}
            style={{padding:"12px 36px",borderRadius:10,border:"none",
              background: result==="ok" ? "#1D9E75" : result==="hint" ? "#BA7517" : "#E24B4A",
              color:"white",fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            Next →
          </button>
        )}
      </div>
    </div>
  );
}


// ─── Stats Tab ─────────────────────────────────────────────────────
function StatsTab({ mastery }) {
  const [filter, setFilter] = useState("all");

  // Apply decay on render
  const m = useMemo(() => applyDecay(mastery), [mastery]);

  const items = WORDS.map(w => {
    const e = m[w[0]] || initMastery()[w[0]];
    const lvl = e.level;
    const modes = e.modes;
    const totalOk   = Object.values(modes).reduce((a,x)=>a+x.ok,0);
    const totalFail = Object.values(modes).reduce((a,x)=>a+x.fail,0);
    const totalAtt  = totalOk + totalFail;
    const acc = totalAtt ? Math.round(totalOk/totalAtt*100) : null;
    return { w, e, lvl, totalOk, totalFail, totalAtt, acc };
  });

  const counts = [0,1,2,3,4,5].map(l => items.filter(i=>i.lvl===l).length);
  const frozen = items.filter(i=>i.e.frozen).length;
  const mastPct = Math.round((counts[5]+frozen)/WORDS.length*100);

  const visible = items
    .filter(i => filter==="all" || (filter==="5"?i.lvl===5:filter==="frozen"?i.e.frozen:i.lvl===+filter))
    .sort((a,b) => a.lvl!==b.lvl ? a.lvl-b.lvl : (a.acc??-1)-(b.acc??-1));

  return (
    <div>
      {/* level legend */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:"1rem" }}>
        {LEVEL_INFO.map((li,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:20, background:li.bg, border:`0.5px solid ${li.color}` }}>
            <span style={{ fontSize:12, color:li.color }}>{li.icon}</span>
            <span style={{ fontSize:11, color:li.color, fontWeight:500 }}>{li.label}</span>
            <span style={{ fontSize:11, color:li.color }}>({counts[i]})</span>
          </div>
        ))}
        {frozen>0&&<div style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:20, background:"#FFD700", border:"0.5px solid #B8860B" }}><span style={{fontSize:11,color:"#7A5900",fontWeight:500}}>❄ Frozen ({frozen})</span></div>}
      </div>

      {/* overall progress */}
      <div style={{ marginBottom:"1.4rem" }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:5 }}>
          <span style={{ fontWeight:500 }}>Overall mastery</span>
          <span style={{ color:"#888" }}>{counts[5]+frozen}/{WORDS.length} ({mastPct}%)</span>
        </div>
        {/* segmented bar */}
        <div style={{ height:12, borderRadius:6, overflow:"hidden", display:"flex", background:"#eee" }}>
          {LEVEL_INFO.map((li,i) => {
            const w = counts[i]/WORDS.length*100;
            if (w===0) return null;
            return <div key={i} style={{ width:`${w}%`, height:12, background:li.color, transition:"width .3s" }} title={`${li.label}: ${counts[i]}`}/>;
          })}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#aaa", marginTop:3 }}>
          <span>Level 0 (unseen)</span><span>{mastPct}% mastered</span><span>Level 5 ★</span>
        </div>
      </div>

      {/* what's next hint */}
      {counts[0]>0&&<div style={{ background:"#f7f7ff", border:"0.5px solid #AFA9EC", borderRadius:10, padding:"10px 14px", marginBottom:"1rem", fontSize:12, color:"#534AB7" }}>
        💡 <strong>{counts[0]}</strong> words unseen — start with Flashcards to unlock level 1!
      </div>}
      {counts[4]>0&&<div style={{ background:"#E1F5EE", border:"0.5px solid #5DCAA5", borderRadius:10, padding:"10px 14px", marginBottom:"1rem", fontSize:12, color:"#0F6E56" }}>
        🎯 <strong>{counts[4]}</strong> words at level 4 — one more full round to reach level 5!
      </div>}

      {/* filter chips */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:"1rem", alignItems:"center" }}>
        <span style={{ fontSize:12, color:"#888", fontWeight:500 }}>Show:</span>
        {[["all","All"], ["0","Unseen"], ["1","Lv1"], ["2","Lv2"], ["3","Lv3"], ["4","Lv4"], ["5","Mastered"]].map(([v,l])=>(
          <Chip key={v} label={`${l} (${v==="all"?WORDS.length:counts[+v]??0})`} on={filter===v} onClick={()=>setFilter(v)}/>
        ))}
      </div>

      {/* word list */}
      {visible.length===0
        ? <div style={{ textAlign:"center", padding:"2rem", color:"#888", fontSize:13 }}>No words here yet</div>
        : <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {visible.map(({w,e,lvl,totalOk,totalAtt,acc})=>{
              const li = lv(lvl);
              const ms = e.modes;
              return (
                <div key={w[0]} style={{ padding:"10px 12px", background:li.bg, borderRadius:10, border:`0.5px solid ${li.color}33` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                    <span style={{ fontSize:16, color:li.color }}>{li.icon}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:600, color:"#222" }}>{w[0]}</div>
                      <div style={{ fontSize:11, color:"#888", fontStyle:"italic" }}>{w[1]} · {w[2]}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:11, fontWeight:600, color:li.color }}>{li.label}</div>
                      {acc!==null&&<div style={{ fontSize:10, color:"#aaa" }}>{totalOk}/{totalAtt} · {acc}%</div>}
                      {e.frozen&&<div style={{ fontSize:10, color:"#B8860B" }}>❄ frozen</div>}
                    </div>
                  </div>
                  {/* mode progress pills */}
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {[
                      { key:"flash",      label:"Flash" },
                      { key:"quiz_gr_en", label:"Quiz GR→EN" },
                      { key:"quiz_en_gr", label:"Quiz EN→GR" },
                      { key:"tile",       label:"Spelling" },
                    ].map(({key,label})=>{
                      const md = ms[key];
                      const tot = md.ok+md.fail;
                      const pct = tot ? Math.round(md.ok/tot*100) : null;
                      const done = md.cleared;
                      return (
                        <div key={key} style={{ padding:"2px 7px", borderRadius:10, fontSize:10, fontWeight:500, background:done?"#1D9E75":tot>0?"#FFF3CD":"#eee", color:done?"white":tot>0?"#7A4F00":"#bbb", border:`0.5px solid ${done?"#1D9E75":tot>0?"#BA7517":"#ddd"}` }}>
                          {done?"✓ ":""}{label}{pct!==null?` ${pct}%`:""}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────
const STORAGE_KEY = "greek_vocab_mastery_v1";

function App() {
  const [tab, setTab]         = useState("dict");
  const [mastery, setMastery] = useState(initMastery);
  const [loaded, setLoaded]   = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  // Load from Supabase on mount
  useEffect(() => {
    async function load() {
      try {
        const saved = await supabaseLoad();
        if (saved) {
          const fresh = initMastery();
          const merged = { ...fresh };
          Object.keys(saved).forEach(k => {
            if (merged[k] && saved[k]) {
              const savedModes = saved[k].modes || {};
              const mergedModes = {};
              Object.keys(merged[k].modes).forEach(m => {
                mergedModes[m] = savedModes[m]
                  ? { ok: savedModes[m].ok||0, fail: savedModes[m].fail||0, cleared: savedModes[m].cleared||false }
                  : merged[k].modes[m];
              });
              merged[k] = {
                level:    saved[k].level    ?? 0,
                streak5:  saved[k].streak5  ?? 0,
                frozen:   saved[k].frozen   ?? false,
                lastSeen: saved[k].lastSeen ?? null,
                modes: mergedModes,
              };
            }
          });
          setMastery(applyDecay(merged));
        } else {
          setMastery(applyDecay(initMastery()));
        }
      } catch {
        setMastery(applyDecay(initMastery()));
      }
      setLoaded(true);
    }
    load();
  }, []);

  // Save to Supabase on every mastery change (debounced 2s)
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus("saving");
    const timer = setTimeout(async () => {
      const ok = await supabaseSave(mastery);
      setSaveStatus(ok ? "saved" : "error");
      setTimeout(() => setSaveStatus(null), 2000);
    }, 2000);
    return () => clearTimeout(timer);
  }, [mastery, loaded]);

  // rec: record an answer from any exercise
  const rec = useCallback((wordKey, mode, ok) => {
    setMastery(prev => applyAnswer(prev, wordKey, mode, ok));
  }, []);

  // Online status
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restoreMsg, setRestoreMsg] = useState(null);

  function exportBackup() {
    try {
      const data = JSON.stringify(mastery);
      // Try clipboard
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(data).then(() => {
          setRestoreMsg({ ok:true, text:"✓ Copied! Paste into Notes app to save." });
          setTimeout(()=>setRestoreMsg(null), 4000);
        }).catch(()=> showTextFallback(data));
      } else {
        showTextFallback(data);
      }
    } catch(e) {
      setRestoreMsg({ ok:false, text:"Could not export." });
    }
  }

  function showTextFallback(data) {
    setRestoreText(data);
    setShowRestore(true);
    setRestoreMsg({ ok:true, text:"Copy the text below and save it in Notes." });
  }

  function importBackup() {
    try {
      const saved = JSON.parse(restoreText.trim());
      const fresh = initMastery();
      const merged = { ...fresh };
      Object.keys(saved).forEach(k => {
        if (merged[k] && saved[k]) {
          const savedModes = saved[k].modes || {};
          const mergedModes = {};
          Object.keys(merged[k].modes).forEach(m => {
            mergedModes[m] = savedModes[m]
              ? { ok:savedModes[m].ok||0, fail:savedModes[m].fail||0, cleared:savedModes[m].cleared||false }
              : merged[k].modes[m];
          });
          merged[k] = { level:saved[k].level??0, streak5:saved[k].streak5??0,
            frozen:saved[k].frozen??false, lastSeen:saved[k].lastSeen??null, modes:mergedModes };
        }
      });
      setMastery(applyDecay(merged));
      setShowRestore(false);
      setRestoreText("");
      setRestoreMsg({ ok:true, text:"✓ Progress restored!" });
      setTimeout(()=>setRestoreMsg(null), 3000);
    } catch(e) {
      setRestoreMsg({ ok:false, text:"Invalid backup data. Please check and try again." });
    }
  }
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Derived values — ALL hooks and derived state BEFORE any early return
  const masteryArr = useMemo(() => Object.values(mastery), [mastery]);
  const level5     = masteryArr.filter(e => e.level >= 5 || e.frozen).length;
  const mastPct    = Math.round(level5/WORDS.length*100);
  const TABS = [
    { id:"dict",      label:"Dictionary" },
    { id:"flash",     label:"Flashcards" },
    { id:"quiz",      label:"Quiz" },
    { id:"type",      label:"Type" },
    { id:"sentences", label:"Sentences" },
    { id:"stats",     label:`Progress (${level5}/${WORDS.length})` },
  ];

  // Early return only AFTER all hooks
  if (!loaded) return (
    <div style={{ padding:"3rem", textAlign:"center", color:"#888", fontFamily:"system-ui,sans-serif" }}>
      Loading your progress…
    </div>
  );

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", padding:"0.5rem 0", maxWidth:720 }}>
      {/* header */}
      <div style={{ background:"#EEEDFE", border:"0.5px solid #AFA9EC", borderRadius:12, padding:"10px 16px", marginBottom:6, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:11, fontWeight:500, color:"#534AB7", textTransform:"uppercase", letterSpacing:".06em" }}>Greek Vocabulary</div>
          <div style={{ fontSize:15, fontWeight:500, color:"#26215C" }}>A1–B1 · {WORDS.length} words · {TOPICS.length-1} topics</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
          {!isOnline && <span style={{ fontSize:11, color:"#888", background:"#f0f0f0", border:"0.5px solid #ccc", borderRadius:10, padding:"2px 8px" }}>📵</span>}
          {saveStatus && <span style={{ fontSize:11, color:saveStatus==="saved"?"#1D9E75":"#aaa" }}>{saveStatus==="saving"?"💾":"✓"}</span>}
          <span style={{ fontSize:12, color:"#0F6E56", background:"#E1F5EE", border:"0.5px solid #5DCAA5", borderRadius:10, padding:"2px 8px" }}>★ {level5} mastered</span>
          <button onClick={exportBackup}
            style={{ fontSize:12, padding:"3px 9px", borderRadius:10, border:"0.5px solid #7F77DD", background:"#EEEDFE", color:"#3C3489", cursor:"pointer", fontFamily:"inherit" }}>
            📋 Backup
          </button>
          <button onClick={()=>{ setShowRestore(r=>!r); setRestoreText(""); setRestoreMsg(null); }}
            style={{ fontSize:12, padding:"3px 9px", borderRadius:10, border:"0.5px solid #ccc", background:"transparent", color:"#888", cursor:"pointer", fontFamily:"inherit" }}>
            📥 Restore
          </button>
        </div>
      </div>

      {/* Backup notification */}
      {restoreMsg && (
        <div style={{ padding:"8px 14px", borderRadius:10, marginBottom:8,
          background: restoreMsg.ok ? "#E1F5EE" : "#FCEBEB",
          border: `0.5px solid ${restoreMsg.ok ? "#5DCAA5" : "#E24B4A"}`,
          fontSize:13, color: restoreMsg.ok ? "#0F6E56" : "#E24B4A" }}>
          {restoreMsg.text}
        </div>
      )}

      {/* Restore panel */}
      {showRestore && (
        <div style={{ background:"#f8f8f8", border:"0.5px solid #ddd", borderRadius:12, padding:"14px", marginBottom:"1rem" }}>
          <div style={{ fontSize:13, fontWeight:500, marginBottom:8 }}>📥 Restore from backup</div>
          <div style={{ fontSize:12, color:"#888", marginBottom:8 }}>
            Paste your backup text here (from Notes or clipboard):
          </div>
          <textarea
            value={restoreText}
            onChange={e=>setRestoreText(e.target.value)}
            placeholder="Paste backup data here…"
            rows={4}
            style={{ width:"100%", fontSize:11, fontFamily:"monospace", padding:"8px",
              border:"0.5px solid #ccc", borderRadius:8, background:"white",
              resize:"vertical", marginBottom:8 }}
          />
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={importBackup} disabled={!restoreText.trim()}
              style={{ padding:"8px 18px", borderRadius:8, border:"none",
                background: restoreText.trim() ? "#534AB7" : "#ccc",
                color:"white", fontSize:13, cursor: restoreText.trim() ? "pointer" : "default",
                fontFamily:"inherit", fontWeight:500 }}>
              Restore
            </button>
            <button onClick={()=>{ setShowRestore(false); setRestoreText(""); setRestoreMsg(null); }}
              style={{ padding:"8px 18px", borderRadius:8, border:"0.5px solid #ccc",
                background:"transparent", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
          </div>
          {restoreText && (
            <div style={{ marginTop:8, fontSize:11, color:"#aaa" }}>
              Select all text below and copy to save your backup:
            </div>
          )}
        </div>
      )}

      {/* segmented progress bar */}
      <div style={{ marginBottom:"1rem" }}>
        <div style={{ height:8, borderRadius:4, overflow:"hidden", display:"flex", background:"#eee" }}>
          {LEVEL_INFO.map((li,i) => {
            const cnt = masteryArr.filter(e=>e.level===i&&!e.frozen).length;
            if (cnt===0&&!(i===5)) return null;
            const w = (i===5 ? masteryArr.filter(e=>e.level===5||e.frozen).length : cnt) / WORDS.length * 100;
            return <div key={i} style={{ width:`${w}%`, height:8, background:li.color, transition:"width .3s" }}/>;
          })}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#bbb", marginTop:3 }}>
          <span>0%</span><span>{mastPct}% mastered</span><span>100%</span>
        </div>
      </div>

      {/* tabs */}
      <div style={{ display:"flex", borderBottom:"0.5px solid #e5e5e5", marginBottom:"1rem", overflowX:"auto" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"8px 13px", fontSize:13, cursor:"pointer", border:"none", background:"none", color:tab===t.id?"#111":"#888", fontFamily:"inherit", borderBottom:tab===t.id?"2px solid #111":"2px solid transparent", marginBottom:-1, fontWeight:tab===t.id?500:400, whiteSpace:"nowrap" }}>{t.label}</button>
        ))}
      </div>

      {tab==="dict"  && <DictTab  mastery={mastery}/>}
      {tab==="flash" && <FlashTab mastery={mastery} rec={rec}/>}
      {tab==="quiz"  && <QuizTab  mastery={mastery} rec={rec}/>}
      {tab==="type"  && <TypeTab  mastery={mastery} rec={rec}/>}
      {tab==="sentences" && <SentencesTab rec={rec}/>}
      {tab==="stats"     && <StatsTab mastery={mastery}/>}
    </div>
  );
}


// Mount app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
