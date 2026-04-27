'use client';
import { useState } from 'react';
import {
  GROUP_KEYS, R32_MATCHES, R16_MATCHES, QF_MATCHES, SF_MATCHES, FINAL_MATCH,
  POINTS, SlotMatch, AdvanceMatch, BracketPicks, defaultPicks,
} from '@/lib/bracket-data';
import { cleanupInvalidPicks, teamFor, thirdPlaceMatchTeams } from '@/lib/scoring';

type Props = {
  initialResults: BracketPicks;
  champGoalsInit: number | null;
};

export default function AdminResultsEditor({ initialResults, champGoalsInit }: Props) {
  const [picks, setPicks] = useState<BracketPicks>(initialResults);
  const [champGoals, setChampGoals] = useState<number | ''>(champGoalsInit ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch('/api/admin-save-results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          group_order: picks.group_order,
          best_third: picks.best_third,
          knockout: picks.knockout,
          champ_tournament_goals: champGoals === '' ? null : +champGoals,
          final_score: picks.final_score,
          top_scorer: picks.top_scorer,
          top_scoring_team: picks.top_scoring_team,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Save failed');
      setStatus(`Saved. Rescored ${j.rescored} brackets at ${new Date().toLocaleTimeString()}.`);
    } catch (e: any) {
      setStatus('Error: ' + (e?.message ?? 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  function update(mutator: (d: BracketPicks) => void) {
    setPicks(prev => {
      const next: BracketPicks = JSON.parse(JSON.stringify(prev));
      mutator(next);
      return cleanupInvalidPicks(next);
    });
  }
  const tpTeams = thirdPlaceMatchTeams(picks);

  function MatchCard({ m }: { m: SlotMatch | AdvanceMatch }) {
    function slotCodeFor(side: 'a' | 'b'): string | null {
      if ('a' in m) return side === 'a' ? m.a : m.b;
      return side === 'a' ? m.aFrom : m.bFrom;
    }
    function teamFromSlot(side: 'a' | 'b'): string | null {
      const code = slotCodeFor(side);
      if (!code) return null;
      if (/^(M|R|Q|S)\d+$/.test(code) || code === 'F') return picks.knockout[code] ?? null;
      return teamFor(code, picks);
    }
    return (
      <div className="match">
        <div className="match-tag">{m.id}</div>
        {(['a','b'] as const).map(side => {
          const team = teamFromSlot(side);
          const pickedWinner = picks.knockout[m.id];
          const isPicked = !!team && pickedWinner === team;
          const cls = ['slot'];
          if (!team) cls.push('empty');
          if (isPicked) cls.push('picked');
          return (
            <div key={side} className={cls.join(' ')}
              onClick={() => team && update(d => { d.knockout[m.id] = team; })}>
              <span className="seed">{slotCodeFor(side)}</span>
              <span className="nm">{team ?? `Winner of ${slotCodeFor(side)}`}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function Round({ title, pts, matches, className }: {
    title: string; pts: string; matches: (SlotMatch | AdvanceMatch)[]; className?: string;
  }) {
    return (
      <div className={`round ${className ?? ''}`}>
        <div className="round-title">{title}<span className="pts">{pts}</span></div>
        {matches.map(m => <MatchCard key={m.id} m={m} />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="card space-y-3">
        <h3 className="text-accent font-bold">Side bets &amp; final score (auto-synced from openfootball, override here)</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs uppercase tracking-wider text-inkdim block mb-1">Final score (regulation+AET)</label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={20}
                className="input !w-20 text-center font-bold"
                value={picks.final_score?.home ?? ''}
                onChange={e => {
                  const v = e.target.value === '' ? null : Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0));
                  update(d => {
                    d.final_score = v === null ? null : { home: v, away: d.final_score?.away ?? 0 };
                  });
                }}
                placeholder="—"
              />
              <span className="text-inkdim font-bold">:</span>
              <input type="number" min={0} max={20}
                className="input !w-20 text-center font-bold"
                value={picks.final_score?.away ?? ''}
                onChange={e => {
                  const v = e.target.value === '' ? null : Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0));
                  update(d => {
                    d.final_score = v === null ? null : { home: d.final_score?.home ?? 0, away: v };
                  });
                }}
                placeholder="—"
              />
              {picks.final_score && picks.final_score.home === picks.final_score.away && (
                <span className="text-xs uppercase font-bold text-accent2">PKs</span>
              )}
            </div>
          </div>
          <div className="min-w-[200px]">
            <label className="text-xs uppercase tracking-wider text-inkdim block mb-1">Top scorer (Golden Boot)</label>
            <input type="text" className="input"
              value={picks.top_scorer ?? ''}
              onChange={e => {
                const v = e.target.value;
                update(d => { d.top_scorer = v === '' ? null : v; });
              }}
              placeholder="e.g., Kylian Mbappé"
            />
          </div>
          <div className="min-w-[200px]">
            <label className="text-xs uppercase tracking-wider text-inkdim block mb-1">Top scoring team</label>
            <input type="text" className="input"
              value={picks.top_scoring_team ?? ''}
              onChange={e => {
                const v = e.target.value;
                update(d => { d.top_scoring_team = v === '' ? null : v; });
              }}
              placeholder="e.g., Brazil"
            />
          </div>
          <label className="text-xs uppercase tracking-wider text-inkdim">
            <span className="block mb-1">Champion goals (legacy)</span>
            <input type="number" min={0} max={99}
              className="input !w-24"
              value={champGoals}
              onChange={e => setChampGoals(e.target.value === '' ? '' : Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0)))}
            />
          </label>
          <button className="btn btn-primary ml-auto" onClick={save} disabled={busy}>
            {busy ? 'Saving & rescoring…' : 'Save results & rescore all brackets'}
          </button>
        </div>
      </div>
      {status && <div className="text-sm text-inkdim">{status}</div>}

      <section>
        <h2 className="section-h">Actual group stage results</h2>
        <p className="hint mb-3">Rank each group 1st–4th based on how it actually finished. Toggle which 8 third-placers advanced below.</p>
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {GROUP_KEYS.map(gk => (
            <div key={gk} className="card">
              <h3 className="text-accent font-bold mb-2">Group {gk}</h3>
              <div className="flex flex-col gap-1.5">
                {(picks.group_order[gk] ?? defaultPicks().group_order[gk]).map((team, idx) => (
                  <div key={idx} className="group-row" data-pos={idx+1}>
                    <div className="text-[10px] font-extrabold text-center text-inkdim">{idx+1}{['st','nd','rd','th'][idx]}</div>
                    <div className="font-semibold">{team}</div>
                    <select
                      value={idx + 1}
                      onChange={e => update(d => {
                        const arr = d.group_order[gk];
                        const toIdx = parseInt(e.target.value, 10) - 1;
                        [arr[idx], arr[toIdx]] = [arr[toIdx], arr[idx]];
                      })}
                    >
                      {[1,2,3,4].map(p => <option key={p} value={p}>{p}{['st','nd','rd','th'][p-1]}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="card mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-accent font-bold">Best third-place advancers</h3>
            <span className="text-xs font-bold">{picks.best_third.length} of 8</span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
            {GROUP_KEYS.map(gk => {
              const selected = picks.best_third.includes(gk);
              const team = picks.group_order[gk]?.[2];
              return (
                <div key={gk} role="button"
                  className={`third-chip ${selected ? 'selected' : ''}`}
                  onClick={() => update(d => {
                    const i = d.best_third.indexOf(gk);
                    if (i >= 0) d.best_third.splice(i, 1);
                    else if (d.best_third.length < 8) d.best_third.push(gk);
                  })}>
                  <span><span className="tag">3rd · {gk}</span> <strong className="ml-1">{team}</strong></span>
                  <span>{selected ? '✓' : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-h">Knockout results</h2>
        <div className="bracket-shell">
          <div className="bracket">
            <Round title="Round of 32" pts={`+${POINTS.R32} ea`} matches={R32_MATCHES} />
            <Round title="Round of 16" pts={`+${POINTS.R16} ea`} matches={R16_MATCHES} />
            <Round title="Quarterfinals" pts={`+${POINTS.QF} ea`} matches={QF_MATCHES} />
            <Round title="Semifinals" pts={`+${POINTS.SF} ea`} matches={SF_MATCHES} />
            <Round title="Final" pts={`+${POINTS.FINAL}`} matches={[FINAL_MATCH]} className="final" />
          </div>
        </div>
        <div className="flex flex-col items-center mt-4">
          <div className="round-title" style={{ width: 240, marginBottom: 0 }}>
            3rd Place Match <span className="pts">+{POINTS.TP}</span>
          </div>
          <div style={{ width: 240 }}>
            <div className="match">
              <div className="match-tag">3rd Place</div>
              {(['a','b'] as const).map((_side, i) => {
                const team = tpTeams[i];
                const pickedWinner = picks.knockout['TP'];
                const isPicked = !!team && pickedWinner === team;
                const cls = ['slot'];
                if (!team) cls.push('empty');
                if (isPicked) cls.push('picked');
                return (
                  <div key={i} className={cls.join(' ')}
                    onClick={() => team && update(d => { d.knockout['TP'] = team; })}>
                    <span className="seed">L-S{i+1}</span>
                    <span className="nm">{team ?? `Loser of semifinal ${i+1}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
